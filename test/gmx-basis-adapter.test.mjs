import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultGmxBasisConfig,
  evaluateGmxBasisAdapter,
  summarizeGmxBasisAdapter,
  validateGmxBasisConfig,
} from "../src/strategy/gmx-basis-adapter.mjs";

// Funding samples that produce ewma ≈ 0.10 (10% APR), well above
// the entry threshold of 2%.
function positiveFundingSamples(n = 30, rate = 0.20) {
  return Array.from({ length: n }, () => rate);
}

function negativeFundingSamples(n = 30) {
  return Array.from({ length: n }, () => -0.05);
}

function goodMarket(overrides = {}) {
  return {
    fundingRateAnnualizedSamples: positiveFundingSamples(),
    recentNegativeDays: 0,
    borrowAprBps: 200,
    openInterestImbalancePct: 10,
    spotPriceUsd: 90_000,
    perpMarkPriceUsd: 90_050,
    perpLiquidityUsd: 50_000_000,
    projectedHealthFactor: 1.8,
    entrySlippageBps: 8,
    exitSlippageBps: 12,
    gatewayQuoteFresh: true,
    gatewayRoundTripCostBps: 50,
    ...overrides,
  };
}

function goodReceipts({ liqOk = true, unwind = true, count = 3 } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      signerBacked: true,
      result: "passed",
      realizedNetUsd: 12,
      liquidationBufferProven: liqOk,
      autoUnwindProven: i === 0 ? unwind : true,
    });
  }
  return out;
}

describe("validateGmxBasisConfig", () => {
  it("default config validates", () => {
    const v = validateGmxBasisConfig(buildDefaultGmxBasisConfig());
    assert.equal(v.ok, true);
  });

  it("rejects unsupported chain", () => {
    const cfg = { ...buildDefaultGmxBasisConfig(), chain: "ethereum" };
    const v = validateGmxBasisConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("chain must be 'avalanche'")));
  });

  it("rejects excessive shortLeverage", () => {
    const cfg = { ...buildDefaultGmxBasisConfig(), shortLeverage: 10 };
    const v = validateGmxBasisConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("shortLeverage capped at 5x")));
  });

  it("rejects healthFactorMin < 1", () => {
    const cfg = { ...buildDefaultGmxBasisConfig(), healthFactorMin: 0.8 };
    const v = validateGmxBasisConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("healthFactorMin must be ≥ 1")));
  });

  it("rejects out-of-bounds liquidationBufferPct", () => {
    const cfg = { ...buildDefaultGmxBasisConfig(), liquidationBufferPct: 0 };
    const v = validateGmxBasisConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("liquidationBufferPct")));
  });
});

describe("evaluateGmxBasisAdapter — funding-rate-gate behaviour", () => {
  const cfg = { ...buildDefaultGmxBasisConfig(), perTradeCapUsd: 10_000 };

  it("blocks when funding samples missing", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket({ fundingRateAnnualizedSamples: [] }),
    });
    assert.equal(r.promotion, "blocked");
    assert.ok(r.blockers.includes("funding_rate_samples_unobserved"));
  });

  it("blocks when funding gate forces exit (negative ewma)", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket({
        fundingRateAnnualizedSamples: negativeFundingSamples(),
      }),
    });
    assert.equal(r.fundingVerdict.action, "force_exit");
    assert.ok(r.gates.includes("funding_gate_force_exit"));
    assert.equal(r.shadowReady, false);
  });

  it("blocks when recent negative days hits threshold", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket({ recentNegativeDays: 5 }),
    });
    assert.equal(r.fundingVerdict.action, "force_exit");
  });

  it("reaches shadow_ready with healthy market + positive funding", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket(),
    });
    assert.equal(r.fundingVerdict.action, "allow_entry");
    assert.equal(r.shadowReady, true);
    assert.equal(r.promotion, "shadow_ready");
    assert.ok(r.economics.projectedAnnualizedNetBps >= cfg.minProjectedAnnualNetBps);
  });
});

describe("evaluateGmxBasisAdapter — policy gates", () => {
  const cfg = { ...buildDefaultGmxBasisConfig(), perTradeCapUsd: 10_000 };

  it("blocks on excessive borrow APR", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket({ borrowAprBps: 1500 }),
    });
    assert.ok(r.gates.includes("borrow_apr_above_threshold"));
  });

  it("blocks on excessive OI imbalance", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket({ openInterestImbalancePct: 60 }),
    });
    assert.ok(r.gates.includes("open_interest_imbalance_excessive"));
  });

  it("blocks when projected HF falls below minimum", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket({ projectedHealthFactor: 1.1 }),
    });
    assert.ok(r.gates.includes("projected_health_factor_below_minimum"));
  });

  it("blocks on excessive spot/perp divergence", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket({ perpMarkPriceUsd: 92_000 }), // ~2.2% gap
    });
    assert.ok(r.gates.includes("spot_perp_price_divergence_excessive"));
  });

  it("blocks when projected annual net falls below threshold", () => {
    // Push borrow APR very high so net drops below 800 bps.
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket({ borrowAprBps: 590 }), // just under the gate
    });
    assert.ok(r.blockers.includes("projected_annualized_net_below_threshold"));
    assert.equal(r.shadowReady, false);
  });
});

describe("evaluateGmxBasisAdapter — promotion ladder", () => {
  const cfg = { ...buildDefaultGmxBasisConfig(), perTradeCapUsd: 10_000 };

  it("does not promote without auto-unwind proof", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts({ unwind: false }).map((r) => ({
        ...r,
        autoUnwindProven: false,
      })),
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("auto_unwind_unproven"));
  });

  it("does not promote when any receipt missed liquidation buffer", () => {
    const receipts = [
      ...goodReceipts({ count: 2 }),
      {
        signerBacked: true,
        result: "passed",
        realizedNetUsd: 5,
        liquidationBufferProven: false,
        autoUnwindProven: true,
      },
    ];
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket(),
      receipts,
    });
    assert.equal(r.liveReady, false);
    assert.ok(
      r.blockers.includes("liquidation_buffer_unproven_in_some_receipts"),
    );
  });

  it("promotes to live_candidate with full evidence", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    assert.equal(r.shadowReady, true);
    assert.equal(r.liveReady, true);
    assert.equal(r.promotion, "live_candidate");
  });
});

describe("evaluateGmxBasisAdapter — invariants", () => {
  const cfg = { ...buildDefaultGmxBasisConfig(), perTradeCapUsd: 10_000 };

  it("output is frozen and deterministic", () => {
    const r1 = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    const r2 = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    assert.equal(Object.isFrozen(r1), true);
    assert.equal(Object.isFrozen(r1.gates), true);
    assert.equal(Object.isFrozen(r1.blockers), true);
    assert.equal(Object.isFrozen(r1.fundingVerdict), true);
    assert.deepEqual(r1, r2);
  });

  it("summary fields present", () => {
    const r = evaluateGmxBasisAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    const s = summarizeGmxBasisAdapter(r);
    assert.equal(s.strategyId, cfg.id);
    assert.equal(s.promotion, "live_candidate");
    assert.equal(s.fundingAction, "allow_entry");
    assert.equal(s.signerBackedReceipts, 3);
    assert.ok(typeof s.projectedAnnualizedNetBps === "number");
  });
});
