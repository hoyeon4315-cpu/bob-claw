import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultBeefyFoldingConfig,
  evaluateBeefyFoldingAdapter,
  summarizeBeefyFoldingAdapter,
  validateBeefyFoldingConfig,
} from "../src/strategy/beefy-folding-adapter.mjs";

function goodMarket(overrides = {}) {
  return {
    vaultTvlUsd: 5_000_000,
    reportedNetApyBps: 800, // 8% APY net of perf fee
    beefyPerformanceFeeBps: 950,
    underlyingHealthFactor: 2.0,
    underlyingUtilizationPct: 60,
    vaultPaused: false,
    entrySlippageBps: 10,
    exitSlippageBps: 15,
    gatewayQuoteFresh: true,
    gatewayRoundTripCostBps: 50,
    offrampCostBps: 35,
    ...overrides,
  };
}

function goodReceipts({ withdrawal = true, count = 3 } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      signerBacked: true,
      result: "passed",
      realizedNetUsd: 11,
      vaultWithdrawalProven: i === 0 ? withdrawal : true,
    });
  }
  return out;
}

describe("validateBeefyFoldingConfig", () => {
  it("default config validates", () => {
    const v = validateBeefyFoldingConfig(buildDefaultBeefyFoldingConfig());
    assert.equal(v.ok, true);
  });

  it("rejects out-of-bounds maxVaultShareOfTvlPct", () => {
    const cfg = {
      ...buildDefaultBeefyFoldingConfig(),
      maxVaultShareOfTvlPct: 0,
    };
    const v = validateBeefyFoldingConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(
      v.errors.some((e) => e.includes("maxVaultShareOfTvlPct")),
    );
  });

  it("rejects illegal maxBeefyPerformanceFeeBps", () => {
    const cfg = {
      ...buildDefaultBeefyFoldingConfig(),
      maxBeefyPerformanceFeeBps: 12_000,
    };
    const v = validateBeefyFoldingConfig(cfg);
    assert.equal(v.ok, false);
  });

  it("rejects underlyingHealthFactorMin < 1", () => {
    const cfg = {
      ...buildDefaultBeefyFoldingConfig(),
      underlyingHealthFactorMin: 0.9,
    };
    const v = validateBeefyFoldingConfig(cfg);
    assert.equal(v.ok, false);
    assert.ok(
      v.errors.some((e) => e.includes("underlyingHealthFactorMin")),
    );
  });
});

describe("evaluateBeefyFoldingAdapter — gates", () => {
  const cfg = { ...buildDefaultBeefyFoldingConfig(), perTradeCapUsd: 5000 };

  it("blocks when market data missing", () => {
    const r = evaluateBeefyFoldingAdapter({ config: cfg, market: {} });
    assert.equal(r.promotion, "blocked");
    assert.ok(r.blockers.includes("vault_tvl_unobserved"));
  });

  it("blocks when vault is paused", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket({ vaultPaused: true }),
    });
    assert.ok(r.gates.includes("vault_paused"));
    assert.equal(r.shadowReady, false);
  });

  it("blocks on low vault TVL", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket({ vaultTvlUsd: 200_000 }),
    });
    assert.ok(r.gates.includes("vault_tvl_below_minimum"));
  });

  it("blocks when position would exceed share-of-vault cap", () => {
    // 5000 / 50000 = 10% > 5% cap
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket({ vaultTvlUsd: 50_000, beefyPerformanceFeeBps: 800 }),
    });
    assert.ok(r.gates.includes("position_share_of_vault_excessive"));
  });

  it("blocks on low net APY", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket({ reportedNetApyBps: 100 }),
    });
    assert.ok(r.gates.includes("vault_net_apy_below_threshold"));
  });

  it("blocks on excessive Beefy perf fee", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket({ beefyPerformanceFeeBps: 1500 }),
    });
    assert.ok(r.gates.includes("beefy_performance_fee_above_threshold"));
  });

  it("blocks on weak underlying HF", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket({ underlyingHealthFactor: 1.2 }),
    });
    assert.ok(r.gates.includes("underlying_health_factor_below_minimum"));
  });

  it("blocks on excessive offramp cost", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket({ offrampCostBps: 200 }),
    });
    assert.ok(r.gates.includes("offramp_cost_above_threshold"));
  });

  it("reaches shadow_ready with healthy market", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket(),
    });
    assert.equal(r.promotion, "shadow_ready");
    assert.equal(r.shadowReady, true);
    assert.ok(r.economics.projectedNetUsd > 0);
  });
});

describe("evaluateBeefyFoldingAdapter — promotion", () => {
  const cfg = { ...buildDefaultBeefyFoldingConfig(), perTradeCapUsd: 5000 };

  it("does not promote without vault withdrawal proof", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts({ withdrawal: false }).map((r) => ({
        ...r,
        vaultWithdrawalProven: false,
      })),
    });
    assert.equal(r.liveReady, false);
    assert.ok(r.blockers.includes("vault_withdrawal_unproven"));
  });

  it("promotes to live_candidate with full evidence", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    assert.equal(r.promotion, "live_candidate");
    assert.equal(r.liveReady, true);
  });
});

describe("evaluateBeefyFoldingAdapter — invariants", () => {
  const cfg = { ...buildDefaultBeefyFoldingConfig(), perTradeCapUsd: 5000 };

  it("output is frozen and deterministic", () => {
    const r1 = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    const r2 = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    assert.equal(Object.isFrozen(r1), true);
    assert.equal(Object.isFrozen(r1.gates), true);
    assert.equal(Object.isFrozen(r1.blockers), true);
    assert.deepEqual(r1, r2);
  });

  it("summary fields present", () => {
    const r = evaluateBeefyFoldingAdapter({
      config: cfg,
      market: goodMarket(),
      receipts: goodReceipts(),
    });
    const s = summarizeBeefyFoldingAdapter(r);
    assert.equal(s.strategyId, cfg.id);
    assert.equal(s.promotion, "live_candidate");
    assert.equal(s.signerBackedReceipts, 3);
    assert.equal(s.vaultWithdrawalProvenCount, 3);
  });
});
