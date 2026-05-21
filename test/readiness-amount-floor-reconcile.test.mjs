import test from "node:test";
import assert from "node:assert/strict";

import {
  indexGatewayAmountFloorEvidence,
  indexGatewaySuccessEvidence,
  reconcileBlockerWithAmountFloorEvidence,
  reconcileBlockerWithGatewaySuccessEvidence,
  refillBlockerDetails,
  refillBlockerDetailsForReadiness,
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

// Snapshot-freshness reconcile from successful Gateway probes. When fresh
// Gateway evidence is a SUCCESSFUL retry-at-minimum quote (not a failure),
// the persisted autopilot snapshot's stale `routing_exhausted`/`no_route`
// taxonomy must be reconciled into the precise amount-floor lifecycle plus
// `gatewaySuccessProbe` evidence. canIntent/canLive remain false because the
// route exists only at minimum; inventory still drives liveness.

const STABLECOIN_USDC_ETHEREUM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const STABLECOIN_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

test("indexGatewaySuccessEvidence keys freshest successful retry per family route", () => {
  const map = indexGatewaySuccessEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      ok: true,
      route: {
        srcChain: "synSrcChainAlpha",
        dstChain: "synDstChainAlpha",
        srcToken: ZERO_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
      amount: "25000",
      outputAmount: "8888888888888888",
      fees: "225106",
      executionFees: "215503",
      feeRatio: 9.00424,
      retryReason: "QUOTE_AMOUNT_TOO_LOW",
      retryOfAmount: "10000",
    },
    {
      observedAt: "2026-05-20T01:00:00.000Z",
      ok: true,
      route: {
        srcChain: "synSrcChainAlpha",
        dstChain: "synDstChainAlpha",
        srcToken: ZERO_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
      amount: "25000",
      outputAmount: "8897533396928517",
      fees: "225106",
      executionFees: "215503",
      feeRatio: 9.00424,
      retryReason: "QUOTE_AMOUNT_TOO_LOW",
      retryOfAmount: "10000",
    },
  ]);
  const key = "synsrcchainalpha|native_or_wrapped->syndstchainalpha|wrapped_btc";
  assert.ok(map.has(key));
  const probe = map.get(key);
  assert.equal(probe.outputAmount, "8897533396928517");
  assert.equal(probe.observedAt, "2026-05-20T01:00:00.000Z");
});

test("indexGatewaySuccessEvidence covers a second unrelated stablecoin tuple", () => {
  const map = indexGatewaySuccessEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      ok: true,
      route: {
        srcChain: "synSrcChainBeta",
        dstChain: "synDstChainBeta",
        srcToken: STABLECOIN_USDC_ETHEREUM,
        dstToken: STABLECOIN_USDC_BASE,
      },
      amount: "5000000",
      outputAmount: "4995000",
      fees: "5000",
      executionFees: "3000",
      feeRatio: 0.001,
    },
  ]);
  const key = "synsrcchainbeta|stablecoin->syndstchainbeta|stablecoin";
  assert.ok(map.has(key), `expected key ${key}`);
});

test("reconcileBlockerWithGatewaySuccessEvidence overlays success probe and marks snapshot stale", () => {
  const successByRoute = indexGatewaySuccessEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      ok: true,
      route: {
        srcChain: "synSrcChainAlpha",
        dstChain: "synDstChainAlpha",
        srcToken: ZERO_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
      amount: "25000",
      outputAmount: "8897533396928517",
      fees: "225106",
      executionFees: "215503",
      feeRatio: 9.00424,
      retryReason: "QUOTE_AMOUNT_TOO_LOW",
      retryOfAmount: "10000",
    },
  ]);
  const overlay = reconcileBlockerWithGatewaySuccessEvidence(
    {
      chain: "synDstChainAlpha",
      asset: "wBTC.OFT",
      targetAsset: "wBTC.OFT",
      sourceChain: "synSrcChainAlpha",
      sourceAsset: "BTC",
      reason: "routing_exhausted",
      selectedMethod: "synthetic_method_alpha",
    },
    successByRoute,
  );
  assert.equal(overlay.reason, "quote_amount_too_low");
  assert.equal(overlay.routeDeferralReason, "bridge_quote_amount_below_minimum");
  assert.deepEqual(overlay.quoteAmountFloor, { minimum: "25000", actual: "10000" });
  assert.equal(overlay.snapshotStaleByFreshSuccess, true);
  assert.equal(overlay.reconciledFromFreshGatewayEvidence, true);
  assert.equal(overlay.gatewaySuccessProbe.outputAmount, "8897533396928517");
  assert.equal(overlay.gatewaySuccessProbe.feeRatio, 9.00424);
});

test("reconcileBlockerWithGatewaySuccessEvidence reconciles invalid_request_recipient against fresh success", () => {
  const successByRoute = indexGatewaySuccessEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      ok: true,
      route: {
        srcChain: "synSrcChainAlpha",
        dstChain: "synDstChainAlpha",
        srcToken: ZERO_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
      amount: "25000",
      outputAmount: "8000000000000000",
      fees: "100000",
    },
  ]);
  const overlay = reconcileBlockerWithGatewaySuccessEvidence(
    {
      chain: "synDstChainAlpha",
      asset: "wBTC.OFT",
      sourceChain: "synSrcChainAlpha",
      sourceAsset: "BTC",
      reason: "invalid_request_recipient",
      selectedMethod: "synthetic_method_alpha",
    },
    successByRoute,
  );
  assert.equal(overlay.snapshotStaleByFreshSuccess, true);
  assert.equal(overlay.reason, "quote_amount_too_low");
});

test("refillBlockerDetails passes both amount-floor and success evidence through projection", () => {
  const amountFloorByRoute = indexGatewayAmountFloorEvidence([
    {
      observedAt: "2026-05-20T00:00:00.000Z",
      route: {
        srcChain: "synSrcChainAlpha",
        dstChain: "synDstChainAlpha",
        srcToken: ZERO_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
      error: {
        details: { body: { code: "QUOTE_AMOUNT_TOO_LOW", details: { minimum: "25000", actual: "10000" } } },
      },
    },
  ]);
  const successByRoute = indexGatewaySuccessEvidence([
    {
      observedAt: "2026-05-20T01:00:00.000Z",
      ok: true,
      route: {
        srcChain: "synSrcChainAlpha",
        dstChain: "synDstChainAlpha",
        srcToken: ZERO_TOKEN,
        dstToken: WBTC_OFT_TOKEN,
      },
      amount: "25000",
      outputAmount: "8897533396928517",
      fees: "225106",
    },
  ]);
  const projected = refillBlockerDetails(
    [
      {
        chain: "synDstChainAlpha",
        asset: "wBTC.OFT",
        targetAsset: "wBTC.OFT",
        sourceChain: "synSrcChainAlpha",
        sourceAsset: "BTC",
        reason: "routing_exhausted",
        selectedMethod: "synthetic_method_alpha",
      },
    ],
    { amountFloorByRoute, successByRoute },
  );
  assert.equal(projected.length, 1);
  const entry = projected[0];
  assert.equal(entry.reason, "quote_amount_too_low");
  assert.deepEqual(entry.quoteAmountFloor, { minimum: "25000", actual: "10000" });
  assert.equal(entry.snapshotStaleByFreshSuccess, true);
  assert.equal(entry.gatewaySuccessProbe.outputAmount, "8897533396928517");
});

test("refillBlockerDetails leaves blockers untouched when neither evidence map matches", () => {
  const projected = refillBlockerDetails(
    [
      {
        chain: "synDstChainBeta",
        asset: "USDC",
        targetAsset: "USDC",
        sourceChain: "synSrcChainBeta",
        sourceAsset: "USDC",
        reason: "expected_net_below_receipt_cost_p90_floor",
        selectedMethod: "synthetic_method_beta",
      },
    ],
    { amountFloorByRoute: new Map(), successByRoute: new Map() },
  );
  assert.equal(projected[0].reason, "expected_net_below_receipt_cost_p90_floor");
  assert.equal(projected[0].snapshotStaleByFreshSuccess, false);
  assert.equal(projected[0].gatewaySuccessProbe, null);
});

function quoteFloorBlockers() {
  return [
    {
      chain: "synDstChainAlpha",
      asset: "wBTC.OFT",
      targetAsset: "wBTC.OFT",
      sourceChain: "synSrcChainAlpha",
      sourceAsset: "BTC",
      reason: "quote_amount_too_low",
      selectedMethod: "synthetic_bridge",
      quoteAmountFloor: { minimum: "25000", actual: "10000" },
    },
  ];
}

function capitalManagerWithSyntheticSource(actual) {
  return {
    jobs: {
      jobs: [
        {
          chain: "synDstChainAlpha",
          asset: "wBTC.OFT",
          executionMethod: "synthetic_bridge",
          decision: "REFILL_REQUIRED",
          blocker: null,
          fundingSource: {
            selectionStatus: "ready",
            source: { chain: "synSrcChainAlpha", ticker: "BTC", actual },
          },
        },
      ],
    },
  };
}

test("refillBlockerDetailsForReadiness drops quote-floor blockers when fresh planner source satisfies minimum", () => {
  const projected = refillBlockerDetailsForReadiness(quoteFloorBlockers(), {
    capitalManager: capitalManagerWithSyntheticSource("118705"),
  });
  assert.deepEqual(projected, []);
});

test("refillBlockerDetailsForReadiness keeps quote-floor blockers when planner source is still below minimum", () => {
  const projected = refillBlockerDetailsForReadiness(quoteFloorBlockers(), {
    capitalManager: capitalManagerWithSyntheticSource("10000"),
  });
  assert.equal(projected.length, 1);
  assert.equal(projected[0].reason, "quote_amount_too_low");
});
