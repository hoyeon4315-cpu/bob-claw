import test from "node:test";
import assert from "node:assert/strict";
import { buildBootstrapFromBtcReport } from "../src/cli/run-bootstrap-from-btc.mjs";

const STRATEGY_CAPS = [
  {
    strategyId: "strategy-base",
    autoExecute: true,
    caps: { perChainUsd: { base: 500 } },
    gasFloat: { base: { minUsd: 0, targetUsd: 0 } },
  },
  {
    strategyId: "strategy-bsc",
    autoExecute: true,
    caps: { perChainUsd: { bsc: 500 } },
    gasFloat: { bsc: { minUsd: 0, targetUsd: 0 } },
  },
  {
    strategyId: "strategy-unichain",
    autoExecute: true,
    caps: { perChainUsd: { unichain: 500 } },
    gasFloat: { unichain: { minUsd: 0, targetUsd: 0 } },
  },
];

test("bootstrap-from-btc with empty balances emits a refill action per scored chain", () => {
  const promotionGate = {
    items: [
      { templateId: "base:a", chain: "base", strategyId: "strategy-base", score: 0.5, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:b", chain: "bsc", strategyId: "strategy-bsc", score: 0.3, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "unichain:c", chain: "unichain", strategyId: "strategy-unichain", score: 0.2, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const report = buildBootstrapFromBtcReport({
    promotionGate,
    totalCapitalUsd: 1000,
    strategyCaps: STRATEGY_CAPS,
    balancesByChain: {},
    diversificationPolicy: null,
  });
  assert.equal(report.decision, "REBALANCE_REQUIRED");
  const refills = report.rebalancePlan.actions.filter((a) => a.type === "capital_rebalance");
  assert.equal(refills.length, 3);
  const chains = refills.map((a) => a.chain).sort();
  assert.deepEqual(chains, ["base", "bsc", "unichain"]);
  const totalAlloc = report.rebalancePlan.actions
    .filter((a) => a.type === "capital_rebalance")
    .reduce((sum, a) => sum + (a.amountUsd || 0), 0);
  assert.ok(totalAlloc <= 1000 + 1e-6);
  assert.ok(Math.abs(totalAlloc - 1000) < 0.001, "score-weighted total should match capital");
});

test("bootstrap-from-btc with diversification cap leaves residual buffer", () => {
  const promotionGate = {
    items: [
      { templateId: "base:a", chain: "base", strategyId: "strategy-base", score: 0.5, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:b", chain: "bsc", strategyId: "strategy-bsc", score: 0.3, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "unichain:c", chain: "unichain", strategyId: "strategy-unichain", score: 0.2, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const report = buildBootstrapFromBtcReport({
    promotionGate,
    totalCapitalUsd: 1000,
    strategyCaps: STRATEGY_CAPS,
    balancesByChain: {},
    // default DIVERSIFICATION_POLICY: perStrategyMaxShare=0.25
  });
  const totalAlloc = report.rebalancePlan.actions
    .filter((a) => a.type === "capital_rebalance")
    .reduce((sum, a) => sum + (a.amountUsd || 0), 0);
  // water-fill: base 500→cap 250, bsc 300→cap 250, unichain 200 + residual 100 → cap 250.
  // All three saturate the 0.25*1000=250 perStrategyCap. Sum=750.
  assert.ok(Math.abs(totalAlloc - 750) < 0.001, `expected 750 with diversification cap + water-fill, got ${totalAlloc}`);
});

test("bootstrap-from-btc with total weight zero emits capped explore samples", () => {
  const report = buildBootstrapFromBtcReport({
    promotionGate: { items: [] },
    totalCapitalUsd: 600,
    strategyCaps: STRATEGY_CAPS,
    balancesByChain: {},
    diversificationPolicy: null,
  });
  const refills = report.rebalancePlan.actions.filter((a) => a.type === "capital_rebalance");
  // candidate set = autoExecute strategies (3), but prior-only chains are
  // explore samples and do not receive a full equal-split bootstrap target.
  assert.equal(refills.length, 3);
  for (const refill of refills) {
    assert.ok(Math.abs(refill.amountUsd - 10) < 0.001);
  }
  assert.equal(report.scoredTargets.summary.exploreAllocationUsd, 30);
  assert.equal(report.scoredTargets.summary.priorScoreCandidateCount, 3);
});

test("bootstrap-from-btc uses receipt-driven chain score ledger when provided", () => {
  const report = buildBootstrapFromBtcReport({
    promotionGate: { items: [] },
    totalCapitalUsd: 600,
    strategyCaps: STRATEGY_CAPS,
    balancesByChain: {},
    diversificationPolicy: null,
    chainScoreLedger: {
      byChain: {
        base: { chainScore: 0.2, scoreSource: "ledger", widePosterior: false, sampleCount: 40, alphaSampleCount: 40, receiptFreshnessHours: 1, blockers: [] },
        bsc: { chainScore: 0.9, scoreSource: "ledger", widePosterior: false, sampleCount: 40, alphaSampleCount: 40, receiptFreshnessHours: 1, blockers: [] },
        unichain: { chainScore: 0.1, scoreSource: "prior", widePosterior: true, sampleCount: 0, alphaSampleCount: 0, receiptFreshnessHours: null, blockers: ["chain_score_unobserved"] },
      },
    },
  });

  const bsc = report.scoredTargets.perStrategy.find((item) => item.strategyId === "strategy-bsc");
  const base = report.scoredTargets.perStrategy.find((item) => item.strategyId === "strategy-base");
  assert.equal(bsc.chainScoreSource, "ledger");
  assert.ok(bsc.allocationUsd > base.allocationUsd);
  assert.equal(report.scoredTargets.summary.priorScoreCandidateCount, 1);
});

test("bootstrap-from-btc returns TOTAL_CAPITAL_UNDEFINED when no capital provided", () => {
  const report = buildBootstrapFromBtcReport({
    promotionGate: { items: [] },
    totalCapitalUsd: 0,
  });
  assert.equal(report.decision, "TOTAL_CAPITAL_UNDEFINED");
  assert.equal(report.rebalancePlan, null);
});
