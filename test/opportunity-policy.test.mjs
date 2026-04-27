import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateOpportunityPolicy } from "../src/executor/policy/opportunity-policy.mjs";

function makeIntent(overrides = {}) {
  return {
    strategyId: "test-strat",
    kind: "capital_deploy",
    chain: "base",
    protocol: "morpho",
    opportunityId: "opp1",
    amountUsd: 100,
    sharePct: 0.1,
    unwindPlan: {
      steps: [{ chain: "bitcoin", action: "settle" }],
    },
    quote: { observedAt: new Date().toISOString() },
    ...overrides,
  };
}

test("evaluateOpportunityPolicy ALLOW when all clean", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent(),
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.length, 0);
});

test("evaluateOpportunityPolicy BLOCK on kill switch", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent(),
    killSwitchPath: "/tmp/kill.switch",
    killSwitchExistsImpl: async () => true,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("kill_switch_present"));
});

test("evaluateOpportunityPolicy BLOCK on missing unwindPlan", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({ unwindPlan: null }),
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("missing_unwind_plan"));
});

test("evaluateOpportunityPolicy BLOCK on stale quote", async () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({ quote: { observedAt: old } }),
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("quote_stale"));
});

test("evaluateOpportunityPolicy BLOCK on concentration exceeded", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({ sharePct: 0.6 }),
    currentAllocations: {
      chainSharePct: { base: 0.1 },
    },
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.some((b) => b.includes("concentration_exceeded")));
});

test("evaluateOpportunityPolicy BLOCK on position below minPositionUsd", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({ amountUsd: 5 }),
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("position_below_min_position_usd"));
});

test("evaluateOpportunityPolicy BLOCK on position above maxSinglePositionPct", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({ amountUsd: 300 }),
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("position_above_max_single_position_pct"));
});

test("evaluateOpportunityPolicy BLOCK on exit rule triggered", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent(),
    activePositions: [
      { opportunityId: "active1", entryAprPct: 10, aprPct: 3, tvlUsd: 1_000_000 },
    ],
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.some((b) => b.startsWith("exit_rule_triggered:")));
});

test("evaluateOpportunityPolicy passes for non-capital-deploy without unwindPlan", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({ kind: "capital_rebalance", unwindPlan: null }),
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "ALLOW");
});
