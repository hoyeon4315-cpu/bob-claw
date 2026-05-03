import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateOpportunityPolicy } from "../src/executor/policy/opportunity-policy.mjs";
import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../src/config/small-capital-campaign-mode.mjs";

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

test("evaluateOpportunityPolicy does not apply generic minPositionUsd to committed Merkl tiny canaries", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({
      intentType: "erc4626_deposit",
      executionReason: "merkl_canary_autopilot",
      amountUsd: 5,
    }),
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });

  assert.equal(result.blockers.includes("position_below_min_position_usd"), false);
});

test("evaluateOpportunityPolicy does not apply generic minPositionUsd to radar tiny canaries", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({
      intentType: "tiny_live_canary",
      executionReason: "radar_tiny_live_canary",
      amountUsd: 5,
    }),
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });

  assert.equal(result.blockers.includes("position_below_min_position_usd"), false);
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

test("evaluateOpportunityPolicy uses aggressive small-cap micro-test budget", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({
      strategyId: "base-micro-test-yo",
      amountUsd: 45,
      metadata: { microTest: true },
    }),
    capitalState: { totalDeployableCapital: 500 },
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.blockers.includes("micro_test_max_30usd"), false);
  assert.equal(result.blockers.includes("micro_test_cap_exceeded_6pct"), false);
});

test("evaluateOpportunityPolicy blocks micro-tests above aggressive small-cap budget", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({
      strategyId: "base-micro-test-yo",
      amountUsd: 55,
      metadata: { microTest: true },
    }),
    capitalState: { totalDeployableCapital: 500 },
    killSwitchExistsImpl: async () => false,
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("micro_test_max_50usd"));
  assert.ok(result.blockers.includes("micro_test_cap_exceeded_10pct"));
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

test("evaluateOpportunityPolicy does not treat generic deposit as capital movement", async () => {
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({
      chain: "bsc",
      intentType: "deposit",
      amountUsd: 25,
      displayedApr: 100,
      apr: 100,
      rewardTokenType: "stable",
      expectedHoldDays: 1,
      estimatedCostsUsd: 0,
      estimatedBridgeCostUsd: 0,
    }),
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });

  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("non_primary_entry_insufficient_expected_net"));
});

test("evaluateOpportunityPolicy does not apply non-primary entry floor to committed evidence-primary chains", async () => {
  const optimismPrimaryPolicy = {
    ...SMALL_CAPITAL_CAMPAIGN_MODE,
    chainSelection: {
      ...SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection,
      chainProfiles: {
        base: { ...SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection.chainProfiles.base, role: "candidate" },
        optimism: {
          role: "primary",
          maxSharePct: 0.70,
          evidenceStatus: "live_evidence_primary",
          evidenceSource: "test committed evidence",
          reviewBy: "2026-05-16",
        },
      },
    },
  };
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({
      chain: "optimism",
      intentType: "deposit",
      amountUsd: 25,
      displayedApr: 10,
      apr: 10,
      rewardTokenType: "stable",
      expectedHoldDays: 1,
      estimatedCostsUsd: 5,
      estimatedBridgeCostUsd: 0,
    }),
    smallCapitalPolicy: optimismPrimaryPolicy,
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });

  assert.equal(result.blockers.includes("non_primary_entry_insufficient_expected_net"), false);
});

test("evaluateOpportunityPolicy derives hold days from campaign end time before using fallback", async () => {
  const now = "2026-05-01T00:00:00.000Z";
  const result = await evaluateOpportunityPolicy({
    intent: makeIntent({
      chain: "base",
      amountUsd: 100,
      displayedApr: 365,
      apr: 365,
      rewardTokenType: "stable",
      campaignEndsAt: "2026-05-02T00:00:00.000Z",
      estimatedCostsUsd: 2,
    }),
    now,
    capitalState: { totalDeployableCapital: 1000 },
    killSwitchExistsImpl: async () => false,
  });

  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("negative_expected_realized_net"));
});
