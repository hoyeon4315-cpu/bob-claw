import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCurrentRoutePrelivePass,
  buildCurrentRoutePrelivePassSummary,
  executeCurrentRoutePrelivePass,
} from "../src/prelive/current-route-prelive-pass.mjs";

function makeContext({
  routeKey = "bob:0x0555->base:0x0555",
  routeLabel = "bob->base wBTC.OFT->wBTC.OFT",
  amount = "10000",
  requiredRefreshCount = 0,
  blockedInputCount = 0,
  economicStatus = "eligible_for_manual_review",
  technicalStatus = "submit_ready",
  simulationSuccessCount = 50,
  simulationTargetCount = 50,
  simulationSuccessRemaining = 0,
  forkConfirmedCount = 0,
  forkTargetCount = 3,
  forkSuccessRemaining = 3,
  submitCommand = 'npm run submit:prelive-fork-execution -- --plan-id="plan-123" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"',
} = {}) {
  return {
    connectedRefreshPackage: {
      status:
        requiredRefreshCount > 0
          ? "network_refresh_required"
          : blockedInputCount > 0
            ? "blocked_nonrefreshable_input"
            : "reevaluation_ready",
      currentRoute: {
        routeKey,
        routeLabel,
        amount,
        tradeReadiness: economicStatus,
      },
      summary: {
        requiredRefreshCount,
        blockedInputCount,
        nextActionCode:
          requiredRefreshCount > 0
            ? "refresh_gateway_quote"
            : blockedInputCount > 0
              ? "hold_dex_quote"
              : "advance_canary",
        nextActionCommand:
          requiredRefreshCount > 0
            ? 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000"'
            : blockedInputCount > 0
              ? null
            : "npm run advance:canary",
        fullCommandChain:
          'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000" && npm run advance:canary',
      },
      nextAction: {
        code:
          requiredRefreshCount > 0
            ? "refresh_gateway_quote"
            : blockedInputCount > 0
              ? "hold_dex_quote"
              : "advance_canary",
      },
    },
    exactRouteForkPackage: {
      status:
        requiredRefreshCount > 0
          ? "refresh_required_before_submit"
          : economicStatus !== "eligible_for_manual_review"
            ? "technical_ready_economic_blocked"
            : simulationSuccessRemaining > 0
              ? "simulation_runway_remaining"
              : technicalStatus !== "submit_ready"
                ? "exact_route_plan_not_ready"
                : "prelive_submit_ready",
      currentRoute: {
        routeKey,
        routeLabel,
        amount,
        tradeReadiness: economicStatus,
      },
      plan: {
        planId: technicalStatus === "submit_ready" ? "plan-123" : null,
      },
      readiness: {
        technicalStatus,
        economicStatus,
      },
      simulation: {
        successCount: simulationSuccessCount,
        targetSuccessCount: simulationTargetCount,
        successRemaining: simulationSuccessRemaining,
      },
      forkHistory: {
        confirmedCount: forkConfirmedCount,
        targetConfirmedCount: forkTargetCount,
        successRemaining: forkSuccessRemaining,
      },
      commands: {
        submit: submitCommand,
        reconcile: 'npm run reconcile:prelive-fork-execution -- --plan-id="plan-123"',
      },
    },
    executionRunbook: {
      currentRoute: {
        routeKey,
        routeLabel,
        amount,
        tradeReadiness: economicStatus,
      },
    },
    reviewPackage: {
      manualReviewCandidate: {
        routeKey,
        routeLabel,
        amount,
        tradeReadiness: economicStatus,
      },
    },
  };
}

test("current route prelive pass preview prioritizes connected refresh before later stages", () => {
  const pass = buildCurrentRoutePrelivePass({
    context: makeContext({
      requiredRefreshCount: 5,
      economicStatus: "blocked_no_net_edge",
      simulationSuccessCount: 1,
      simulationSuccessRemaining: 49,
    }),
  });

  assert.equal(pass.status, "connected_refresh_required");
  assert.equal(pass.nextAction.code, "execute_connected_refresh");
  assert.match(pass.nextAction.command || "", /--continue-on-failure/);
  assert.equal(pass.steps[0].status, "ready");
  assert.equal(pass.steps[1].status, "conditional");
});

test("current route prelive pass holds when connected refresh is blocked by nonrefreshable input", () => {
  const pass = buildCurrentRoutePrelivePass({
    context: makeContext({
      blockedInputCount: 1,
      economicStatus: "blocked_no_net_edge",
      simulationSuccessCount: 1,
      simulationSuccessRemaining: 49,
    }),
  });

  assert.equal(pass.status, "blocked_nonrefreshable_input");
  assert.equal(pass.nextAction.code, "hold_dex_quote");
  assert.equal(pass.nextAction.command, null);
  assert.equal(pass.steps[0].status, "blocked");
  assert.equal(pass.steps[1].reason, "blocked_nonrefreshable_input");
  assert.equal(pass.steps[2].status, "blocked");
  assert.equal(pass.steps[4].status, "blocked");
});

test("current route prelive pass stops safely when economics remain blocked after refresh", async () => {
  const calls = [];
  let contextIndex = 0;
  const contexts = [
    makeContext({
      requiredRefreshCount: 0,
      economicStatus: "blocked_no_net_edge",
      simulationSuccessCount: 1,
      simulationSuccessRemaining: 49,
    }),
  ];
  const initial = makeContext({
    requiredRefreshCount: 5,
    economicStatus: "blocked_no_net_edge",
    simulationSuccessCount: 1,
    simulationSuccessRemaining: 49,
  });
  const record = await executeCurrentRoutePrelivePass({
    initialContext: initial,
    pass: buildCurrentRoutePrelivePass({ context: initial }),
    execute: true,
    buildContext: async () => contexts[Math.min(contextIndex++, contexts.length - 1)],
    runCommand: async ({ step }) => {
      calls.push(step.script);
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 5,
        stdout: "ok",
        stderr: "",
      };
    },
  });

  assert.equal(record.executionStatus, "blocked");
  assert.equal(record.finalStatus, "blocked_no_net_edge");
  assert.equal(record.stopReason, "blocked_no_net_edge");
  assert.deepEqual(calls, [
    "run:connected-refresh-package",
    "build:prelive-decision-pack",
    "status:dashboard",
  ]);
});

test("current route prelive pass execute stops immediately on blocked connected input", async () => {
  const calls = [];
  const initial = makeContext({
    blockedInputCount: 1,
    economicStatus: "blocked_no_net_edge",
    simulationSuccessCount: 1,
    simulationSuccessRemaining: 49,
  });
  const record = await executeCurrentRoutePrelivePass({
    initialContext: initial,
    pass: buildCurrentRoutePrelivePass({ context: initial }),
    execute: true,
    runCommand: async ({ step }) => {
      calls.push(step.script);
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 5,
        stdout: "ok",
        stderr: "",
      };
    },
  });

  assert.equal(record.executionStatus, "blocked");
  assert.equal(record.finalStatus, "blocked_nonrefreshable_input");
  assert.equal(record.stopReason, "blocked_nonrefreshable_input");
  assert.deepEqual(calls, [
    "build:prelive-decision-pack",
    "status:dashboard",
  ]);
});

test("current route prelive pass can advance to ready_for_external_signer after sims and exact planning", async () => {
  const calls = [];
  let contextIndex = 0;
  const contexts = [
    makeContext({
      requiredRefreshCount: 0,
      economicStatus: "eligible_for_manual_review",
      technicalStatus: "missing_plan",
      simulationSuccessCount: 50,
      simulationSuccessRemaining: 0,
    }),
    makeContext({
      requiredRefreshCount: 0,
      economicStatus: "eligible_for_manual_review",
      technicalStatus: "submit_ready",
      simulationSuccessCount: 50,
      simulationSuccessRemaining: 0,
    }),
  ];
  const initial = makeContext({
    requiredRefreshCount: 0,
    economicStatus: "eligible_for_manual_review",
    technicalStatus: "missing_plan",
    simulationSuccessCount: 48,
    simulationSuccessRemaining: 2,
  });
  const record = await executeCurrentRoutePrelivePass({
    initialContext: initial,
    pass: buildCurrentRoutePrelivePass({ context: initial }),
    execute: true,
    buildContext: async () => contexts[Math.min(contextIndex++, contexts.length - 1)],
    runCommand: async ({ step }) => {
      calls.push(step.script);
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 5,
        stdout: "ok",
        stderr: "",
      };
    },
  });

  assert.equal(record.executionStatus, "succeeded");
  assert.equal(record.finalStatus, "ready_for_external_signer");
  assert.match(record.submitCommand || "", /submit:prelive-fork-execution/);
  assert.deepEqual(calls, [
    "run:prelive-simulations",
    "plan:prelive-fork-execution",
    "build:prelive-decision-pack",
    "status:dashboard",
  ]);
});

test("current route prelive pass summary aggregates preview and execute outcomes", () => {
  const summary = buildCurrentRoutePrelivePassSummary([
    {
      observedAt: "2026-04-14T06:00:00.000Z",
      mode: "execute",
      executionStatus: "succeeded",
      finalStatus: "ready_for_external_signer",
      stageResults: [{ code: "x" }],
      finalPass: {
        nextAction: {
          code: "await_external_signer",
        },
        exactRouteFork: {
          submitCommand: 'npm run submit:prelive-fork-execution -- --plan-id="plan-123"',
        },
      },
    },
    {
      observedAt: "2026-04-14T06:01:00.000Z",
      mode: "preview",
      executionStatus: "preview",
      finalStatus: "connected_refresh_required",
      stageResults: [],
      initialPass: {
        nextAction: {
          code: "execute_connected_refresh",
        },
      },
    },
  ]);

  assert.equal(summary.runCount, 1);
  assert.equal(summary.previewCount, 1);
  assert.equal(summary.readyForSignerCount, 1);
  assert.equal(summary.latestStatus, "connected_refresh_required");
  assert.equal(summary.nextAction.code, "execute_connected_refresh");
});
