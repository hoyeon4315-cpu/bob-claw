import test from "node:test";
import assert from "node:assert/strict";

import { refillBlockerDetails } from "../src/cli/check-full-automation-readiness.mjs";

// Producer-side projection test. Confirms `refillBlockerDetails` additively
// surfaces the upstream normalized tuple (sourceChain, sourceAsset, taxonomy,
// route/executor family, route-deferral fields) plus cost-floor numeric fields
// when present. The downstream remediation-lane-intent-candidate lifecycle
// needs these fields to perform a precise tuple-level join and to distinguish
// route-absence taxonomy (cost-floor unavailable by design) from EV-rejected
// classes (cost-floor numeric fields expected). Synthetic chain/asset/method
// strings prove the projection does not depend on any target literal.

test("refillBlockerDetails preserves chain/asset/reason/category/selectedMethod/stale flag (legacy fields)", () => {
  const projected = refillBlockerDetails([
    {
      chain: "syntheticDst",
      asset: "SYN_ASSET",
      reason: "routing_exhausted",
      selectedMethod: "synthetic_method_a",
      stalePlannerMethod: false,
    },
  ]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].chain, "syntheticDst");
  assert.equal(projected[0].asset, "SYN_ASSET");
  assert.equal(projected[0].reason, "routing_exhausted");
  assert.equal(projected[0].category, "routing_exhausted");
  assert.equal(projected[0].selectedMethod, "synthetic_method_a");
  assert.equal(projected[0].stalePlannerMethod, false);
});

test("refillBlockerDetails additively exposes sourceChain/sourceAsset/taxonomy/family/route-deferral fields", () => {
  const projected = refillBlockerDetails([
    {
      chain: "syntheticDst",
      asset: "SYN_ASSET",
      sourceChain: "syntheticSrc",
      sourceAsset: "SYN_SRC",
      reason: "routing_exhausted",
      selectedMethod: "synthetic_method_a",
      stalePlannerMethod: false,
      taxonomy: "route_specific_failure_lock",
      executorFamily: "synthetic_executor_family",
      routeFamily: "synthetic_route_family",
      routeDeferralReason: "synthetic_deferral_reason",
      routeDeferralAction: "synthetic_deferral_action",
    },
  ]);
  const entry = projected[0];
  assert.equal(entry.sourceChain, "syntheticSrc");
  assert.equal(entry.sourceAsset, "SYN_SRC");
  assert.equal(entry.taxonomy, "route_specific_failure_lock");
  assert.equal(entry.executorFamily, "synthetic_executor_family");
  assert.equal(entry.routeFamily, "synthetic_route_family");
  assert.equal(entry.routeDeferralReason, "synthetic_deferral_reason");
  assert.equal(entry.routeDeferralAction, "synthetic_deferral_action");
});

test("refillBlockerDetails passes through numeric cost-floor evidence when present", () => {
  const projected = refillBlockerDetails([
    {
      chain: "dstSynthetic",
      asset: "DST_ASSET",
      sourceChain: "srcSynthetic",
      sourceAsset: "SRC_ASSET",
      reason: "expected_net_below_receipt_cost_p90_floor",
      selectedMethod: "synthetic_swap_method",
      stalePlannerMethod: false,
      expectedNetUsd: -0.12,
      requiredNetUsd: 0.5,
      p90CostUsd: 0.55,
      effectiveFloorUsd: 0.6,
    },
  ]);
  const entry = projected[0];
  assert.equal(entry.expectedNetUsd, -0.12);
  assert.equal(entry.requiredNetUsd, 0.5);
  assert.equal(entry.p90CostUsd, 0.55);
  assert.equal(entry.effectiveFloorUsd, 0.6);
});

test("refillBlockerDetails normalizes absent cost-floor numeric fields to null", () => {
  const projected = refillBlockerDetails([
    {
      chain: "x",
      asset: "Y",
      reason: "routing_exhausted",
      selectedMethod: "m",
      stalePlannerMethod: false,
    },
  ]);
  const entry = projected[0];
  assert.equal(entry.expectedNetUsd, null);
  assert.equal(entry.requiredNetUsd, null);
  assert.equal(entry.p90CostUsd, null);
  assert.equal(entry.effectiveFloorUsd, null);
});

test("refillBlockerDetails accepts alias keys for numeric cost-floor fields (no hardcoding)", () => {
  const projected = refillBlockerDetails([
    {
      chain: "a",
      asset: "b",
      reason: "routing_exhausted",
      selectedMethod: "m",
      stalePlannerMethod: false,
      requiredNetPnlUsd: 0.7,
      receiptCostP90Usd: 0.65,
      effectiveCostFloorUsd: 0.8,
    },
  ]);
  const entry = projected[0];
  assert.equal(entry.requiredNetUsd, 0.7);
  assert.equal(entry.p90CostUsd, 0.65);
  assert.equal(entry.effectiveFloorUsd, 0.8);
});

test("refillBlockerDetails drops entries missing reason and caps at 8 entries", () => {
  const projected = refillBlockerDetails([
    { chain: "a", asset: "b" },
    ...Array.from({ length: 12 }, (_, i) => ({
      chain: `c${i}`,
      asset: `d${i}`,
      reason: "routing_exhausted",
      selectedMethod: "m",
    })),
  ]);
  assert.equal(projected.length, 8);
  assert.ok(projected.every((entry) => entry.reason));
});
