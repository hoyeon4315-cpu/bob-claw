import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AERODROME_CL_POOL_VARIANTS,
  buildDefaultAerodromeClConfig,
  evaluateAerodromeClAdapter,
  summarizeAerodromeClAdapter,
  validateAerodromeClConfig,
} from "../src/strategy/aerodrome-cl-adapter.mjs";

function goodMarket(overrides = {}) {
  return {
    poolTvlUsd: 2_000_000,
    poolFeeAprBps: 800, // 8% fee APR
    incentiveAprBps: 600, // 6% AERO emissions
    realizedIlBps: 40,
    outOfRangeTimePct: 10,
    currentTickOffsetBps: 5,
    entrySlippageBps: 10,
    exitSlippageBps: 15,
    gatewayQuoteFresh: true,
    gatewayRoundTripCostBps: 50,
    ...overrides,
  };
}

function goodReceipts({ rebalance = true, ilOk = true, count = 3 } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      signerBacked: true,
      result: "passed",
      realizedNetUsd: 12,
      rebalanceProven: rebalance,
      realizedIlWithinBounds: ilOk,
    });
  }
  return out;
}

describe("validateAerodromeClConfig", () => {
  it("default config is valid", () => {
    const v = validateAerodromeClConfig(buildDefaultAerodromeClConfig());
    assert.equal(v.ok, true);
    assert.equal(v.missingFields.length, 0);
    assert.equal(v.errors.length, 0);
  });

  it("rejects unsupported chain", () => {
    const cfg = { ...buildDefaultAerodromeClConfig(), chain: "ethereum" };
    const v = validateAerodromeClConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.includes("chain must be 'base' (Aerodrome venue)"));
  });

  it("rejects unknown poolVariant", () => {
    const cfg = { ...buildDefaultAerodromeClConfig(), poolVariant: "exotic" };
    const v = validateAerodromeClConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("poolVariant must be one of")));
  });

  it("accepts both supported variants", () => {
    for (const variant of AERODROME_CL_POOL_VARIANTS) {
      const cfg = { ...buildDefaultAerodromeClConfig(), poolVariant: variant };
      const v = validateAerodromeClConfig(cfg);
      assert.equal(v.ok, true, `variant ${variant} should validate`);
    }
  });

  it("rejects out-of-bounds maxOutOfRangeTimePct", () => {
    const cfg = {
      ...buildDefaultAerodromeClConfig(),
      maxOutOfRangeTimePct: 150,
    };
    const v = validateAerodromeClConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(
      v.errors.some((e) => e.includes("maxOutOfRangeTimePct")),
    );
  });

  it("rejects non-positive rangeHalfWidthBps", () => {
    const cfg = { ...buildDefaultAerodromeClConfig(), rangeHalfWidthBps: 0 };
    const v = validateAerodromeClConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("rangeHalfWidthBps")));
  });

  it("flags missing required numeric field", () => {
    const cfg = { ...buildDefaultAerodromeClConfig() };
    delete cfg.minPoolFeeAprBps;
    const v = validateAerodromeClConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.missingFields.includes("minPoolFeeAprBps"));
  });
});

describe("evaluateAerodromeClAdapter", () => {
  const cfg = { ...buildDefaultAerodromeClConfig(), perTradeCapUsd: 5000 };

  it("blocks when no market data observed", () => {
    const r = evaluateAerodromeClAdapter({ config: cfg, market: {} });
    assert.equal(r.mode, "blocked");
    assert.ok(r.blockers.length > 0);
    assert.ok(r.blockers.includes("pool_tvl_unobserved"));
    assert.equal(r.shadowReady, false);
    assert.equal(r.liveReady, false);
  });

  it("reaches shadow_ready when market is healthy", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: [],
    });
    assert.equal(r.shadowReady, true);
    assert.equal(r.liveReady, false);
    assert.equal(r.mode, "shadow_ready");
    assert.ok(r.economics != null);
    assert.ok(r.economics.projectedNetUsd > 0);
  });

  it("blocks on low pool TVL", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket({ poolTvlUsd: 100_000 }),
    });
    assert.ok(r.gates.includes("pool_tvl_below_minimum"));
    assert.equal(r.shadowReady, false);
  });

  it("blocks when current price drifts outside target range", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket({ currentTickOffsetBps: 60 }),
    });
    assert.ok(r.gates.includes("current_price_outside_target_range"));
  });

  it("blocks on excessive realized IL", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket({ realizedIlBps: 250 }),
    });
    assert.ok(r.gates.includes("realized_il_above_threshold"));
  });

  it("blocks on out-of-range time above threshold", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket({ outOfRangeTimePct: 50 }),
    });
    assert.ok(r.gates.includes("out_of_range_time_above_threshold"));
  });

  it("blocks on excessive round-trip cost", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket({ gatewayRoundTripCostBps: 200 }),
    });
    assert.ok(r.gates.includes("round_trip_cost_above_threshold"));
  });

  it("does not promote to live without rebalance proof", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts({ rebalance: false }),
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("rebalance_unproven"));
  });

  it("does not promote to live if any receipt breaches IL bound", () => {
    const receipts = [
      ...goodReceipts({ count: 2 }),
      {
        signerBacked: true,
        result: "passed",
        realizedNetUsd: 5,
        rebalanceProven: true,
        realizedIlWithinBounds: false,
      },
    ];
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket(),
      receipts,
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("realized_il_unbounded_in_receipts"));
  });

  it("promotes to live_candidate with full evidence", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    assert.equal(r.shadowReady, true);
    assert.equal(r.liveReady, true);
    assert.equal(r.mode, "live_candidate");
    assert.equal(r.evidence.passedCount, 3);
    assert.ok(r.evidence.realizedNetUsd > 0);
  });

  it("blocks if projected net is non-positive", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket({
        poolFeeAprBps: 410, // just above gate
        incentiveAprBps: 0,
        realizedIlBps: 140, // crystallized IL eats fees
        gatewayRoundTripCostBps: 79, // just under gate
      }),
    });
    assert.equal(r.shadowReady, false);
    assert.ok(r.economics.projectedNetUsd <= 0);
  });

  it("output is frozen and deterministic", () => {
    const r1 = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    const r2 = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    assert.equal(Object.isFrozen(r1), true);
    assert.equal(Object.isFrozen(r1.market), true);
    assert.equal(Object.isFrozen(r1.gates), true);
    assert.equal(Object.isFrozen(r1.blockers), true);
    assert.deepEqual(r1, r2);
  });

  it("summary fields present", () => {
    const r = evaluateAerodromeClAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    const s = summarizeAerodromeClAdapter(r);
    assert.equal(s.strategyId, cfg.id);
    assert.equal(s.poolVariant, cfg.poolVariant);
    assert.equal(s.mode, "live_candidate");
    assert.equal(s.signerBackedReceipts, 3);
    assert.equal(s.rebalanceProvenCount, 3);
    assert.ok(typeof s.projectedNetUsd === "number");
  });
});
