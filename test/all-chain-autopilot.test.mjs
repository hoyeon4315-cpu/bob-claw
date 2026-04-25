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
  if (name.endsWith("run-inbound-inventory-watcher.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        summary: {
          inboundEventCount: 2,
          routeReadyCount: 1,
          manualReviewCount: 1,
          candidateQueueCount: 0,
        },
        appended: {
          events: 2,
          jobs: 1,
          pendingWhitelist: 1,
        },
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
  assert.deepEqual(report.summary.inboundInventory, {
    inboundEventCount: 2,
    routeReadyCount: 1,
    manualReviewCount: 1,
    candidateQueueCount: 0,
    appendedEvents: 2,
    appendedJobs: 1,
    appendedPendingWhitelist: 1,
  });
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

test("all-chain autopilot retries refill jobs with executable alternate methods after no_route", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-treasury-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          summary: { jobCount: 1 },
          jobs: [
            {
              jobId: "gas-alt",
              chain: "optimism",
              asset: "ETH",
              type: "refill_native",
              executionMethod: "cross_chain_bridge_or_swap",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
              candidateMethods: [
                {
                  method: "cross_chain_bridge_or_swap",
                  availability: "ready",
                  source: { chain: "base", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
                  missingInputs: [],
                },
                {
                  method: "gas_refuel_bridge_gas_zip",
                  availability: "conditional",
                  source: { chain: "base", token: "0x0000000000000000000000000000000000000000" },
                  missingInputs: [],
                  settlementRequirements: ["gas_zip_destination_native_delta_proof_required"],
                },
              ],
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (!args.includes("--method=gas_refuel_bridge_gas_zip")) {
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          json: { preparation: { status: "blocked", blockedReason: "no_route" } },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          forcedMethod: "gas_refuel_bridge_gas_zip",
          preparation: { status: "ready", executionMethod: "gas_refuel_bridge_gas_zip" },
          execution: args.includes("--execute") ? { settlementStatus: "delivered" } : null,
        },
      };
    }
    return fakeCommand({ args });
  };

  const report = await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: command,
  });

  assert.equal(report.summary.refillExecutedCount, 1);
  assert.equal(report.refillExecutions[0].selectedExecutionMethod, "gas_refuel_bridge_gas_zip");
  assert.equal(report.refillExecutions[0].executionStatus, "delivered");
  assert.equal(seen.some((args) => args.includes("--method=gas_refuel_bridge_gas_zip") && args.includes("--execute")), true);
});

test("all-chain autopilot treats unsupported bridge refill previews as alternate-route blockers", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-treasury-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          summary: { jobCount: 1 },
          jobs: [
            {
              jobId: "unsupported-across",
              chain: "optimism",
              asset: "ETH",
              type: "refill_native",
              executionMethod: "cross_chain_bridge_across",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
              candidateMethods: [
                {
                  method: "cross_chain_bridge_across",
                  availability: "ready",
                  source: { chain: "base", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
                  missingInputs: [],
                },
                {
                  method: "cross_chain_bridge_lifi",
                  availability: "ready",
                  source: { chain: "base", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
                  missingInputs: [],
                },
                {
                  method: "gas_refuel_bridge_gas_zip",
                  availability: "conditional",
                  source: { chain: "base", token: "0x0000000000000000000000000000000000000000" },
                  missingInputs: [],
                },
              ],
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (!args.some((item) => item === "--method=cross_chain_bridge_lifi" || item === "--method=gas_refuel_bridge_gas_zip")) {
        return {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "Error: across plan: pair unsupported src=base dst=optimism ticker=cbbtc",
          json: null,
          error: { name: "Error", message: "across plan: pair unsupported src=base dst=optimism ticker=cbbtc" },
        };
      }
      if (args.includes("--method=cross_chain_bridge_lifi")) {
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          json: { preparation: { status: "blocked", blockedReason: "lifi_quote_rejected" } },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          forcedMethod: "gas_refuel_bridge_gas_zip",
          preparation: { status: "ready", executionMethod: "gas_refuel_bridge_gas_zip" },
          execution: args.includes("--execute") ? { settlementStatus: "delivered" } : null,
        },
      };
    }
    return fakeCommand({ args });
  };

  const report = await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: command,
  });

  assert.equal(report.status, "completed_with_blockers");
  assert.equal(report.blockedReason, null);
  assert.equal(report.summary.refillExecutedCount, 1);
  assert.equal(report.refillExecutions[0].selectedExecutionMethod, "gas_refuel_bridge_gas_zip");
  assert.equal(seen.some((args) => args.includes("--method=cross_chain_bridge_lifi")), true);
  assert.equal(seen.some((args) => args.includes("--method=gas_refuel_bridge_gas_zip") && args.includes("--execute")), true);
});
