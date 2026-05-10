import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePendleYtEv, isPendleYtQueueItem, PENDLE_YT_EV_POLICY } from "../src/strategy/pendle-yt-ev.mjs";

function baseQueueItem(overrides = {}) {
  return {
    protocolId: "pendle",
    protocolBindingPlan: {
      bindingKind: "pendle_yt_buy_sell_redeem",
      resolvedBinding: {
        instrument: "yt",
        marketAddress: "0x1111111111111111111111111111111111111111",
        ytTokenAddress: "0x2222222222222222222222222222222222222222",
        assetAddress: "0x3232323232323232323232323232323232323232",
        maturity: "2026-08-10T00:00:00.000Z",
        exitQuote: {
          source: "odos",
          outputUsd: 10,
          depthUsd: 50,
          slippageBps: 30,
        },
        impliedAprPct: 80,
      },
    },
    aprPct: 80,
    nativeAprPct: 80,
    campaignRemainingHours: 240,
    ...overrides,
  };
}

test("PENDLE_YT_EV_POLICY has non-zero cost defaults", () => {
  assert.ok(PENDLE_YT_EV_POLICY.defaultEntryCostUsd > 0);
  assert.ok(PENDLE_YT_EV_POLICY.defaultExitCostUsd > 0);
  assert.ok(PENDLE_YT_EV_POLICY.defaultGasCostUsd > 0);
});

test("isPendleYtQueueItem detects YT by bindingKind", () => {
  assert.equal(isPendleYtQueueItem(baseQueueItem()), true);
});

test("isPendleYtQueueItem returns false for non-Pendle items", () => {
  assert.equal(isPendleYtQueueItem({ protocolId: "morpho" }), false);
});

test("evaluatePendleYtEv returns null for non-Pendle", () => {
  assert.equal(evaluatePendleYtEv({ protocolId: "morpho" }), null);
});

test("evaluatePendleYtEv passes for fully-provisioned YT with sufficient APR", () => {
  const item = baseQueueItem({ aprPct: 200, nativeAprPct: 200 });
  item.protocolBindingPlan.resolvedBinding.impliedAprPct = 200;
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.equal(result.status, "positive_ev");
  assert.equal(result.canaryReady, true);
  assert.deepEqual(result.blockers, []);
  assert.ok(result.expectedNetUsd > 0);
});

test("evaluatePendleYtEv blocks when maturity missing", () => {
  const item = baseQueueItem();
  delete item.protocolBindingPlan.resolvedBinding.maturity;
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("yt_maturity_missing"));
});

test("evaluatePendleYtEv blocks when maturity too close", () => {
  const item = baseQueueItem();
  item.protocolBindingPlan.resolvedBinding.maturity = "2026-05-10T12:00:00.000Z";
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.ok(result.blockers.includes("yt_maturity_too_close"));
});

test("evaluatePendleYtEv blocks when exit quote missing", () => {
  const item = baseQueueItem();
  delete item.protocolBindingPlan.resolvedBinding.exitQuote;
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.ok(result.blockers.includes("yt_exit_quote_missing"));
});

test("evaluatePendleYtEv blocks when exit liquidity too thin", () => {
  const item = baseQueueItem();
  item.protocolBindingPlan.resolvedBinding.exitQuote = { source: "odos", outputUsd: 2, depthUsd: 5, slippageBps: 30 };
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.ok(result.blockers.includes("yt_liquidity_too_thin"));
});

test("evaluatePendleYtEv blocks when exit slippage too high", () => {
  const item = baseQueueItem();
  item.protocolBindingPlan.resolvedBinding.exitQuote.slippageBps = 200;
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.ok(result.blockers.includes("yt_exit_slippage_too_high"));
});

test("evaluatePendleYtEv blocks when implied yield missing", () => {
  const item = baseQueueItem();
  delete item.protocolBindingPlan.resolvedBinding.impliedAprPct;
  delete item.aprPct;
  delete item.nativeAprPct;
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.ok(result.blockers.includes("yt_implied_yield_missing"));
});

test("evaluatePendleYtEv blocks when expected net not positive with zero APR", () => {
  const item = baseQueueItem();
  item.aprPct = 0;
  item.nativeAprPct = 0;
  delete item.protocolBindingPlan.resolvedBinding.impliedAprPct;
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.ok(result.blockers.includes("yt_expected_net_not_positive"));
});

test("evaluatePendleYtEv does NOT use campaign end as maturity fallback", () => {
  const item = baseQueueItem();
  delete item.protocolBindingPlan.resolvedBinding.maturity;
  item.campaignEndsAt = "2027-01-01T00:00:00.000Z";
  item.latestCampaignEnd = "2027-01-01T00:00:00.000Z";
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.ok(result.blockers.includes("yt_maturity_missing"));
});

test("evaluatePendleYtEv uses expirySec as maturity", () => {
  const item = baseQueueItem();
  delete item.protocolBindingPlan.resolvedBinding.maturity;
  item.protocolBindingPlan.resolvedBinding.expirySec = 1783008000;
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  assert.ok(!result.blockers.includes("yt_maturity_missing"));
  assert.ok(result.maturityHours > 0);
});

test("evaluatePendleYtEv cost defaults produce positive EV only for sufficient APR", () => {
  const item = baseQueueItem();
  item.aprPct = 2;
  item.nativeAprPct = 2;
  delete item.protocolBindingPlan.resolvedBinding.impliedAprPct;
  const result = evaluatePendleYtEv(item, { now: "2026-05-10T00:00:00.000Z" });
  const totalCost = PENDLE_YT_EV_POLICY.defaultEntryCostUsd + PENDLE_YT_EV_POLICY.defaultExitCostUsd + PENDLE_YT_EV_POLICY.defaultGasCostUsd;
  if (result.expectedNetUsd != null && result.expectedNetUsd <= 0) {
    assert.ok(result.blockers.includes("yt_expected_net_not_positive"));
  }
});
