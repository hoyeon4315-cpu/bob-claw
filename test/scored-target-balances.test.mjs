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
  // Unscored candidates are explore samples, not full exploit allocations.
  const base = result.perStrategy.find((s) => s.chain === "base");
  assert.equal(base.allocationBucket, "explore");
  assert.equal(base.allocationUsd, 10);
  assert.ok(result.summary.totalAllocationUsd <= 30);
  assert.equal(result.summary.priorScoreCandidateCount, 3);
  assert.equal(result.summary.exploreCandidateCount, 3);
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

test("infers promotion score family from strategy exposure when familyId is absent", () => {
  const caps = [
    {
      strategyId: "stable-carry",
      autoExecute: true,
      exposure: { assetFamily: "stablecoin" },
      caps: { perChainUsd: { base: 1000 } },
    },
    {
      strategyId: "unscored",
      autoExecute: true,
      caps: { perChainUsd: { bsc: 1000 } },
    },
  ];
  const promotionGate = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        score: 0.8,
        allocationGate: { status: "allocation_ready" },
      },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: caps,
    totalCapitalUsd: 900,
    diversificationPolicy: null,
  });
  const stable = result.perStrategy.find((s) => s.strategyId === "stable-carry");
  const unscored = result.perStrategy.find((s) => s.strategyId === "unscored");
  assert.equal(stable.score, 0.8);
  assert.equal(stable.allocationGateStatus, "allocation_ready");
  assert.ok(stable.allocationUsd > unscored.allocationUsd);
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

test("honors evidence-primary per-chain override while default chain cap stays lower", () => {
  const caps = [
    { strategyId: "base-primary", familyId: "base-family", autoExecute: true, caps: { perChainUsd: { base: 1000 } } },
    { strategyId: "bsc-secondary", familyId: "bsc-family", autoExecute: true, caps: { perChainUsd: { bsc: 1000 } } },
  ];
  const promotionGate = {
    items: [
      { templateId: "base:base-family", chain: "base", familyId: "base-family", score: 0.9, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:bsc-family", chain: "bsc", familyId: "bsc-family", score: 0.1, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: caps,
    totalCapitalUsd: 1000,
    diversificationPolicy: {
      perStrategyMaxShare: 1,
      perChainMaxShare: 0.35,
      perChainMaxShareByChain: { base: 0.70 },
    },
  });

  const base = result.perChain.find((item) => item.chain === "base");
  const bsc = result.perChain.find((item) => item.chain === "bsc");
  assert.equal(base.settlementTargetUsd, 700);
  assert.equal(bsc.settlementTargetUsd, 100);
});

test("keeps non-primary chains on the default per-chain cap", () => {
  const caps = [
    { strategyId: "base-secondary", familyId: "base-family", autoExecute: true, caps: { perChainUsd: { base: 1000 } } },
    { strategyId: "bsc-secondary", familyId: "bsc-family", autoExecute: true, caps: { perChainUsd: { bsc: 1000 } } },
  ];
  const promotionGate = {
    items: [
      { templateId: "base:base-family", chain: "base", familyId: "base-family", score: 0.1, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:bsc-family", chain: "bsc", familyId: "bsc-family", score: 0.9, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: caps,
    totalCapitalUsd: 1000,
    diversificationPolicy: {
      perStrategyMaxShare: 1,
      perChainMaxShare: 0.35,
      perChainMaxShareByChain: { base: 0.70 },
    },
  });

  const base = result.perChain.find((item) => item.chain === "base");
  const bsc = result.perChain.find((item) => item.chain === "bsc");
  assert.equal(base.settlementTargetUsd, 100);
  assert.equal(bsc.settlementTargetUsd, 350);
});

test("uses chain score ledger and exposes score-source metadata", () => {
  const caps = [
    { strategyId: "base-ledger", familyId: "family-base", autoExecute: true, caps: { perChainUsd: { base: 1000 } } },
    { strategyId: "bsc-ledger", familyId: "family-bsc", autoExecute: true, caps: { perChainUsd: { "BNB Chain": 1000 } } },
  ];
  const result = buildScoredTargetBalances({
    promotionGate: { items: [] },
    strategyCaps: caps,
    totalCapitalUsd: 1000,
    diversificationPolicy: null,
    chainScoreLedger: {
      byChain: {
        base: {
          chainScore: 0.25,
          scoreSource: "ledger",
          widePosterior: true,
          blockers: ["receipt_loss"],
        },
        bsc: {
          chainScore: 0.85,
          scoreSource: "ledger",
          widePosterior: false,
          blockers: [],
        },
      },
    },
  });

  const base = result.perStrategy.find((item) => item.strategyId === "base-ledger");
  const bsc = result.perStrategy.find((item) => item.strategyId === "bsc-ledger");
  assert.equal(bsc.chain, "bsc");
  assert.equal(base.chainScore, 0.25);
  assert.equal(base.chainScoreSource, "ledger");
  assert.equal(base.widePosterior, true);
  assert.deepEqual(base.chainScoreBlockers, ["receipt_loss"]);
  assert.equal(bsc.chainScore, 0.85);
  assert.equal(bsc.chainScoreSource, "ledger");
  assert.ok(bsc.allocationUsd > base.allocationUsd);
});

test("splits exploit and explore budget while clamping prior-score exploration", () => {
  const caps = [
    { strategyId: "base-ledger", familyId: "family-base", autoExecute: true, caps: { perChainUsd: { base: 1000 } } },
    { strategyId: "sei-prior", familyId: "family-sei", autoExecute: true, caps: { perChainUsd: { sei: 1000 } } },
  ];
  const result = buildScoredTargetBalances({
    promotionGate: { items: [] },
    strategyCaps: caps,
    totalCapitalUsd: 500,
    diversificationPolicy: null,
    chainScoreLedger: {
      byChain: {
        base: {
          chainScore: 0.8,
          scoreSource: "ledger",
          widePosterior: false,
          sampleCount: 45,
          receiptFreshnessHours: 2,
          blockers: [],
        },
        sei: {
          chainScore: 0.35,
          scoreSource: "prior",
          widePosterior: true,
          sampleCount: 0,
          receiptFreshnessHours: null,
          blockers: ["chain_score_unobserved"],
        },
      },
    },
  });

  const base = result.perStrategy.find((item) => item.strategyId === "base-ledger");
  const sei = result.perStrategy.find((item) => item.strategyId === "sei-prior");
  assert.equal(base.allocationBucket, "exploit");
  assert.equal(sei.allocationBucket, "explore");
  assert.equal(sei.allocationUsd, 6);
  assert.equal(result.summary.exploreAllocationUsd, 6);
  assert.equal(result.summary.exploitAllocationUsd, 494);
});

test("scored target balances canonicalizes allowed chain aliases and keeps cost-only ledgers in explore", () => {
  const result = buildScoredTargetBalances({
    promotionGate: { items: [] },
    strategyCaps: [
      { strategyId: "bsc-cost-only", familyId: "family-bsc", autoExecute: true, caps: { perChainUsd: { bsc: 1000 } } },
    ],
    totalCapitalUsd: 500,
    diversificationPolicy: null,
    allowedChains: ["BNB Chain"],
    chainScoreLedger: {
      byChain: {
        bsc: {
          chainScore: 0.9,
          scoreSource: "ledger",
          widePosterior: false,
          sampleCount: 40,
          alphaSampleCount: 0,
          receiptFreshnessHours: 1,
          blockers: [],
        },
      },
    },
  });

  assert.equal(result.perStrategy.length, 1);
  assert.equal(result.perStrategy[0].chain, "bsc");
  assert.equal(result.perStrategy[0].allocationBucket, "explore");
  assert.equal(result.perStrategy[0].allocationUsd, 6);
});
