import test from "node:test";
import assert from "node:assert/strict";
import { buildDestinationAllocationPlanner } from "../src/strategy/destination-allocation-planner.mjs";

test("destination allocation planner distributes budget across multiple candidates by score weight", () => {
  const promotionGate = {
    items: [
      {
        templateId: "base:a",
        chain: "base",
        familyId: "fam-a",
        label: "A",
        score: 0.75,
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready" },
      },
      {
        templateId: "bsc:b",
        chain: "bsc",
        familyId: "fam-b",
        label: "B",
        score: 0.25,
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready" },
      },
    ],
  };
  const economics = {
    budgets: { activeBudgetUsd: 1000, planningBudgetUsd: 4000 },
    items: [
      { templateId: "base:a", activeBudgetEstimate: { passesPolicy: true }, planningBudgetEstimate: { passesPolicy: true } },
      { templateId: "bsc:b", activeBudgetEstimate: { passesPolicy: true }, planningBudgetEstimate: { passesPolicy: true } },
    ],
  };
  const report = buildDestinationAllocationPlanner({ promotionGate, economics });
  assert.equal(report.activePlan.length, 2);
  const a = report.activePlan.find((x) => x.templateId === "base:a");
  const b = report.activePlan.find((x) => x.templateId === "bsc:b");
  assert.ok(Math.abs(a.allocationUsd - 750) < 0.001);
  assert.ok(Math.abs(b.allocationUsd - 250) < 0.001);
  const total = a.allocationUsd + b.allocationUsd;
  assert.ok(total <= 1000 + 1e-6);
});

test("destination allocation planner clips per-item by maxAllocationUsd estimate cap", () => {
  const promotionGate = {
    items: [
      {
        templateId: "base:a",
        chain: "base",
        score: 1.0,
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready" },
      },
      {
        templateId: "bsc:b",
        chain: "bsc",
        score: 0.5,
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready" },
      },
    ],
  };
  const economics = {
    budgets: { activeBudgetUsd: 1000, planningBudgetUsd: 0 },
    items: [
      {
        templateId: "base:a",
        activeBudgetEstimate: { passesPolicy: true, maxAllocationUsd: 100 },
        planningBudgetEstimate: { passesPolicy: true },
      },
      {
        templateId: "bsc:b",
        activeBudgetEstimate: { passesPolicy: true, maxAllocationUsd: 50 },
        planningBudgetEstimate: { passesPolicy: true },
      },
    ],
  };
  const report = buildDestinationAllocationPlanner({ promotionGate, economics });
  const a = report.activePlan.find((x) => x.templateId === "base:a");
  const b = report.activePlan.find((x) => x.templateId === "bsc:b");
  assert.equal(a.allocationUsd, 100);
  assert.equal(b.allocationUsd, 50);
});

test("destination allocation planner separates exploit and capped explore allocations", () => {
  const promotionGate = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        score: 0.8,
        scoreSource: "ledger",
        receiptSummary: { sampleCount: 40, receiptFreshnessHours: 2 },
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready" },
      },
      {
        templateId: "sei:unknown_campaign",
        chain: "sei",
        familyId: "unknown_campaign",
        label: "Unknown campaign",
        score: 0.5,
        scoreSource: "prior",
        receiptSummary: { sampleCount: 0, receiptFreshnessHours: null },
        gate: { status: "promotable" },
        allocationGate: { status: "allocation_ready" },
      },
    ],
  };
  const economics = {
    budgets: { activeBudgetUsd: 200, planningBudgetUsd: 0 },
    items: [
      { templateId: "base:stablecoin_lending_carry", activeBudgetEstimate: { passesPolicy: true } },
      { templateId: "sei:unknown_campaign", activeBudgetEstimate: { passesPolicy: true } },
    ],
  };

  const report = buildDestinationAllocationPlanner({ promotionGate, economics });
  const exploit = report.activePlan.find((item) => item.templateId === "base:stablecoin_lending_carry");
  const explore = report.activePlan.find((item) => item.templateId === "sei:unknown_campaign");

  assert.equal(exploit.allocationBucket, "exploit");
  assert.equal(explore.allocationBucket, "explore");
  assert.equal(explore.allocationUsd, 6);
  assert.equal(report.summary.exploreAllocationUsd, 6);
  assert.equal(report.summary.exploitAllocationUsd, 194);
  assert.equal(report.summary.priorScoreCandidateCount, 1);
});
