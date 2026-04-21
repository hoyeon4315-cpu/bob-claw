import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BERACHAIN_MODES,
  buildDefaultBerachainConfig,
  evaluateBerachainAdapter,
  summarizeBerachainAdapter,
  validateBerachainConfig,
} from "../src/strategy/berachain-bend-bex-adapter.mjs";

function collateralOnlyMarket(overrides = {}) {
  return {
    lendingTvlUsd: 5_000_000,
    lendingSupplyAprBps: 2000, // 20% supply APR (early-Bera incentive level)
    entrySlippageBps: 15,
    exitSlippageBps: 20,
    gatewayQuoteFresh: true,
    gatewayRoundTripCostBps: 60,
    offrampCostBps: 40,
    ...overrides,
  };
}

function lpBgtMarket(overrides = {}) {
  return {
    ...collateralOnlyMarket(),
    lpTvlUsd: 1_500_000,
    lpFeeAprBps: 600,
    lpRealizedIlBps: 80,
    bgtAprBps: 1500, // 15% BGT APR pre-haircut
    bgtOracleDriftBps: 200,
    bgtSpotLiquidityUsd: 250_000,
    ...overrides,
  };
}

function goodReceipts({
  bgt = true,
  rebalance = true,
  count = 3,
} = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      signerBacked: true,
      result: "passed",
      realizedNetUsd: 9,
      bgtClaimProven: bgt,
      rebalanceProven: rebalance,
    });
  }
  return out;
}

describe("validateBerachainConfig", () => {
  it("default config validates", () => {
    const v = validateBerachainConfig(buildDefaultBerachainConfig());
    assert.equal(v.ok, true);
  });

  it("rejects unsupported chain", () => {
    const cfg = { ...buildDefaultBerachainConfig(), chain: "base" };
    const v = validateBerachainConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("chain must be 'berachain'")));
  });

  it("rejects unknown mode", () => {
    const cfg = { ...buildDefaultBerachainConfig(), mode: "moon" };
    const v = validateBerachainConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("mode must be one of")));
  });

  it("accepts both supported modes", () => {
    for (const m of BERACHAIN_MODES) {
      const cfg = { ...buildDefaultBerachainConfig(), mode: m };
      const v = validateBerachainConfig(cfg);
      assert.equal(v.ok, true, `${m} should validate`);
    }
  });

  it("rejects illegal haircut bps", () => {
    const cfg = {
      ...buildDefaultBerachainConfig(),
      bgtIlliquidityHaircutBps: 12_000,
    };
    const v = validateBerachainConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(
      v.errors.some((e) => e.includes("bgtIlliquidityHaircutBps")),
    );
  });
});

describe("evaluateBerachainAdapter — collateral_only", () => {
  const cfg = {
    ...buildDefaultBerachainConfig(),
    perTradeCapUsd: 5000,
    mode: "collateral_only",
  };

  it("blocks with no market data", () => {
    const r = evaluateBerachainAdapter({ config: cfg, market: {} });
    assert.equal(r.promotion, "blocked");
    assert.ok(r.blockers.includes("lending_tvl_unobserved"));
  });

  it("does NOT require LP fields in collateral_only mode", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket(),
    });
    assert.equal(r.promotion, "shadow_ready");
    assert.equal(r.shadowReady, true);
    assert.ok(r.economics.projectedNetUsd > 0);
    assert.ok(!r.blockers.includes("lp_tvl_unobserved"));
    assert.ok(!r.blockers.includes("bgt_apr_unmeasured"));
  });

  it("blocks on low lending TVL", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket({ lendingTvlUsd: 100_000 }),
    });
    assert.ok(r.gates.includes("lending_tvl_below_minimum"));
  });

  it("blocks on round-trip cost above threshold", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket({ gatewayRoundTripCostBps: 250 }),
    });
    assert.ok(r.gates.includes("round_trip_cost_above_threshold"));
  });

  it("blocks on offramp cost above threshold", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket({ offrampCostBps: 200 }),
    });
    assert.ok(r.gates.includes("offramp_cost_above_threshold"));
  });

  it("collateral_only does not require BGT proof for live", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket(),
      receipts: goodReceipts({ bgt: false, rebalance: false }),
    });
    assert.equal(r.liveReady, true);
    assert.equal(r.promotion, "live_candidate");
  });
});

describe("evaluateBerachainAdapter — lp_bgt", () => {
  const cfg = {
    ...buildDefaultBerachainConfig(),
    perTradeCapUsd: 5000,
    mode: "lp_bgt",
  };

  it("blocks when LP/BGT data missing", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket(),
    });
    assert.equal(r.promotion, "blocked");
    assert.ok(r.blockers.includes("lp_tvl_unobserved"));
    assert.ok(r.blockers.includes("bgt_apr_unmeasured"));
  });

  it("reaches shadow_ready with full LP+BGT data", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: lpBgtMarket(),
    });
    assert.equal(r.promotion, "shadow_ready");
    assert.equal(r.shadowReady, true);
    assert.ok(r.economics.bgtUsdHaircut > 0);
    assert.ok(
      r.economics.bgtUsdHaircut <
        5000 * (1500 / 10_000) * (30 / 365) + 0.0001,
      "bgt accrual must be reduced by illiquidity haircut",
    );
  });

  it("blocks on excessive BGT oracle drift", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: lpBgtMarket({ bgtOracleDriftBps: 1500 }),
    });
    assert.ok(r.gates.includes("bgt_oracle_drift_above_threshold"));
  });

  it("blocks on LP IL above threshold", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: lpBgtMarket({ lpRealizedIlBps: 400 }),
    });
    assert.ok(r.gates.includes("lp_realized_il_above_threshold"));
  });

  it("does not promote without BGT claim proof", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: lpBgtMarket(),
      receipts: goodReceipts({ bgt: false }),
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("bgt_claim_unproven"));
  });

  it("does not promote without rebalance proof", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: lpBgtMarket(),
      receipts: goodReceipts({ rebalance: false }),
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("rebalance_unproven"));
  });

  it("promotes to live_candidate with full evidence", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: lpBgtMarket(),
      receipts: goodReceipts(),
    });
    assert.equal(r.promotion, "live_candidate");
    assert.equal(r.liveReady, true);
  });
});

describe("evaluateBerachainAdapter — invariants", () => {
  const cfg = { ...buildDefaultBerachainConfig(), perTradeCapUsd: 5000 };

  it("output is frozen and deterministic", () => {
    const r1 = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket(),
    });
    const r2 = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket(),
    });
    assert.equal(Object.isFrozen(r1), true);
    assert.equal(Object.isFrozen(r1.market), true);
    assert.equal(Object.isFrozen(r1.gates), true);
    assert.equal(Object.isFrozen(r1.blockers), true);
    assert.deepEqual(r1, r2);
  });

  it("summary fields present", () => {
    const r = evaluateBerachainAdapter({
      config: cfg,
      market: collateralOnlyMarket(),
      receipts: goodReceipts({ bgt: false, rebalance: false }),
    });
    const s = summarizeBerachainAdapter(r);
    assert.equal(s.strategyId, cfg.id);
    assert.equal(s.mode, "collateral_only");
    assert.equal(s.promotion, "live_candidate");
    assert.equal(s.signerBackedReceipts, 3);
  });
});
