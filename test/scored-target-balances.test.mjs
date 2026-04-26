import test from "node:test";
import assert from "node:assert/strict";
import { buildScoredTargetBalances } from "../src/executor/capital/scored-target-balances.mjs";

const FIXTURE_CAPS = [
  { strategyId: "strategy-base", familyId: "family-base", autoExecute: true, caps: { perChainUsd: { base: 200 } } },
  { strategyId: "strategy-bsc", familyId: "family-bsc", autoExecute: true, caps: { perChainUsd: { bsc: 1000 } } },
  { strategyId: "strategy-unichain", familyId: "family-unichain", autoExecute: true, caps: { perChainUsd: { unichain: 1000 } } },
];

test("water-fills cap residual to remaining autoExecute candidates", () => {
  const promotionGate = {
    items: [
      { templateId: "base:family-base", chain: "base", familyId: "family-base", score: 0.6, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:family-bsc", chain: "bsc", familyId: "family-bsc", score: 0.4, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 1000,
    diversificationPolicy: null,
  });
  assert.equal(result.perStrategy.length, 3, "all autoExecute candidates included");
  const base = result.perStrategy.find((s) => s.chain === "base");
  const bsc = result.perStrategy.find((s) => s.chain === "bsc");
  const uni = result.perStrategy.find((s) => s.chain === "unichain");
  assert.equal(base.allocationUsd, 200);
  assert.ok(bsc.allocationUsd > 0);
  assert.ok(uni.allocationUsd > 0, "unscored autoExecute chain still gets a slice");
  assert.ok(Math.abs(result.summary.totalAllocationUsd - 1000) < 0.01);
});

test("enforces diversification per-strategy cap with redistribution", () => {
  const promotionGate = {
    items: [
      { templateId: "base:family-base", chain: "base", familyId: "family-base", score: 0.6, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:family-bsc", chain: "bsc", familyId: "family-bsc", score: 0.4, allocationGate: { status: "allocation_ready" } },
      { templateId: "unichain:family-unichain", chain: "unichain", familyId: "family-unichain", score: 0.4, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 1000,
  });
  const base = result.perStrategy.find((s) => s.chain === "base");
  const bsc = result.perStrategy.find((s) => s.chain === "bsc");
  const uni = result.perStrategy.find((s) => s.chain === "unichain");
  assert.equal(base.allocationUsd, 200);
  assert.ok(Math.abs(bsc.allocationUsd - 250) < 0.001);
  assert.ok(Math.abs(uni.allocationUsd - 250) < 0.001);
});

test("falls back to equal split when no scores at all", () => {
  const result = buildScoredTargetBalances({
    promotionGate: { items: [] },
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 600,
    diversificationPolicy: null,
  });
  assert.equal(result.perStrategy.length, 3);
  // 3 unscored candidates with equal weight → equal split, but base capped at 200.
  // residual goes to bsc + uni evenly.
  const base = result.perStrategy.find((s) => s.chain === "base");
  assert.equal(base.allocationUsd, 200);
  assert.ok(Math.abs(result.summary.totalAllocationUsd - 600) < 0.01);
});

test("review_only candidates contribute at reduced weight", () => {
  const promotionGate = {
    items: [
      { templateId: "base:family-base", chain: "base", familyId: "family-base", score: 0.7, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:family-bsc", chain: "bsc", familyId: "family-bsc", score: 0.7, allocationGate: { status: "review_only" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: FIXTURE_CAPS,
    totalCapitalUsd: 1000,
    diversificationPolicy: null,
    reducedWeightFactor: 0.3,
  });
  assert.equal(result.perStrategy.length, 3);
  const base = result.perStrategy.find((s) => s.chain === "base");
  assert.equal(base.allocationUsd, 200);
  const bsc = result.perStrategy.find((s) => s.chain === "bsc");
  const uni = result.perStrategy.find((s) => s.chain === "unichain");
  assert.ok(bsc.allocationUsd > uni.allocationUsd, "review_only with score beats unscored");
});

test("autoExecute=false strategies are excluded", () => {
  const caps = [
    { strategyId: "on", familyId: "family-on", autoExecute: true, caps: { perChainUsd: { base: 1000 } } },
    { strategyId: "off", familyId: "family-off", autoExecute: false, caps: { perChainUsd: { bsc: 1000 } } },
  ];
  const result = buildScoredTargetBalances({
    promotionGate: { items: [] },
    strategyCaps: caps,
    totalCapitalUsd: 500,
    diversificationPolicy: null,
  });
  assert.equal(result.perStrategy.length, 1);
  assert.equal(result.perStrategy[0].chain, "base");
});

test("aggregates per-chain across multiple strategies on same chain", () => {
  const caps = [
    { strategyId: "a", familyId: "fa", autoExecute: true, caps: { perChainUsd: { base: 200 } } },
    { strategyId: "b", familyId: "fb", autoExecute: true, caps: { perChainUsd: { base: 200 } } },
  ];
  const promotionGate = {
    items: [
      { templateId: "base:fa", chain: "base", familyId: "fa", score: 0.5, allocationGate: { status: "allocation_ready" } },
      { templateId: "base:fb", chain: "base", familyId: "fb", score: 0.5, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: caps,
    totalCapitalUsd: 800,
    diversificationPolicy: null,
  });
  assert.equal(result.perChain.length, 1);
  assert.equal(result.perChain[0].chain, "base");
  assert.equal(result.perChain[0].settlementTargetUsd, 400);
});
