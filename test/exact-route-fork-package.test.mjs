import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExactRouteForkPackage } from "../src/prelive/exact-route-fork-package.mjs";

test("exact-route fork package separates technical readiness from economic blockers", () => {
  const report = buildExactRouteForkPackage({
    dashboardStatus: {
      overall: { liveTrading: "BLOCKED" },
      prelive: {
        mechanicalSimulation: { targetSuccessCount: 50 },
        forkExecution: { targetConfirmedCount: 3 },
      },
    },
    canaryInputs: {
      routeKey: "bob:0x0555->base:0x0555",
      routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
      amount: "10000",
      scoreTradeReadiness: "reject_no_net_edge",
    },
    reviewPackage: {
      policyReviewCandidate: {
        routeKey: "bob:0x0555->base:0x0555",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
      },
    },
    forkPlan: {
      plans: [
        {
          planId: "plan-123",
          status: "planned",
          routeKey: "bob:0x0555->base:0x0555",
          routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          selectionSource: "exact_route",
          selectionCode: "reject_no_net_edge",
          targetEnvironment: "external_signed_fork",
          routeContext: {
            tradeReadiness: "reject_no_net_edge",
          },
          transaction: {
            to: "0x0555",
            data: "0x1234",
            txDataBytes: 2,
            valueWei: "0",
          },
          signer: {
            required: true,
            mode: "external_signed_raw_tx",
          },
          commands: {
            plan: 'npm run plan:prelive-fork-execution -- --route-key="bob:0x0555->base:0x0555" --amount="10000" --write',
            submit: 'npm run submit:prelive-fork-execution -- --plan-id="plan-123" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"',
            reconcile: 'npm run reconcile:prelive-fork-execution -- --plan-id="plan-123" --tx-hash="<txHash>" --rpc-url="<forkRpcUrl>"',
          },
        },
      ],
    },
    simulationRuns: [
      {
        observedAt: "2026-04-14T05:00:00.000Z",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        status: "simulated_ok",
      },
    ],
    connectedRefreshPackage: {
      summary: {
        requiredRefreshCount: 0,
      },
      staleInputs: [],
    },
  });

  assert.equal(report.status, "technical_ready_economic_blocked");
  assert.equal(report.readiness.technicalStatus, "submit_ready");
  assert.equal(report.readiness.economicStatus, "blocked_no_net_edge");
  assert.equal(report.simulation.successCount, 1);
  assert.equal(report.nextAction.code, "hold_negative_edge");
  assert.equal(report.integrity.transactionReady, true);
});

test("exact-route fork package carries blocked connected inputs into freshness blockers", () => {
  const report = buildExactRouteForkPackage({
    dashboardStatus: {
      overall: { liveTrading: "BLOCKED" },
      prelive: {
        mechanicalSimulation: { targetSuccessCount: 50 },
        forkExecution: { targetConfirmedCount: 3 },
      },
    },
    canaryInputs: {
      routeKey: "avalanche:0x0555->bera:0x0555",
      routeLabel: "avalanche->bera wBTC.OFT->wBTC.OFT",
      amount: "10000",
      scoreTradeReadiness: "reject_no_net_edge",
    },
    reviewPackage: {
      policyReviewCandidate: {
        routeKey: "avalanche:0x0555->bera:0x0555",
        routeLabel: "avalanche->bera wBTC.OFT->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
      },
    },
    connectedRefreshPackage: {
      summary: {
        requiredRefreshCount: 0,
        blockedInputCount: 1,
      },
      blockingInputs: [{ key: "dex_quote", state: "blocked" }],
      nextAction: {
        code: "hold_dex_quote",
      },
    },
  });

  assert.equal(report.blockers.includes("blocked_dex_quote"), true);
  assert.equal(report.nextAction.code, "hold_dex_quote");
  assert.equal(report.nextAction.command, null);
  assert.equal(report.warnings.includes("blocked_connected_input_prevents_exact_route_progress"), true);
});

test("exact-route fork package does not attach an unrelated exact-route plan to the current canary route", () => {
  const report = buildExactRouteForkPackage({
    dashboardStatus: {
      overall: { liveTrading: "ALLOWED" },
      prelive: {
        mechanicalSimulation: { targetSuccessCount: 50 },
        forkExecution: { targetConfirmedCount: 3 },
      },
    },
    canaryInputs: {
      routeKey: "soneium:0x0555->bob:0x0555",
      routeLabel: "soneium->bob wBTC.OFT->wBTC.OFT",
      amount: "100",
      scoreTradeReadiness: "reject_no_net_edge",
    },
    reviewPackage: {
      policyReviewCandidate: {
        routeKey: "soneium:0x0555->bob:0x0555",
        routeLabel: "soneium->bob wBTC.OFT->wBTC.OFT",
        amount: "100",
        tradeReadiness: "reject_no_net_edge",
      },
    },
    forkPlan: {
      plans: [
        {
          planId: "plan-base-bsc",
          status: "planned",
          routeKey: "base:0x0555->bsc:0x0555",
          routeLabel: "base->bsc wBTC.OFT->wBTC.OFT",
          amount: "300",
          selectionSource: "exact_route",
          routeContext: {
            tradeReadiness: "reject_no_net_edge",
          },
          transaction: {
            to: "0x0555",
            data: "0x1234",
          },
          commands: {
            submit: 'npm run submit:prelive-fork-execution -- --plan-id="plan-base-bsc"',
          },
        },
      ],
    },
    connectedRefreshPackage: {
      summary: {
        requiredRefreshCount: 0,
      },
    },
  });

  assert.equal(report.currentRoute.routeKey, "soneium:0x0555->bob:0x0555");
  assert.equal(report.plan, null);
  assert.equal(report.status, "missing_exact_route_plan");
  assert.equal(report.readiness.technicalStatus, "missing_plan");
  assert.equal(report.integrity.routeMatchesCurrentCanary, false);
});
