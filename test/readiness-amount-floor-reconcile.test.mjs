import test from "node:test";
import assert from "node:assert/strict";

import {
  indexGatewayAmountFloorEvidence,
  reconcileBlockerWithAmountFloorEvidence,
  refillBlockerDetails,
} from "../src/cli/check-full-automation-readiness.mjs";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";

// Producer-side reconciliation between a stale autopilot refill blocker and
// fresh Gateway QUOTE_AMOUNT_TOO_LOW evidence. The overlay uses the asset
// registry to map (sourceAsset/targetAsset, sourceChain/chain) tuples into
// family-keyed route identities, so the join key is registry-driven rather
// than chain/token-literal. Synthetic chain strings (`synSrcChain`,
// `synDstChain`) prove the production path does not assume any particular
// chain name; the asset/family literals come from the registry under test.

const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";

test("indexGatewayAmountFloorEvidence keeps only QUOTE_AMOUNT_TOO_LOW records keyed by chain+family", () => {
  const map = indexGatewayAmountFloorEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      route: { srcChain: "synSrcChain", dstChain: "synDstChain", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT_TOKEN },
      error: {
        details: {
          body: { code: "QUOTE_AMOUNT_TOO_LOW", details: { minimum: "25000", actual: "10000" } },
        },
      },
    },
    {
      observedAt: "2026-05-20T00:00:01.000Z",
      route: { srcChain: "synSrcChain", dstChain: "synDstChain", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT_TOKEN },
      error: {
        details: { body: { code: "INVALID_REQUEST", details: null } },
      },
    },
  ]);
  const key = "synsrcchain|native_or_wrapped->syndstchain|wrapped_btc";
  assert.ok(map.has(key), `expected key ${key}`);
  assert.deepEqual(map.get(key), {
    minimum: "25000",
    actual: "10000",
    observedAt: "2026-05-20T00:00:00.000Z",
  });
});

test("indexGatewayAmountFloorEvidence keeps the freshest QUOTE_AMOUNT_TOO_LOW record per family key", () => {
  const map = indexGatewayAmountFloorEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      route: { srcChain: "synSrcChain", dstChain: "synDstChain", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT_TOKEN },
      error: {
        details: { body: { code: "QUOTE_AMOUNT_TOO_LOW", details: { minimum: "10000", actual: "1000" } } },
      },
    },
    {
      observedAt: "2026-05-21T00:00:00.000Z",
      route: { srcChain: "synSrcChain", dstChain: "synDstChain", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT_TOKEN },
      error: {
        details: { body: { code: "QUOTE_AMOUNT_TOO_LOW", details: { minimum: "25000", actual: "10000" } } },
      },
    },
  ]);
  const value = map.get("synsrcchain|native_or_wrapped->syndstchain|wrapped_btc");
  assert.deepEqual(value, {
    minimum: "25000",
    actual: "10000",
    observedAt: "2026-05-21T00:00:00.000Z",
  });
});

test("reconcileBlockerWithAmountFloorEvidence overlays family-matched fresh evidence onto routing_exhausted blocker", () => {
  const amountFloorByRoute = indexGatewayAmountFloorEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      route: { srcChain: "synSrcChain", dstChain: "synDstChain", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT_TOKEN },
      error: {
        details: { body: { code: "QUOTE_AMOUNT_TOO_LOW", details: { minimum: "25000", actual: "10000" } } },
      },
    },
  ]);
  const overlay = reconcileBlockerWithAmountFloorEvidence(
    {
      chain: "synDstChain",
      asset: "wBTC.OFT",
      targetAsset: "wBTC.OFT",
      sourceChain: "synSrcChain",
      sourceAsset: "BTC",
      reason: "routing_exhausted",
      selectedMethod: "synthetic_method",
      routeDeferralReason: "bridge_route_unavailable_gateway_no_route_no_alternate_provider",
    },
    amountFloorByRoute,
  );
  assert.equal(overlay.reason, "quote_amount_too_low");
  assert.equal(overlay.routeDeferralReason, "bridge_quote_amount_below_minimum");
  assert.equal(overlay.routeDeferralAction, "defer_until_input_amount_meets_route_minimum_or_consolidate_inventory");
  assert.deepEqual(overlay.quoteAmountFloor, { minimum: "25000", actual: "10000" });
  assert.equal(overlay.reconciledFromFreshGatewayEvidence, true);
});

test("reconcileBlockerWithAmountFloorEvidence leaves ineligible-reason blockers untouched", () => {
  const amountFloorByRoute = indexGatewayAmountFloorEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      route: { srcChain: "synSrcChain", dstChain: "synDstChain", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT_TOKEN },
      error: {
        details: { body: { code: "QUOTE_AMOUNT_TOO_LOW", details: { minimum: "25000", actual: "10000" } } },
      },
    },
  ]);
  const original = {
    chain: "synDstChain",
    asset: "wBTC.OFT",
    sourceChain: "synSrcChain",
    sourceAsset: "BTC",
    reason: "expected_net_below_receipt_cost_p90_floor",
    selectedMethod: "synthetic_method",
  };
  const overlay = reconcileBlockerWithAmountFloorEvidence(original, amountFloorByRoute);
  assert.deepEqual(overlay, original);
});

test("reconcileBlockerWithAmountFloorEvidence is a noop when fresh evidence map is empty", () => {
  const overlay = reconcileBlockerWithAmountFloorEvidence(
    {
      chain: "synDstChain",
      asset: "wBTC.OFT",
      sourceChain: "synSrcChain",
      sourceAsset: "BTC",
      reason: "routing_exhausted",
    },
    new Map(),
  );
  assert.equal(overlay.reason, "routing_exhausted");
  assert.equal(overlay.quoteAmountFloor, undefined);
});

test("refillBlockerDetails accepts amountFloorByRoute and surfaces reconciled flag in projection", () => {
  const amountFloorByRoute = indexGatewayAmountFloorEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      route: { srcChain: "synSrcChain", dstChain: "synDstChain", srcToken: ZERO_TOKEN, dstToken: WBTC_OFT_TOKEN },
      error: {
        details: { body: { code: "QUOTE_AMOUNT_TOO_LOW", details: { minimum: "25000", actual: "10000" } } },
      },
    },
  ]);
  const projected = refillBlockerDetails(
    [
      {
        chain: "synDstChain",
        asset: "wBTC.OFT",
        targetAsset: "wBTC.OFT",
        sourceChain: "synSrcChain",
        sourceAsset: "BTC",
        reason: "routing_exhausted",
        selectedMethod: "synthetic_method",
        routeDeferralReason: "bridge_route_unavailable_gateway_no_route_no_alternate_provider",
        stalePlannerMethod: false,
      },
    ],
    { amountFloorByRoute },
  );
  assert.equal(projected.length, 1);
  const entry = projected[0];
  assert.equal(entry.reason, "quote_amount_too_low");
  assert.equal(entry.category, "quote_amount_below_minimum");
  assert.equal(entry.routeDeferralReason, "bridge_quote_amount_below_minimum");
  assert.deepEqual(entry.quoteAmountFloor, { minimum: "25000", actual: "10000" });
  assert.equal(entry.reconciledFromFreshGatewayEvidence, true);
});
