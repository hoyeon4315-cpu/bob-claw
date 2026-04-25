import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  runAllChainAutopilot,
} from "../src/executor/all-chain-autopilot.mjs";

function fakeCommand({ args }) {
  const name = args[0];
  if (name.endsWith("gas-snapshot.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "ethereum gasPriceWei=1 block=1 latency=1ms fallbacks=0 fallbackGasUnits=260000 fallbackTx=$0.01\n",
      stderr: "",
      json: null,
    };
  }
  if (name.endsWith("plan-treasury-refill-jobs.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        summary: { jobCount: 2 },
        jobs: [
          {
            jobId: "auto-1",
            chain: "optimism",
            asset: "ETH",
            targetAmountDecimal: 0.001,
            executionMethod: "cross_chain_bridge_or_swap",
            requiresManualReview: false,
            fundingSource: { selectionStatus: "ready" },
          },
          {
            jobId: "manual-1",
            chain: "sei",
            asset: "SEI",
            requiresManualReview: true,
            fundingSource: { selectionStatus: "conditional" },
          },
        ],
      },
    };
  }
  if (name.endsWith("run-refill-job-stub.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        preparation: { status: "ready" },
        execution: args.includes("--execute") ? { settlementStatus: "delivered" } : null,
      },
    };
  }
  if (name.endsWith("run-live-canary-sweep.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        status: "completed",
        summary: { candidateCount: 11, previewReadyCount: 2, executedCount: args.includes("--execute") ? 1 : 0, deliveredCount: 1, blockedCount: 9 },
        results: [{ status: "delivered", candidate: { chain: "optimism" }, execution: { lastTxHash: "0x1" } }],
      },
    };
  }
  if (name.endsWith("run-merkl-canary-autopilot.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: { status: "blocked", blockedReason: "no_ready_candidate", summary: {} },
    };
  }
  if (name.endsWith("run-merkl-portfolio-orchestrator.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: { status: "blocked", blockedReason: "no_portfolio_entry_ready" },
    };
  }
  if (name.endsWith("run-strategy-catalog-dispatcher.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        record: { batchStatus: "completed", selectedCount: 8 },
        summary: { successCount: 8, failureCount: 0 },
        executionSurfaces: { summary: { liveEligibleCount: 0, missingExecutorCount: 0 } },
      },
    };
  }
  if (name.endsWith("run-payback-scheduler.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        status: "carry",
        reason: "planned_payback_below_minimum",
        decision: { snapshot: { pendingDeferredSats: 601 } },
      },
    };
  }
  throw new Error(`unexpected command ${name}`);
}

test("all-chain autopilot wires every destination chain into one execution pass", async () => {
  const report = await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: fakeCommand,
  });

  assert.equal(report.status, "completed_with_blockers");
  assert.deepEqual(report.chains, OFFICIAL_GATEWAY_DESTINATION_CHAINS);
  assert.equal(report.summary.officialChainCount, 11);
  assert.equal(report.summary.refillJobCount, 2);
  assert.equal(report.summary.autoRefillJobCount, 1);
  assert.equal(report.summary.refillExecutedCount, 1);
  assert.equal(report.summary.canarySweep.executedCount, 1);
  assert.equal(report.summary.strategyDispatch.missingExecutorCount, 0);
  assert.equal(report.summary.payback.pendingCarrySats, 601);
});

test("all-chain autopilot reports recoverable blockers without failing the whole pass", async () => {
  let primaryPlanSeen = false;
  const recoverableCommand = ({ args }) => {
    const name = args[0];
    if (name.endsWith("plan-treasury-refill-jobs.mjs") && args.includes("--refresh-inventory")) {
      primaryPlanSeen = true;
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "AccountStateRpcError: All RPC endpoints failed for chain: ethereum",
        json: null,
        error: { name: "AccountStateRpcError", message: "All RPC endpoints failed for chain: ethereum" },
      };
    }
    return fakeCommand({ args });
  };

  const report = await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: recoverableCommand,
  });

  assert.equal(primaryPlanSeen, true);
  assert.equal(report.status, "completed_with_blockers");
  assert.equal(report.blockedReason, null);
  assert.equal(report.summary.refillJobCount, 2);
});

test("all-chain autopilot gives long-running canary sweep its own timeout", async () => {
  const timeouts = {};
  const timedCommand = ({ args, timeoutMs }) => {
    timeouts[args[0]] = timeoutMs;
    return fakeCommand({ args });
  };

  await runAllChainAutopilot({
    execute: true,
    write: false,
    timeoutMs: 123,
    canaryTimeoutMs: 456,
    dispatchTimeoutMs: 789,
    runCommandImpl: timedCommand,
  });

  assert.equal(timeouts["src/cli/run-live-canary-sweep.mjs"], 456);
  assert.equal(timeouts["src/cli/run-strategy-catalog-dispatcher.mjs"], 789);
  assert.equal(timeouts["src/cli/run-merkl-canary-autopilot.mjs"], 123);
});
