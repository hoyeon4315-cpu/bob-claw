import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExecutionRunbook, summarizeExecutionRunbook } from "../src/prelive/execution-runbook.mjs";

function dashboardStatusFixture() {
  return {
    overall: {
      liveTrading: "BLOCKED",
    },
    prelive: {
      currentStage: "shadow_replay",
      liveTradingPolicy: "BLOCKED",
      shadowReplay: {
        ready: false,
        status: "shadow_replay_blocked",
        blockers: ["manual_canary_review_not_ready"],
        policyReadyMeasuredRoutes: 1,
        executionReviewRoute: "bob:0x0555->base:0x0555",
      },
      mechanicalSimulation: {
        ready: false,
        status: "mechanical_simulation_blocked",
        blockers: ["shadow_replay_not_ready", "needs_50_more_successful_simulations"],
        successCount: 0,
        targetSuccessCount: 50,
        failureCount: 0,
      },
      forkExecution: {
        ready: false,
        status: "fork_execution_blocked",
        blockers: ["mechanical_simulation_not_ready", "needs_3_more_confirmed_fork_cycles"],
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

function reviewPackageFixture() {
  return {
    readyForManualReview: false,
    reviewBlockers: ["shadow_replay_not_ready", "stale_gateway_quote"],
    remediationPlan: {
      runnerCommand: "npm run run:admission-remediation -- --execute --continue-on-failure --limit=3",
      nextAction: {
        code: "refresh_gateway_quote",
        label: "refresh gateway quote",
        command: "npm run verify:gateway -- --route-key=\"bob:0x0555->base:0x0555\" --amounts=\"10000\"",
      },
    },
  };
}

function strategySnapshotFixture() {
  return {
    summary: {
      topImplementedStrategyId: "stablecoin_entry_exit_loops",
      topPivotId: "gateway_base_btc_yield",
      planningBudgetUsd: null,
    },
    currentSystem: {
      activeBudgetUsd: null,
    },
  };
}

function canaryInputsFixture() {
  return {
    gatewayQuote: { state: "stale", ageMinutes: 61 },
    exactGas: { state: "fresh", ageMinutes: 2 },
    srcGas: { state: "fresh", ageMinutes: 2 },
    dexQuote: { state: "fresh", ageMinutes: 2 },
    bitcoinFee: { state: "not_required", ageMinutes: null },
    marketSnapshot: { state: "fresh", ageMinutes: 2 },
  };
}

function nextStepFixture() {
  return {
    route: {
      routeKey: "bob:0x0555->base:0x0555",
      label: "bob->base wBTC.OFT->wBTC.OFT",
      amount: "10000",
      srcChain: "bob",
      dstChain: "base",
      tradeReadiness: "insufficient_data",
    },
  };
}

test("execution runbook turns current prelive blockers into ordered stages and next actions", () => {
  const runbook = buildExecutionRunbook({
    dashboardStatus: dashboardStatusFixture(),
    reviewPackage: reviewPackageFixture(),
    strategySnapshot: strategySnapshotFixture(),
    canaryInputs: canaryInputsFixture(),
    nextStep: nextStepFixture(),
    forkPlan: {
      plans: [
        {
          planId: "plan-123",
          status: "planned",
          routeKey: "bob:0x0555->base:0x0555",
          routeLabel: "bob->base",
          amount: "10000",
          selectionSource: "exact_route",
          selectionCode: "reject_no_net_edge",
          routeContext: {
            tradeReadiness: "reject_no_net_edge",
            netEdgeUsd: -0.84,
          },
          transaction: {
            to: "0x0555",
            txDataBytes: 452,
          },
          signer: {
            required: true,
          },
          commands: {
            submit: "npm run submit:prelive-fork-execution -- --plan-id=\"plan-123\" --signed-tx=\"<signedTx>\" --rpc-url=\"<forkRpcUrl>\"",
          },
        },
      ],
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
  });

  assert.equal(runbook.summary.nextStageId, "shadow_replay");
  assert.equal(runbook.summary.nextActionCode, "refresh_gateway_quote");
  assert.equal(runbook.stages[0].state, "blocked");
  assert.equal(runbook.stages[0].blockers.includes("stale_gateway_quote"), true);
  assert.equal(runbook.stages[2].nextAction.code, "wait_for_mechanical_simulation");
  assert.equal(runbook.stages[2].blockers.includes("mechanical_simulation_not_ready"), true);
  assert.equal(runbook.exactRouteForkPlan.status, "planned");
  assert.equal(runbook.exactRouteForkPlan.planId, "plan-123");

  const summary = summarizeExecutionRunbook(runbook);
  assert.equal(summary.currentStageId, "shadow_replay");
  assert.equal(summary.nextActionCode, "refresh_gateway_quote");
  assert.equal(summary.topRouteLabel, "bob->base wBTC.OFT->wBTC.OFT");
  assert.equal(summary.exactRouteForkPlanStatus, "planned");
});

test("execution runbook holds on blocked DEX input instead of suggesting another refresh", () => {
  const runbook = buildExecutionRunbook({
    dashboardStatus: dashboardStatusFixture(),
    reviewPackage: {
      ...reviewPackageFixture(),
      remediationPlan: null,
    },
    strategySnapshot: strategySnapshotFixture(),
    canaryInputs: {
      ...canaryInputsFixture(),
      gatewayQuote: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "blocked", ageMinutes: 1, failureReason: "odos_chain_not_supported" },
    },
    nextStep: nextStepFixture(),
  });

  assert.equal(runbook.summary.nextActionCode, "hold_dex_quote");
  assert.equal(runbook.stages[0].nextAction.command, null);
  assert.equal(runbook.stages[0].blockers.includes("blocked_dex_quote"), true);
});

test("execution runbook prioritizes blocked current-route hold over queued remediation work", () => {
  const runbook = buildExecutionRunbook({
    dashboardStatus: dashboardStatusFixture(),
    reviewPackage: {
      ...reviewPackageFixture(),
      remediationPlan: {
        nextAction: {
          code: "execute_refresh_batch",
          label: "execute refresh batch",
          command: "npm run run:shadow-refresh-batch -- --execute --continue-on-failure --limit=4",
        },
      },
    },
    strategySnapshot: strategySnapshotFixture(),
    canaryInputs: {
      ...canaryInputsFixture(),
      gatewayQuote: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "blocked", ageMinutes: 1, failureReason: "odos_chain_not_supported" },
    },
    nextStep: nextStepFixture(),
  });

  assert.equal(runbook.summary.nextActionCode, "hold_dex_quote");
  assert.equal(runbook.stages[0].nextAction.code, "hold_dex_quote");
  assert.equal(runbook.stages[0].nextAction.command, null);
});

test("execution runbook prioritizes strategy-candidate remediation over stale exact-route refreshes", () => {
  const runbook = buildExecutionRunbook({
    dashboardStatus: dashboardStatusFixture(),
    reviewPackage: {
      ...reviewPackageFixture(),
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
        tradeReadiness: "strategy_evidence_blocked",
        blockerReasons: ["signer_backed_oos_receipts_missing"],
        nextAction: {
          code: "collect_wrapped_btc_loop_oos_receipts",
          command: "npm run ingest:wrapped-btc-loop-receipt -- --write",
        },
      },
      remediationPlan: {
        nextAction: {
          code: "collect_wrapped_btc_loop_oos_receipts",
          label: "collect wrapped btc loop oos receipts",
          command: "npm run ingest:wrapped-btc-loop-receipt -- --write",
        },
      },
    },
    strategySnapshot: strategySnapshotFixture(),
    canaryInputs: canaryInputsFixture(),
    nextStep: nextStepFixture(),
  });

  assert.equal(runbook.summary.nextActionCode, "collect_wrapped_btc_loop_oos_receipts");
  assert.equal(runbook.summary.nextActionCommand, "npm run ingest:wrapped-btc-loop-receipt -- --write");
  assert.equal(runbook.stages[0].nextAction.code, "collect_wrapped_btc_loop_oos_receipts");
  assert.equal(runbook.stages[0].blockers.includes("stale_gateway_quote"), true);
});
