import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultPendlePtLbtcConfig,
  evaluatePendlePtLbtcAdapter,
  summarizePendlePtLbtcAdapter,
  validatePendlePtLbtcConfig,
} from "../src/strategy/pendle-pt-lbtc-adapter.mjs";

function goodMarket(overrides = {}) {
  return {
    ptImpliedAprBps: 850,
    daysToMaturity: 90,
    ptLiquidityUsd: 2_500_000,
    cbbtcSupplyAprBps: 180,
    usdcBorrowAprBps: 520,
    entrySlippageBps: 12,
    exitSlippageBps: 20,
    lbtcPegDeviationBps: 5,
    oracleFresh: true,
    ...overrides,
  };
}

function goodReceipts(n = 3, rolloverProven = true) {
  return Array.from({ length: n }, (_, i) => ({
    signerBacked: true,
    result: "passed",
    realizedNetUsd: 0.12 + i * 0.01,
    maturityRolloverProven: i === 0 ? rolloverProven : false,
  }));
}

describe("validatePendlePtLbtcConfig", () => {
  it("default config passes validation", () => {
    const v = validatePendlePtLbtcConfig(buildDefaultPendlePtLbtcConfig());
    assert.equal(v.ok, true);
    assert.equal(v.missingFields.length, 0);
    assert.equal(v.errors.length, 0);
  });

  it("reports missing required fields", () => {
    const v = validatePendlePtLbtcConfig({});
    assert.equal(v.ok, false);
    assert.ok(v.missingFields.includes("chain"));
    assert.ok(v.missingFields.includes("perTradeCapUsd"));
  });

  it("rejects unwind trigger above health floor", () => {
    const v = validatePendlePtLbtcConfig({
      ...buildDefaultPendlePtLbtcConfig(),
      unwindTriggerHealthFactor: 1.5,
      healthFactorMin: 1.45,
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("unwindTrigger")));
  });

  it("rejects health floor above target", () => {
    const v = validatePendlePtLbtcConfig({
      ...buildDefaultPendlePtLbtcConfig(),
      healthFactorMin: 2.0,
      targetHealthFactor: 1.8,
    });
    assert.equal(v.ok, false);
  });

  it("rejects maxLtvPct outside (0, 100)", () => {
    for (const bad of [0, 100, 120]) {
      const v = validatePendlePtLbtcConfig({
        ...buildDefaultPendlePtLbtcConfig(),
        maxLtvPct: bad,
      });
      assert.equal(v.ok, false);
    }
  });

  it("rejects minDaysToMaturity >= maxDaysToMaturity", () => {
    const v = validatePendlePtLbtcConfig({
      ...buildDefaultPendlePtLbtcConfig(),
      minDaysToMaturity: 200,
      maxDaysToMaturity: 180,
    });
    assert.equal(v.ok, false);
  });
});

describe("evaluatePendlePtLbtcAdapter", () => {
  const cfg = {
    ...buildDefaultPendlePtLbtcConfig(),
    perTradeCapUsd: 300,
  };

  it("empty market → all market blockers present", () => {
    const r = evaluatePendlePtLbtcAdapter({ config: cfg });
    assert.equal(r.mode, "blocked");
    assert.ok(r.blockers.includes("pt_implied_apr_missing"));
    assert.ok(r.blockers.includes("pt_maturity_missing"));
    assert.ok(r.blockers.includes("cbbtc_supply_apr_missing"));
    assert.ok(r.blockers.includes("usdc_borrow_apr_missing"));
    assert.ok(r.blockers.includes("oracle_stale_or_unknown"));
    assert.equal(r.economics, null);
    assert.equal(r.shadowReady, false);
    assert.equal(r.liveReady, false);
  });

  it("good market, no receipts → shadow_ready", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket(),
    });
    assert.equal(r.shadowReady, true);
    assert.equal(r.liveReady, false);
    assert.equal(r.mode, "shadow_ready");
    assert.ok(r.blockers.includes("no_signer_backed_receipts"));
    assert.ok(r.blockers.includes("maturity_rollover_unproven"));
    assert.ok(r.economics.projectedNetUsd > 0);
  });

  it("good market + ≥3 passed signer receipts + rollover → live_candidate", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(3, true),
    });
    assert.equal(r.liveReady, true);
    assert.equal(r.mode, "live_candidate");
    assert.equal(r.blockers.length, 0);
  });

  it("live_candidate requires maturity rollover proof", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(5, false),
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("maturity_rollover_unproven"));
  });

  it("maturity too near → gate triggers", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket({ daysToMaturity: 3 }),
    });
    assert.ok(r.gates.includes("maturity_too_near"));
    assert.equal(r.shadowReady, false);
  });

  it("entry slippage over threshold → gate triggers", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket({ entrySlippageBps: 200 }),
    });
    assert.ok(r.gates.includes("entry_slippage_above_threshold"));
    assert.equal(r.shadowReady, false);
  });

  it("LBTC peg deviation excessive → gate triggers", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket({ lbtcPegDeviationBps: 120 }),
    });
    assert.ok(r.gates.includes("lbtc_peg_deviation_excessive"));
  });

  it("PT implied APR below threshold → gate triggers", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket({ ptImpliedAprBps: 100 }),
    });
    assert.ok(r.gates.includes("pt_implied_apr_below_threshold"));
  });

  it("negative projected net → shadow_ready false", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket({
        ptImpliedAprBps: 500,
        usdcBorrowAprBps: 2000, // borrow cost dominates
        cbbtcSupplyAprBps: 10,
      }),
    });
    assert.ok(r.economics.projectedNetUsd < 0);
    assert.equal(r.shadowReady, false);
  });

  it("output and nested reports are frozen", () => {
    const r = evaluatePendlePtLbtcAdapter({
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

  it("is deterministic over two runs", () => {
    const a = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(3),
    });
    const b = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(3),
    });
    assert.deepEqual(a, b);
  });

  it("summary extracts key fields", () => {
    const r = evaluatePendlePtLbtcAdapter({
      config: cfg,
      market: goodMarket(),
    });
    const s = summarizePendlePtLbtcAdapter(r);
    assert.equal(s.strategyId, "pendle-pt-lbtc-base");
    assert.equal(s.mode, "shadow_ready");
    assert.ok(s.blockerCount >= 2);
    assert.ok(Number.isFinite(s.projectedNetUsd));
  });
});
