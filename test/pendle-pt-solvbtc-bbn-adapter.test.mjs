import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultPendlePtSolvBtcConfig,
  evaluatePendlePtSolvBtcAdapter,
  summarizePendlePtSolvBtcAdapter,
  validatePendlePtSolvBtcConfig,
} from "../src/strategy/pendle-pt-solvbtc-bbn-adapter.mjs";

function goodMarket(overrides = {}) {
  return {
    ptImpliedAprBps: 950,
    daysToMaturity: 80,
    ptLiquidityUsd: 1_500_000,
    entrySlippageBps: 18,
    exitSlippageBps: 30,
    solvBtcPegDeviationBps: 8,
    customActionFailureRateBps: 50, // 0.5%
    gatewayQuoteFresh: true,
    gatewayCustomActionAvailable: true,
    gatewayRoundTripCostBps: 45,
    ...overrides,
  };
}

function goodReceipts(n = 3, { atomic = true, redemption = true } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    signerBacked: true,
    result: "passed",
    realizedNetUsd: 0.2 + i * 0.05,
    customActionAtomic: atomic,
    maturityRedemptionProven: i === 0 ? redemption : false,
  }));
}

describe("validatePendlePtSolvBtcConfig", () => {
  it("default config passes", () => {
    const v = validatePendlePtSolvBtcConfig(buildDefaultPendlePtSolvBtcConfig());
    assert.equal(v.ok, true);
  });

  it("rejects empty config", () => {
    const v = validatePendlePtSolvBtcConfig({});
    assert.equal(v.ok, false);
    assert.ok(v.missingFields.length > 5);
  });

  it("rejects non-bsc chain (custom action target)", () => {
    const v = validatePendlePtSolvBtcConfig({
      ...buildDefaultPendlePtSolvBtcConfig(),
      chain: "base",
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("bsc")));
  });

  it("rejects min/max maturity inversion", () => {
    const v = validatePendlePtSolvBtcConfig({
      ...buildDefaultPendlePtSolvBtcConfig(),
      minDaysToMaturity: 200,
      maxDaysToMaturity: 100,
    });
    assert.equal(v.ok, false);
  });

  it("rejects non-positive maxRoundTripCostBps", () => {
    const v = validatePendlePtSolvBtcConfig({
      ...buildDefaultPendlePtSolvBtcConfig(),
      maxRoundTripCostBps: 0,
    });
    assert.equal(v.ok, false);
  });
});

describe("evaluatePendlePtSolvBtcAdapter", () => {
  const cfg = {
    ...buildDefaultPendlePtSolvBtcConfig(),
    perTradeCapUsd: 300,
  };

  it("empty market → blocked with all market blockers", () => {
    const r = evaluatePendlePtSolvBtcAdapter({ config: cfg });
    assert.equal(r.mode, "blocked");
    assert.ok(r.blockers.includes("pt_implied_apr_missing"));
    assert.ok(r.blockers.includes("gateway_custom_action_unavailable"));
    assert.ok(r.blockers.includes("gateway_round_trip_cost_unmeasured"));
    assert.equal(r.economics, null);
  });

  it("good market, no receipts → shadow_ready", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket(),
    });
    assert.equal(r.shadowReady, true);
    assert.equal(r.liveReady, false);
    assert.equal(r.mode, "shadow_ready");
    assert.ok(r.blockers.includes("no_signer_backed_receipts"));
    assert.ok(r.blockers.includes("maturity_redemption_unproven"));
    assert.ok(r.economics.projectedNetUsd > 0);
  });

  it("good market + atomic receipts + redemption proof → live_candidate", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(3, { atomic: true, redemption: true }),
    });
    assert.equal(r.liveReady, true);
    assert.equal(r.mode, "live_candidate");
    assert.equal(r.blockers.length, 0);
  });

  it("non-atomic custom action → blocks live", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(3, { atomic: false, redemption: true }),
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("custom_action_atomicity_unproven"));
  });

  it("missing redemption proof → blocks live", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(3, { atomic: true, redemption: false }),
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("maturity_redemption_unproven"));
  });

  it("custom action failure rate over threshold → gate", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket({ customActionFailureRateBps: 500 }),
    });
    assert.ok(r.gates.includes("custom_action_failure_rate_above_threshold"));
    assert.equal(r.shadowReady, false);
  });

  it("round-trip cost over threshold → gate", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket({ gatewayRoundTripCostBps: 200 }),
    });
    assert.ok(r.gates.includes("round_trip_cost_above_threshold"));
  });

  it("PT liquidity below minimum → gate", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket({ ptLiquidityUsd: 50_000 }),
    });
    assert.ok(r.gates.includes("pt_liquidity_below_minimum"));
  });

  it("SolvBTC peg deviation excessive → gate", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket({ solvBtcPegDeviationBps: 200 }),
    });
    assert.ok(r.gates.includes("solvbtc_peg_deviation_excessive"));
  });

  it("negative projected net → not shadow_ready", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket({ ptImpliedAprBps: 600, gatewayRoundTripCostBps: 80, entrySlippageBps: 35, exitSlippageBps: 60, daysToMaturity: 30 }),
    });
    // 600bps * 30/365 = ~49 bps return < 80+35+60 = 175bps cost → negative
    assert.ok(r.economics.projectedNetUsd < 0);
    assert.equal(r.shadowReady, false);
  });

  it("output frozen", () => {
    const r = evaluatePendlePtSolvBtcAdapter({
      config: cfg,
      market: goodMarket(),
    });
    assert.throws(() => {
      r.blockers.push("x");
    });
    assert.throws(() => {
      r.gates.push("x");
    });
  });

  it("deterministic", () => {
    const a = evaluatePendlePtSolvBtcAdapter({ config: cfg, market: goodMarket(), receipts: goodReceipts(3) });
    const b = evaluatePendlePtSolvBtcAdapter({ config: cfg, market: goodMarket(), receipts: goodReceipts(3) });
    assert.deepEqual(a, b);
  });

  it("summary fields present", () => {
    const r = evaluatePendlePtSolvBtcAdapter({ config: cfg, market: goodMarket() });
    const s = summarizePendlePtSolvBtcAdapter(r);
    assert.equal(s.strategyId, "pendle-pt-solvbtc-bbn-bsc");
    assert.equal(s.mode, "shadow_ready");
    assert.equal(s.customActionAtomicCount, 0);
  });
});
