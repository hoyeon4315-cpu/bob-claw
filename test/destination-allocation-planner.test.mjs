import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationAllocationPlanner } from "../src/strategy/destination-allocation-planner.mjs";

test("destination allocation planner stays empty when no items are promotable", () => {
  const promotionGate = {
    summary: {
      topBlockers: [{ blocker: "allowlist_decision_missing", count: 10 }],
    },
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        gate: { status: "blocked" },
      },
    ],
  };

  const economics = {
    budgets: {
      activeBudgetUsd: 300,
      planningBudgetUsd: 1000,
    },
    items: [],
  };

  const report = buildDestinationAllocationPlanner({ promotionGate, economics });

  assert.equal(report.summary.promotableCount, 0);
  assert.equal(report.summary.activeAllocationCount, 0);
  assert.equal(report.summary.planningAllocationCount, 0);
  assert.equal(report.summary.activeBudgetRemainingUsd, 300);
  assert.equal(report.summary.planningBudgetRemainingUsd, 1000);
});

test("destination allocation planner allocates promotable policy-passing items", () => {
  const promotionGate = {
    summary: {
      topBlockers: [],
      topAllocationBlockers: [],
    },
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        score: 0.66,
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready", blockers: [] },
      },
    ],
  };

  const economics = {
    budgets: {
      activeBudgetUsd: 300,
      planningBudgetUsd: 1000,
    },
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        activeBudgetEstimate: { passesPolicy: true },
        planningBudgetEstimate: { passesPolicy: true },
      },
    ],
  };

  const report = buildDestinationAllocationPlanner({ promotionGate, economics });

  assert.equal(report.summary.promotableCount, 1);
  assert.equal(report.summary.allocationReadyCount, 1);
  assert.equal(report.summary.activeAllocationCount, 1);
  assert.equal(report.summary.planningAllocationCount, 1);
});

test("destination allocation planner separates report generatedAt from stale source timestamps", () => {
  const report = buildDestinationAllocationPlanner({
    now: "2026-05-08T12:45:00.000Z",
    promotionGate: {
      generatedAt: "2026-04-14T09:09:49.467Z",
      summary: { topBlockers: [], topAllocationBlockers: [] },
      items: [],
    },
    economics: {
      generatedAt: "2026-04-15T00:00:00.000Z",
      budgets: { activeBudgetUsd: 300, planningBudgetUsd: null },
      items: [],
    },
    chainScoreLedger: {
      generatedAt: "2026-05-08T12:44:00.000Z",
      byChain: {},
    },
  });

  assert.equal(report.generatedAt, "2026-05-08T12:45:00.000Z");
  assert.equal(report.sources.promotionGateGeneratedAt, "2026-04-14T09:09:49.467Z");
  assert.equal(report.sources.economicsGeneratedAt, "2026-04-15T00:00:00.000Z");
  assert.equal(report.sources.chainScoreLedgerGeneratedAt, "2026-05-08T12:44:00.000Z");
});

test("destination allocation planner uses receipt ledger score metadata and canonical chains", () => {
  const promotionGate = {
    summary: { topBlockers: [], topAllocationBlockers: [] },
    items: [
      {
        templateId: "bnb:stablecoin_lending_carry",
        chain: "BNB Chain",
        familyId: "stablecoin_lending_carry",
        label: "BSC carry",
        score: 0.1,
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready", blockers: [] },
      },
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Base carry",
        score: 0.9,
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready", blockers: [] },
      },
    ],
  };
  const economics = {
    budgets: { activeBudgetUsd: 300, planningBudgetUsd: 300 },
    items: [
      { templateId: "bnb:stablecoin_lending_carry", activeBudgetEstimate: { passesPolicy: true }, planningBudgetEstimate: { passesPolicy: true } },
      { templateId: "base:stablecoin_lending_carry", activeBudgetEstimate: { passesPolicy: true }, planningBudgetEstimate: { passesPolicy: true } },
    ],
  };

  const report = buildDestinationAllocationPlanner({
    promotionGate,
    economics,
    chainScoreLedger: {
      byChain: {
        bsc: { chainScore: 0.9, scoreSource: "ledger", widePosterior: false, sampleCount: 40, alphaSampleCount: 40, receiptFreshnessHours: 1, blockers: [] },
        base: { chainScore: 0.2, scoreSource: "ledger", widePosterior: false, sampleCount: 40, alphaSampleCount: 40, receiptFreshnessHours: 1, blockers: [] },
      },
    },
  });

  const bsc = report.activePlan.find((item) => item.templateId === "bnb:stablecoin_lending_carry");
  const base = report.activePlan.find((item) => item.templateId === "base:stablecoin_lending_carry");
  assert.equal(bsc.chain, "bsc");
  assert.equal(bsc.scoreSource, "ledger");
  assert.equal(bsc.chainScore, 0.9);
  assert.ok(bsc.allocationUsd > base.allocationUsd);
});

test("destination allocation planner keeps review-only promotable items out of allocations", () => {
  const promotionGate = {
    summary: {
      topBlockers: [],
      topAllocationBlockers: [{ blocker: "allocation_grossReturnBps_recheck_required", count: 1 }],
    },
    items: [
      {
        templateId: "base:stablecoin_lp_or_basis",
        chain: "base",
        familyId: "stablecoin_lp_or_basis",
        label: "Stablecoin LP or basis deployment",
        score: 0.6,
        gate: { status: "promotable" },
        allocationGate: {
          status: "review_only",
          blockers: ["allocation_grossReturnBps_recheck_required"],
          nextAction: {
            code: "collect_repeat_observations",
            command:
              "node src/cli/add-destination-economics-observation.mjs --template-id=base:stablecoin_lp_or_basis --field=grossReturnBps --value=<value> --source-name='<sourceName>' --source-type=<sourceType> --observed-at=<observedAt> --note='<note>' --write && npm run sync:destination-economics-observations -- --write",
          },
        },
      },
    ],
  };

  const economics = {
    budgets: {
      activeBudgetUsd: 300,
      planningBudgetUsd: 1000,
    },
    items: [
      {
        templateId: "base:stablecoin_lp_or_basis",
        activeBudgetEstimate: { passesPolicy: true, estimatedNetBps: 1258.74, estimatedNetUsd: 37.7622 },
        planningBudgetEstimate: { passesPolicy: true, estimatedNetBps: 1258.74, estimatedNetUsd: 125.874 },
      },
    ],
  };

  const report = buildDestinationAllocationPlanner({ promotionGate, economics });

  assert.equal(report.summary.promotableCount, 1);
  assert.equal(report.summary.allocationReadyCount, 0);
  assert.equal(report.summary.reviewOnlyCount, 1);
  assert.equal(report.summary.activeAllocationCount, 0);
  assert.equal(report.summary.topReviewOnly[0].templateId, "base:stablecoin_lp_or_basis");
});

test("destination allocation planner keeps missing allocation gates out of allocations", () => {
  const promotionGate = {
    summary: {
      topBlockers: [],
      topAllocationBlockers: [],
    },
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        score: 0.66,
        gate: { status: "promotable" },
      },
    ],
  };

  const economics = {
    budgets: {
      activeBudgetUsd: 300,
      planningBudgetUsd: 1000,
    },
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        activeBudgetEstimate: { passesPolicy: true },
        planningBudgetEstimate: { passesPolicy: true },
      },
    ],
  };

  const report = buildDestinationAllocationPlanner({ promotionGate, economics });

  assert.equal(report.summary.promotableCount, 1);
  assert.equal(report.summary.allocationReadyCount, 0);
  assert.equal(report.summary.reviewOnlyCount, 1);
  assert.equal(report.summary.activeAllocationCount, 0);
  assert.equal(report.summary.planningAllocationCount, 0);
  assert.deepEqual(report.summary.topReviewOnly[0].blockers, ["allocation_gate_missing"]);
});
