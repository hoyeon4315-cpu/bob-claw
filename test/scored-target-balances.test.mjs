import test from "node:test";
import assert from "node:assert/strict";
import { buildScoredTargetBalances } from "../src/executor/capital/scored-target-balances.mjs";

const FIXTURE_CAPS = [
  {
    strategyId: "strategy-base",
    autoExecute: true,
    caps: { perChainUsd: { base: 200 } },
  },
  {
    strategyId: "strategy-bsc",
    autoExecute: true,
    caps: { perChainUsd: { bsc: 1000 } },
  },
  {
    strategyId: "strategy-unichain",
    autoExecute: true,
    caps: { perChainUsd: { unichain: 1000 } },
  },
];

test("scored-target water-fills cap residual to remaining items", () => {
  const promotionGate = {
    items: [
      { templateId: "base:a", chain: "base", score: 0.6, strategyId: "strategy-base", gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:b", chain: "bsc", score: 0.4, strategyId: "strategy-bsc", gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 1000,
    diversificationPolicy: null,
  });
  assert.equal(result.perStrategy.length, 2);
  const base = result.perStrategy.find((s) => s.chain === "base");
  const bsc = result.perStrategy.find((s) => s.chain === "bsc");
  // base capped at 200 (perChainUsd). residual 400 redistributes to bsc → bsc=800.
  assert.equal(base.allocationUsd, 200);
  assert.ok(Math.abs(bsc.allocationUsd - 800) < 0.001, `expected bsc=800, got ${bsc.allocationUsd}`);
  // total now equals capital (no leak to BTC reserve from per-item caps).
  assert.ok(Math.abs(result.summary.totalAllocationUsd - 1000) < 0.001);
});

test("scored-target enforces diversification per-strategy cap with redistribution", () => {
  const promotionGate = {
    items: [
      { templateId: "base:a", chain: "base", score: 0.6, strategyId: "strategy-base", gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:b", chain: "bsc", score: 0.4, strategyId: "strategy-bsc", gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 1000,
    // default DIVERSIFICATION_POLICY: perStrategyMaxShare=0.25, perChainMaxShare=0.35
  });
  const base = result.perStrategy.find((s) => s.chain === "base");
  const bsc = result.perStrategy.find((s) => s.chain === "bsc");
  // base: min(perChainUsd=200, perStrategyCap=250) = 200.
  // bsc: weight share clipped to perStrategyCap=250.
  assert.equal(base.allocationUsd, 200);
  assert.ok(Math.abs(bsc.allocationUsd - 250) < 0.001, `expected bsc=250, got ${bsc.allocationUsd}`);
});

test("scored-target falls back to equal split when total weight is zero", () => {
  const promotionGate = {
    items: [
      { templateId: "bsc:a", chain: "bsc", score: 0, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "unichain:b", chain: "unichain", score: 0, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 600,
    diversificationPolicy: null,
  });
  assert.equal(result.perStrategy.length, 2);
  for (const entry of result.perStrategy) {
    assert.ok(Math.abs(entry.allocationUsd - 300) < 0.001);
  }
});

test("scored-target includes review_only candidates at reduced weight", () => {
  const promotionGate = {
    items: [
      { templateId: "base:a", chain: "base", score: 0.7, strategyId: "strategy-base", gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:b", chain: "bsc", score: 0.7, strategyId: "strategy-bsc", gate: { status: "promotable" }, allocationGate: { status: "review_only" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 1000,
    diversificationPolicy: null,
    reviewOnlyWeightFactor: 0.3,
  });
  // Both chains get capital. Effective weights: base=0.7*1.0=0.7, bsc=0.7*0.3=0.21.
  // base gets 0.7/0.91 * 1000 ≈ 769 → capped at 200. residual 569 → bsc.
  // bsc gets 0.21/0.91 * 1000 ≈ 230 + 569 = ~800 (cap is 1000).
  assert.equal(result.perStrategy.length, 2);
  const chains = result.perStrategy.map((e) => e.chain).sort();
  assert.deepEqual(chains, ["base", "bsc"]);
});

test("scored-target excludes blocked items but covers review_only", () => {
  const promotionGate = {
    items: [
      { templateId: "bsc:x", chain: "bsc", score: 0.9, gate: { status: "blocked" } },
      { templateId: "base:y", chain: "base", strategyId: "strategy-base", score: 0.7, gate: { status: "promotable" }, allocationGate: { status: "review_only" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 500,
    diversificationPolicy: null,
  });
  // blocked dropped, review_only kept.
  assert.equal(result.perStrategy.length, 1);
  assert.equal(result.perStrategy[0].chain, "base");
  // capped at 200 (perChainUsd).
  assert.equal(result.perStrategy[0].allocationUsd, 200);
});

test("scored-target aggregates per-chain settlement targets across multiple strategies", () => {
  const promotionGate = {
    items: [
      { templateId: "base:a", chain: "base", score: 0.5, strategyId: "strategy-base", gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "base:b", chain: "base", score: 0.5, strategyId: "strategy-base", gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 800,
    diversificationPolicy: null,
  });
  assert.equal(result.perChain.length, 1);
  assert.equal(result.perChain[0].chain, "base");
  // each item capped at 200 (strategy-base cap), residual stays unallocated since no other chain.
  // sum = 400.
  assert.equal(result.perChain[0].settlementTargetUsd, 400);
});
