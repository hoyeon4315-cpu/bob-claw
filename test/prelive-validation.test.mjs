import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExecutionRunbook } from "../src/prelive/execution-runbook.mjs";
import { buildPreliveValidationReport, summarizePreliveValidationReport } from "../src/prelive/prelive-validation.mjs";

function blockedDashboardStatus() {
  return {
    overall: {
      liveTrading: "BLOCKED",
    },
    prelive: {
      currentStage: "shadow_replay",
      shadowReplay: {
        ready: false,
        status: "shadow_replay_blocked",
        blockers: ["manual_canary_review_not_ready"],
      },
      mechanicalSimulation: {
        ready: false,
        status: "mechanical_simulation_blocked",
        blockers: ["shadow_replay_not_ready"],
        successCount: 0,
        targetSuccessCount: 50,
        failureCount: 0,
      },
      forkExecution: {
        ready: false,
        status: "fork_execution_blocked",
        blockers: ["mechanical_simulation_not_ready"],
        planCount: 1,
        submittedCount: 0,
        confirmedCount: 0,
        targetConfirmedCount: 3,
        pendingOutputCount: 0,
        failedCount: 0,
      },
      tinyLiveCanary: {
        ready: false,
        status: "tiny_canary_blocked",
        blockers: ["shadow_replay_not_ready", "mechanical_simulation_not_ready", "fork_execution_not_ready"],
      },
    },
  };
}

function blockedReviewPackage() {
  return {
    readyForManualReview: false,
    reviewBlockers: ["shadow_replay_not_ready"],
    liveBlockers: ["audit_blocks_live"],
    remediationPlan: {
      nextAction: {
        code: "refresh_gateway_quote",
        label: "refresh gateway quote",
        command: "npm run verify:gateway -- --route-key=\"bob:0x0555->base:0x0555\" --amounts=\"10000\"",
      },
    },
    manualReviewCandidate: {
      routeKey: "bob:0x0555->base:0x0555",
      routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
      amount: "10000",
      tradeReadiness: "insufficient_data",
    },
  };
}

function strategySnapshotSummary() {
  return {
    activeBudgetUsd: 300,
    planningBudgetUsd: 1000,
    candidateForValidationCount: 0,
    topImplementedStrategy: {
      id: "stablecoin_entry_exit_loops",
    },
    topPivot: {
      id: "gateway_base_btc_yield",
    },
    proxyCoverageNextAction: "expand_amount_ladder",
    yieldTopProfileId: "research_pilot",
  };
}

function blockedRunbook() {
  return buildExecutionRunbook({
    dashboardStatus: blockedDashboardStatus(),
    reviewPackage: blockedReviewPackage(),
    strategySnapshot: {
      summary: {
        topImplementedStrategyId: "stablecoin_entry_exit_loops",
        topPivotId: "gateway_base_btc_yield",
        planningBudgetUsd: 1000,
      },
      currentSystem: {
        activeBudgetUsd: 300,
      },
    },
    canaryInputs: {
      gatewayQuote: { state: "stale", ageMinutes: 61 },
      exactGas: { state: "fresh", ageMinutes: 2 },
      srcGas: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "fresh", ageMinutes: 2 },
      bitcoinFee: { state: "not_required", ageMinutes: null },
      marketSnapshot: { state: "fresh", ageMinutes: 2 },
    },
    nextStep: {
      route: {
        routeKey: "bob:0x0555->base:0x0555",
        label: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
  });
}

test("prelive validation reports blocked readiness with next command and preserved budget lanes", () => {
  const report = buildPreliveValidationReport({
    dashboardStatus: blockedDashboardStatus(),
    strategySnapshot: strategySnapshotSummary(),
    executionRunbook: blockedRunbook(),
    reviewPackage: blockedReviewPackage(),
    connectedRefreshPackage: {
      status: "network_refresh_required",
      summary: {
        requiredRefreshCount: 1,
      },
    },
    exactRouteForkPackage: {
      readiness: {
        technicalStatus: "submit_ready",
        economicStatus: "blocked_no_net_edge",
      },
    },
  });

  assert.equal(report.validationStatus, "blocked");
  assert.equal(report.summary.nextActionCode, "refresh_gateway_quote");
  assert.equal(report.budgets.activeBudgetUsd, 300);
  assert.equal(report.budgets.planningBudgetUsd, 1000);
  assert.equal(report.blockers.includes("shadow_replay_not_ready"), true);
  assert.equal(report.warnings.includes("live_execution_locked"), true);
  assert.equal(report.warnings.includes("connected_refresh_required"), true);
  assert.equal(report.warnings.includes("technical_ready_economic_blocked"), true);

  const summary = summarizePreliveValidationReport(report);
  assert.equal(summary.validationStatus, "blocked");
  assert.equal(summary.nextActionCode, "refresh_gateway_quote");
  assert.equal(summary.topPivotId, "gateway_base_btc_yield");
  assert.equal(summary.connectedRefreshStatus, "network_refresh_required");
  assert.equal(summary.exactRouteForkEconomicStatus, "blocked_no_net_edge");
});

test("prelive validation flips to manual review ready when all stages are complete", () => {
  const report = buildPreliveValidationReport({
    dashboardStatus: {
      overall: { liveTrading: "BLOCKED" },
      prelive: { currentStage: "tiny_live_canary_review" },
    },
    strategySnapshot: strategySnapshotSummary(),
    executionRunbook: {
      stages: [
        { id: "shadow_replay", complete: true },
        { id: "mechanical_simulation", complete: true },
        { id: "fork_execution", complete: true },
        { id: "manual_canary_review", complete: true },
      ],
      summary: {
        stageCount: 4,
        completeCount: 4,
        blockedCount: 0,
        readyForManualReview: true,
        nextStageId: "manual_canary_review",
        nextActionCode: "manual_canary_review_only",
        nextActionCommand: null,
      },
      currentStageId: "tiny_live_canary_review",
    },
    reviewPackage: {
      readyForManualReview: true,
      reviewBlockers: [],
      liveBlockers: [],
    },
  });

  assert.equal(report.validationStatus, "ready_for_manual_review");
  assert.equal(report.summary.readyForManualReview, true);
  assert.equal(report.readinessPct, 100);
});

test("prelive validation follows blocked current-route hold before queued refresh batch", () => {
  const runbook = buildExecutionRunbook({
    dashboardStatus: blockedDashboardStatus(),
    reviewPackage: {
      ...blockedReviewPackage(),
      remediationPlan: {
        nextAction: {
          code: "execute_refresh_batch",
          label: "execute refresh batch",
          command: "npm run run:shadow-refresh-batch -- --execute --limit=1",
        },
      },
    },
    strategySnapshot: {
      summary: {
        topImplementedStrategyId: "stablecoin_entry_exit_loops",
        topPivotId: "gateway_base_btc_yield",
        planningBudgetUsd: 1000,
      },
      currentSystem: {
        activeBudgetUsd: 300,
      },
    },
    canaryInputs: {
      gatewayQuote: { state: "fresh", ageMinutes: 2 },
      exactGas: { state: "fresh", ageMinutes: 2 },
      srcGas: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "blocked", ageMinutes: 1, failureReason: "odos_chain_not_supported" },
      bitcoinFee: { state: "not_required", ageMinutes: null },
      marketSnapshot: { state: "fresh", ageMinutes: 2 },
    },
    nextStep: {
      route: {
        routeKey: "avalanche:0x0555->bera:0x0555",
        label: "avalanche->bera wBTC.OFT->wBTC.OFT",
        amount: "10000",
        srcChain: "avalanche",
        dstChain: "bera",
      },
    },
  });

  const report = buildPreliveValidationReport({
    dashboardStatus: blockedDashboardStatus(),
    strategySnapshot: strategySnapshotSummary(),
    executionRunbook: runbook,
    reviewPackage: {
      ...blockedReviewPackage(),
      reviewBlockers: ["shadow_replay_not_ready", "blocked_dex_quote"],
    },
  });

  assert.equal(report.summary.nextActionCode, "hold_dex_quote");
  assert.equal(report.nextAction.command, null);
});
