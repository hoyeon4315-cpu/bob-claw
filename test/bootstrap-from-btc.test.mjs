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
  // each strategy gets weight share clipped to 0.25*1000=250 (or its own cap, whichever is smaller).
  // base: weight 500→250, bsc: 300→250, unichain: 200→200. Sum=700.
  assert.ok(Math.abs(totalAlloc - 700) < 0.001, `expected 700 with diversification cap, got ${totalAlloc}`);
});

test("bootstrap-from-btc with total weight zero falls back to equal split", () => {
  const promotionGate = {
    items: [
      { templateId: "base:a", chain: "base", strategyId: "strategy-base", score: 0, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:b", chain: "bsc", strategyId: "strategy-bsc", score: 0, gate: { status: "promotable" }, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const report = buildBootstrapFromBtcReport({
    promotionGate,
    totalCapitalUsd: 600,
    strategyCaps: STRATEGY_CAPS,
    balancesByChain: {},
    diversificationPolicy: null,
  });
  const refills = report.rebalancePlan.actions.filter((a) => a.type === "capital_rebalance");
  assert.equal(refills.length, 2);
  for (const refill of refills) {
    assert.ok(Math.abs(refill.amountUsd - 300) < 0.001);
  }
});

test("bootstrap-from-btc returns TOTAL_CAPITAL_UNDEFINED when no capital provided", () => {
  const report = buildBootstrapFromBtcReport({
    promotionGate: { items: [] },
    totalCapitalUsd: 0,
  });
  assert.equal(report.decision, "TOTAL_CAPITAL_UNDEFINED");
  assert.equal(report.rebalancePlan, null);
});
