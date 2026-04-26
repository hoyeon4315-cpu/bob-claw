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

test("scored-target distributes capital weighted by score (no diversification)", () => {
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
  assert.equal(base.allocationUsd, 200);
  assert.ok(Math.abs(bsc.allocationUsd - 400) < 0.001);
  assert.ok(result.summary.totalAllocationUsd <= 1000 + 1e-6);
});

test("scored-target enforces diversification per-strategy and per-chain caps", () => {
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
  // strategy-base capped by perChainUsd=200 (tighter than 0.25*1000=250)
  assert.equal(base.allocationUsd, 200);
  // strategy-bsc weight share=400, capped by perStrategyMaxShare=250
  assert.ok(Math.abs(bsc.allocationUsd - 250) < 0.001);
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

test("scored-target returns empty plan when no allocation-ready items", () => {
  const promotionGate = {
    items: [
      { templateId: "bsc:x", chain: "bsc", score: 0.9, gate: { status: "blocked" } },
      { templateId: "base:y", chain: "base", score: 0.7, gate: { status: "promotable" }, allocationGate: { status: "review_only" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 500,
  });
  assert.equal(result.perStrategy.length, 0);
  assert.equal(result.perChain.length, 0);
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
  // each item gets 400 weight share, clipped to strategy-base cap=200 -> per-chain = 400
  assert.equal(result.perChain[0].settlementTargetUsd, 400);
});
