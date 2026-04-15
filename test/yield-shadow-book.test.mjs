import assert from "node:assert/strict";
import { test } from "node:test";
import { buildYieldShadowBook, summarizeYieldShadowBook } from "../src/ledger/yield-shadow-book.mjs";

function pivotPlanFixture() {
  return {
    generatedAt: "2026-04-14T00:23:18.261Z",
    currentSystem: {
      riskBudgetUsd: 300,
    },
    budgetAssessment: {
      currentBudgetUsd: 300,
      budgetScenarios: [
        { budgetUsd: 300, label: "current_live_ring", planningOnly: false },
        { budgetUsd: 1000, label: "planning_scenario_1000", planningOnly: true },
      ],
    },
    pivots: [
      {
        id: "gateway_base_btc_yield",
        label: "Gateway-funded BTC yield on Base",
        blockers: [
          "external_reference_only",
          "llm_execution_path_not_allowed",
          "yield_source_feed_not_integrated",
        ],
        nextStep: {
          code: "build_deterministic_yield_shadow_book",
          label: "build deterministic yield shadow book",
          command: null,
        },
        evidence: {
          source: {
            repo: "bob-collective/btc-yield-bot",
          },
          defaults: {
            rebalanceIntervalHours: 6,
            usdcSplitPercent: 70,
            minSwapAmountUsd: 100,
            maxVaultAllocationPercent: 50,
            gasReserveUsdc: 5,
          },
        },
        capitalGuidance: {
          researchPilotMinimumUsd: 105,
          diversifiedSingleSleeveMinimumUsd: 205,
          defaultDualSleeveMinimumUsd: 338.33,
        },
      },
    ],
  };
}

test("yield shadow book converts the yield pivot into paper profiles with budget checks", () => {
  const book = buildYieldShadowBook({ pivotPlan: pivotPlanFixture(), scenarioAprBps: [500] });

  assert.equal(book.bookStatus, "pre_execution_only");
  assert.equal(book.summary.profileCount, 3);
  assert.equal(book.summary.withinBudgetCount, 2);

  const pilot = book.profiles.find((item) => item.id === "research_pilot");
  assert.ok(pilot);
  assert.equal(pilot.status, "paper_ready_within_budget");
  assert.equal(pilot.capitalRequiredUsd, 105);
  assert.equal(pilot.reserveUsd, 5);
  assert.equal(pilot.sleeveCount, 1);
   assert.equal(pilot.budgetScenarios.find((item) => item.budgetUsd === 300).fitsBudget, true);
  assert.equal(Number(pilot.pnl.paper.scenarios[0].oneDayUsd.toFixed(6)), 0.013699);

  const defaultSplit = book.profiles.find((item) => item.id === "default_dual_sleeve");
  assert.ok(defaultSplit);
  assert.equal(defaultSplit.status, "budget_expansion_required");
  assert.equal(defaultSplit.budgetGapUsd, 38.33);
  assert.equal(defaultSplit.sleeves.length, 2);
  assert.equal(defaultSplit.sleeves[0].allocationUsd, 233.33);
  assert.equal(defaultSplit.sleeves[1].allocationUsd, 100);
  assert.equal(defaultSplit.budgetScenarios.find((item) => item.budgetUsd === 300).fitsBudget, false);
  assert.equal(defaultSplit.budgetScenarios.find((item) => item.budgetUsd === 1000).fitsBudget, true);
  assert.equal(book.budgetScenarios.find((item) => item.budgetUsd === 1000).readyProfileCount, 3);
});

test("yield shadow book summary exposes the top paper profile and base scenario accrual", () => {
  const summary = summarizeYieldShadowBook(buildYieldShadowBook({ pivotPlan: pivotPlanFixture(), scenarioAprBps: [300, 500] }));

  assert.equal(summary.currentBudgetUsd, 300);
  assert.equal(summary.budgetScenarios.length, 2);
  assert.equal(summary.topProfile.id, "research_pilot");
  assert.equal(summary.topProfile.capitalRequiredUsd, 105);
  assert.equal(summary.topProfile.budgetScenarios.find((item) => item.budgetUsd === 1000).fitsBudget, true);
  assert.equal(Number(summary.topProfile.paperDailyBaseScenarioUsd.toFixed(6)), 0.013699);
  assert.equal(Number(summary.topProfile.paperThirtyDayBaseScenarioUsd.toFixed(6)), 0.410959);
});
