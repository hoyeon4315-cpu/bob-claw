import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  defaultRunCommand,
  runAllChainAutopilot as runAllChainAutopilotImpl,
} from "../src/executor/all-chain-autopilot.mjs";

const emptyReceiptJsonl = async () => [];

function runAllChainAutopilot(options = {}) {
  return runAllChainAutopilotImpl({
    readJsonlImpl: emptyReceiptJsonl,
    ...options,
  });
}

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
            resourceKey: "optimism:eth",
            targetAmountDecimal: 0.001,
            executionMethod: "cross_chain_bridge_or_swap",
            requiresManualReview: false,
            fundingSource: { selectionStatus: "ready" },
          },
          {
            jobId: "manual-1",
            chain: "sei",
            asset: "SEI",
            resourceKey: "sei:sei",
            requiresManualReview: true,
            fundingSource: { selectionStatus: "conditional" },
          },
        ],
      },
    };
  }
  if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        rebalancePlan: {
          decision: "REBALANCE_REQUIRED",
          actions: [{ type: "capital_rebalance", chain: "base", amountUsd: 50 }],
        },
        capitalPlan: {
          decision: "REFILL_REQUIRED",
          summary: {
            actionCount: 1,
            blockerCount: 0,
          },
        },
        jobs: {
          summary: { jobCount: 1, estimatedAssetValueUsd: 50 },
          jobs: [
            {
              jobId: "cap-1",
              chain: "base",
              asset: "wBTC.OFT",
              type: "refill_token",
              resourceKey: "base:wbtc.oft",
              targetAmountDecimal: 0.0005,
              executionMethod: "cross_chain_bridge_or_swap",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
            },
          ],
        },
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
          operatingCapitalIngressCount: 2,
          paybackExcludedCount: 2,
          routeReadyCount: 1,
          manualReviewCount: 1,
          candidateQueueCount: 0,
        },
        routingPlan: {
          jobs: [
            {
              jobId: "inbound-1",
              chain: "base",
              asset: "wBTC.OFT",
              type: "inbound_route",
              sourceEventId: "event-1",
              routeType: "btc_like_deploy_from_hub",
              requiresManualReview: false,
              capitalSource: "operating_capital",
              paybackExclusion: true,
            },
          ],
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
  if (name.endsWith("report-merkl-canary-queue.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        summary: {
          queueCount: 2,
          chainCount: 1,
          byChain: { base: 2 },
          executableNowCount: 1,
          autoExecutableNowCount: 1,
          representativeCoverage: {
            missingRepresentativeChainCount: 10,
            missingChains: ["bsc", "avalanche"],
            topMissingChain: "bsc",
          },
        },
      },
    };
  }
  if (name.endsWith("sync-radar-from-merkl-queue.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        status: "completed",
        observedCount: 2,
        candidateCount: 1,
        observationsWritten: 1,
        candidatesWritten: 1,
        skippedCandidates: [],
      },
    };
  }
  if (name.endsWith("report-radar-board.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        summary: {
          observedCount: 2,
          strategyEpisodeCount: 0,
          portablePacketCount: 0,
          executableCount: 0,
        },
        blockerCounts: { position_below_min_position_usd: 1 },
      },
    };
  }
  if (name.endsWith("report-destination-promotion-gate.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        summary: {
          allocationReadyCount: 2,
          promotableCount: 4,
        },
      },
    };
  }
  if (name.endsWith("report-allocator-core.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        summary: {
          candidateCount: 4,
          activeReadyCandidateCount: 2,
          planningCandidateCount: 4,
          topActiveReadyCandidateId: "base:stablecoin_lending_carry",
          tier1ActiveReadyChains: ["base", "bsc"],
          tier2ReviewOnlyChains: ["avalanche"],
          tier3BlockedOnlyChains: ["sonic"],
        },
        diversifiedPortfolioDraft: {
          activeDraft: [
            {
              id: "base:stablecoin_lending_carry",
              chain: "base",
              protocols: ["aave_v3"],
              assetFamily: "stables",
              planningEligibility: "allocation_ready",
            },
            {
              id: "bsc:stablecoin_lending_carry",
              chain: "bsc",
              protocols: ["venus"],
              assetFamily: "stables",
              planningEligibility: "allocation_ready",
            },
          ],
          reviewQueue: [
            {
              id: "avalanche:wrapped_btc_lending",
              chain: "avalanche",
              protocols: ["benqi"],
              blockers: ["allocation_unwindSlippageBps_recheck_required"],
            },
          ],
        },
      },
    };
  }
  if (name.endsWith("run-destination-representative-autopilot.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        status: args.includes("--execute") ? "delivered" : "preview_ready",
        summary: {
          candidateCount: 1,
          readyCount: 1,
          selected: {
            templateId: "bsc:stablecoin_lending_carry",
            chain: "bsc",
            protocolId: "venus",
          },
          proofStatus: args.includes("--execute") ? "delivered" : null,
          txHashes: args.includes("--execute") ? ["0xvenus"] : [],
        },
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
  if (name.endsWith("inventory-treasury.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        tokens: [],
      },
    };
  }
  if (name.endsWith("report-strategy-execution-surfaces.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        summary: { liveEligibleCount: 1, missingExecutorCount: 0 },
        strategies: [
          {
            id: "wrapped-btc-loop-base-moonwell",
            currentLiveEligible: false,
            liveAdmissionBlockers: [],
            evidence: {},
          },
        ],
      },
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
  if (name.endsWith("snapshot-btc-oracles.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        schemaVersion: 1,
        asset: "btc",
        observedAt: new Date().toISOString(),
        samples: [
          { source: "coinbase", priceUsd: 100000 },
          { source: "binance", priceUsd: 100050 },
        ],
        errors: [],
      },
    };
  }
  if (name.endsWith("price-snapshot.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "skipped=recently_unchanged\nobservedAt=2026-04-28T22:00:00.000Z\nbtcUsd=76000\n",
      stderr: "",
      json: null,
    };
  }
  if (name.endsWith("report-auto-kill-events.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        windowMs: 86400000,
        totalEvaluations24h: 0,
        triggerCounts: {},
        lastEvent: null,
        armedAt: null,
        killSwitchActive: false,
        currentState: "running",
      },
    };
  }
  if (name.endsWith("run-auto-kill-check.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        triggered: false,
        alreadyArmed: false,
        killSwitchActive: false,
        killSwitchWritten: false,
        killSwitchPath: "./state/kill.switch",
        triggers: [],
      },
    };
  }
  if (name.endsWith("report-campaign-aware-opportunities.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        generatedAt: new Date().toISOString(),
        candidateCount: 0,
        summary: { blocked: 0, manual_confirm: 0, auto_allowed: 0, observe: 0 },
        candidates: [],
      },
    };
  }
  if (name.endsWith("report-anchor-position-health.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      json: {
        observedAt: new Date().toISOString(),
        walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
        status: "no_positions",
        message: "No active Aerodrome CL positions detected.",
        positions: [],
      },
    };
  }
  if (name.endsWith("aggregate-auto-kill-inputs.mjs")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: "Wrote auto-kill trigger inputs:\n",
      stderr: "",
      json: null,
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
  assert.equal(report.summary.refillJobCount, 4);
  assert.equal(report.summary.treasuryRefillJobCount, 2);
  assert.equal(report.summary.capitalManagerRefillJobCount, 1);
  assert.equal(report.summary.inboundRouteJobCount, 1);
  assert.equal(report.summary.autoRefillJobCount, 2);
  assert.equal(report.summary.refillExecutedCount, 2);
  assert.deepEqual(report.summary.inboundInventory, {
    inboundEventCount: 2,
    operatingCapitalIngressCount: 2,
    paybackExcludedCount: 2,
    routeReadyCount: 1,
    manualReviewCount: 1,
    candidateQueueCount: 0,
    appendedEvents: 2,
    appendedJobs: 1,
    appendedPendingWhitelist: 1,
  });
  assert.equal(report.summary.capitalManager.capitalPlanDecision, "REFILL_REQUIRED");
  assert.equal(report.summary.capitalManager.refillJobCount, 1);
  assert.equal(report.summary.canarySweep.executedCount, 0);
  assert.equal(report.summary.destinationPromotionGate.allocationReadyCount, 2);
  assert.deepEqual(report.summary.destinationAllocator.tier1ActiveReadyChains, ["base", "bsc"]);
  assert.deepEqual(report.summary.representativeExecutionCoverage.allocatorReadyButNotQueuedChains, ["bsc"]);
  assert.equal(report.summary.destinationRepresentative.selectedTemplateId, "bsc:stablecoin_lending_carry");
  assert.equal(report.summary.destinationRepresentative.proofStatus, "delivered");
  assert.equal(report.summary.strategyDispatch.missingExecutorCount, 0);
  assert.equal(report.summary.strategyDispatch.capitalDispatchReadiness, "ready");
  assert.equal(report.summary.payback.pendingCarrySats, 601);
  assert.equal(report.summary.executionGate.liveCapableStepExecution, true);
  assert.equal(report.summary.executionGate.blockedReason, null);
});

test("all-chain autopilot keeps generic DEX canary sweep preview-only by default", async () => {
  const seen = [];
  const command = ({ args }) => {
    seen.push(args);
    return fakeCommand({ args });
  };

  await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: command,
    canaryMaxExecutedCandidates: 1,
    canaryMaxBroadcastSteps: 4,
    canaryMaxRecentBroadcasts: 1,
    canaryRecentBroadcastWindowMs: 600_000,
  });

  const sweepArgs = seen.find((args) => args[0] === "src/cli/run-live-canary-sweep.mjs");
  assert.ok(sweepArgs);
  assert.equal(sweepArgs.includes("--execute"), false);
  assert.equal(sweepArgs.includes("--max-executed-candidates=1"), true);
  assert.equal(sweepArgs.includes("--max-broadcast-steps=4"), true);
  assert.equal(sweepArgs.includes("--max-recent-broadcasts=1"), true);
  assert.equal(sweepArgs.includes("--recent-broadcast-window-ms=600000"), true);
});

test("all-chain autopilot can explicitly opt into generic DEX canary sweep execution", async () => {
  const seen = [];
  const command = ({ args }) => {
    seen.push(args);
    return fakeCommand({ args });
  };

  await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: command,
    enableDexProbeExecution: true,
  });

  const sweepArgs = seen.find((args) => args[0] === "src/cli/run-live-canary-sweep.mjs");
  assert.ok(sweepArgs);
  assert.equal(sweepArgs.includes("--execute"), true);
});

test("all-chain autopilot refreshes market prices before auto-kill inputs", async () => {
  const seen = [];
  const command = ({ args, timeoutMs }) => {
    seen.push({ args, timeoutMs });
    return fakeCommand({ args });
  };

  await runAllChainAutopilot({
    execute: true,
    write: false,
    timeoutMs: 120_000,
    runCommandImpl: command,
  });

  const commandNames = seen.map((entry) => entry.args[0]);
  assert.equal(
    commandNames.indexOf("src/cli/price-snapshot.mjs") < commandNames.indexOf("src/cli/aggregate-auto-kill-inputs.mjs"),
    true,
  );
  assert.equal(
    commandNames.indexOf("src/cli/price-snapshot.mjs") < commandNames.indexOf("src/cli/run-auto-kill-check.mjs"),
    true,
  );
  assert.equal(seen.find((entry) => entry.args[0] === "src/cli/price-snapshot.mjs")?.timeoutMs, 30_000);
});

test("all-chain autopilot keeps same-tick refill execution ahead of strategy dispatch", async () => {
  const seen = [];
  const command = ({ args }) => {
    seen.push(args);
    const name = args[0];
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "REBALANCE_REQUIRED", actions: [{ type: "gas_float_top_up", chain: "base" }] },
          capitalPlan: { decision: "REFILL_REQUIRED", summary: { actionCount: 1, blockerCount: 0 } },
          jobs: {
            summary: { jobCount: 1, estimatedAssetValueUsd: 2 },
            jobs: [
              {
                jobId: "capital-gas",
                chain: "base",
                type: "refill_native",
                executionMethod: "gas_refuel_bridge_gas_zip",
                requiresManualReview: false,
                fundingSource: { selectionStatus: "ready" },
              },
            ],
          },
        },
      };
    }
    if (name.endsWith("plan-treasury-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: { summary: { jobCount: 0 }, jobs: [] },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: args.includes("--execute")
          ? { execution: { settlementStatus: "delivered" }, outcomeEvent: { status: "delivered" } }
          : { preparation: { status: "ready", executionMethod: "gas_refuel_bridge_gas_zip" } },
      };
    }
    return fakeCommand({ args });
  };

  await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: command,
  });

  const refillExecuteIndex = seen.findIndex(
    (args) => args[0] === "src/cli/run-refill-job-stub.mjs" && args.includes("--execute"),
  );
  const dispatchExecuteIndex = seen.findIndex(
    (args) => args[0] === "src/cli/run-strategy-catalog-dispatcher.mjs" && args.includes("--execute"),
  );
  const dispatchArgs = seen.find((args) => args[0] === "src/cli/run-strategy-catalog-dispatcher.mjs");
  assert.equal(refillExecuteIndex >= 0, true);
  assert.equal(dispatchExecuteIndex >= 0, true);
  assert.equal(dispatchArgs.includes("--compact"), true);
  assert.equal(dispatchArgs.includes("--bucket=executable_now"), true);
  assert.equal(refillExecuteIndex < dispatchExecuteIndex, true);
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
  assert.equal(report.summary.refillJobCount, 4);
});

test("all-chain autopilot does not execute refill jobs from stale inventory fallbacks", async () => {
  const seen = [];
  const command = ({ args }) => {
    seen.push(args);
    const name = args[0];
    if (name.endsWith("plan-treasury-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          inventorySource: "stored_snapshot_fallback",
          inventoryScanErrorCount: 1,
          summary: { jobCount: 1 },
          jobs: [
            {
              jobId: "stale-ready",
              chain: "base",
              asset: "wBTC.OFT",
              resourceKey: "base:wbtc.oft",
              executionMethod: "cross_chain_bridge_or_swap",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
            },
          ],
        },
      };
    }
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          inventorySource: "live_scan",
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
    if (name.endsWith("run-inbound-inventory-watcher.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: { summary: {}, routingPlan: { jobs: [] }, appended: {} },
      };
    }
    return fakeCommand({ args });
  };

  const report = await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: command,
  });

  assert.equal(report.summary.refillJobCount, 1);
  assert.equal(report.summary.autoRefillJobCount, 0);
  assert.equal(report.summary.inventoryFreshness.treasuryBlocker, "treasury_inventory_not_live");
  assert.equal(seen.some((args) => args[0] === "src/cli/run-refill-job-stub.mjs" && args.includes("--execute")), false);
});

test("all-chain autopilot gives long-running canary sweep its own timeout", async () => {
  const timeouts = {};
  const seen = [];
  const timedCommand = ({ args, timeoutMs }) => {
    timeouts[args[0]] = timeoutMs;
    seen.push(args);
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
  assert.equal(seen.some((args) => args.includes("src/cli/run-live-canary-sweep.mjs") && args.includes("--timeout-ms=456")), true);
  assert.equal(seen.some((args) => args.includes("src/cli/run-merkl-canary-autopilot.mjs") && args.includes("--timeout-ms=123")), true);
  assert.equal(seen.some((args) => args.includes("src/cli/run-merkl-portfolio-orchestrator.mjs") && args.includes("--timeout-ms=123")), true);
  assert.equal(seen.some((args) => args.includes("src/cli/run-strategy-catalog-dispatcher.mjs") && args.includes("--command-timeout-ms=789")), true);
});

test("all-chain autopilot publishes refill progress before long canary steps finish", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "all-chain-autopilot-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const command = async ({ args }) => {
    if (args[0].endsWith("run-live-canary-sweep.mjs")) {
      throw new Error("canary_hung");
    }
    return fakeCommand({ args });
  };

  await assert.rejects(
    runAllChainAutopilot({
      execute: true,
      write: true,
      dataDir,
      runCommandImpl: command,
    }),
    /canary_hung/u,
  );

  const latest = JSON.parse(await readFile(join(dataDir, "all-chain-autopilot-latest.json"), "utf8"));
  assert.equal(latest.status, "running");
  assert.equal(latest.phase, "refill_complete");
  assert.equal(latest.summary.refillExecutedCount, 2);
  assert.equal(latest.summary.refillAttemptedCount, 2);
  assert.equal(latest.summary.capitalManager.capitalPlanDecision, "REFILL_REQUIRED");
  assert.equal(latest.summary.strategyDispatch.capitalDispatchReadiness, "ready");
  assert.equal(latest.refillExecutions.length, 2);
  await assert.rejects(readFile(join(dataDir, "all-chain-autopilot-latest-completed.json"), "utf8"), /ENOENT/u);
});

test("all-chain autopilot writes latest completed snapshot after a finished run", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "all-chain-autopilot-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const report = await runAllChainAutopilot({
    execute: true,
    write: true,
    dataDir,
    runCommandImpl: fakeCommand,
  });

  const latestCompleted = JSON.parse(await readFile(join(dataDir, "all-chain-autopilot-latest-completed.json"), "utf8"));
  assert.equal(latestCompleted.status, report.status);
  assert.equal(latestCompleted.phase, report.phase);
  assert.equal(latestCompleted.summary.refillExecutedCount, report.summary.refillExecutedCount);
});

test("all-chain autopilot runs auto-kill before live-capable steps and suppresses execute when armed", async () => {
  const seen = [];
  const command = ({ args }) => {
    seen.push(args);
    const name = args[0];
    if (name.endsWith("run-auto-kill-check.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          triggered: true,
          alreadyArmed: false,
          killSwitchWritten: true,
          killSwitchPath: "./state/kill.switch",
          triggers: [{ trigger: "failure_burst" }],
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

  const commandNames = seen.map((args) => args[0]);
  assert.equal(
    commandNames.indexOf("src/cli/run-auto-kill-check.mjs") < commandNames.indexOf("src/cli/run-live-canary-sweep.mjs"),
    true,
  );
  assert.equal(
    seen.some((args) => args[0] === "src/cli/run-live-canary-sweep.mjs" && args.includes("--execute")),
    false,
  );
  assert.equal(
    seen.some((args) => args[0] === "src/cli/run-strategy-catalog-dispatcher.mjs" && args.includes("--execute")),
    false,
  );
  assert.equal(
    seen.some((args) => args[0] === "src/cli/run-payback-scheduler.mjs" && args.includes("--execute")),
    false,
  );
  assert.equal(report.status, "completed_with_blockers");
  assert.equal(report.summary.executionGate.liveCapableStepExecution, false);
  assert.equal(report.summary.executionGate.blockedReason, "auto_kill_triggered");
});

test("all-chain autopilot suppresses execute when the kill-switch is already active without a new trigger", async () => {
  const seen = [];
  const command = ({ args }) => {
    seen.push(args);
    const name = args[0];
    if (name.endsWith("run-auto-kill-check.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          triggered: false,
          alreadyArmed: true,
          killSwitchActive: true,
          killSwitchWritten: false,
          killSwitchPath: "./state/kill.switch",
          triggers: [],
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

  assert.equal(
    seen.some((args) => args[0] === "src/cli/run-live-canary-sweep.mjs" && args.includes("--execute")),
    false,
  );
  assert.equal(report.summary.executionGate.liveCapableStepExecution, false);
  assert.equal(report.summary.executionGate.blockedReason, "kill_switch_armed");
  assert.equal(report.summary.executionGate.killSwitchActive, true);
  assert.equal(report.summary.autoKill.killSwitchActive, true);
});

test("all-chain autopilot pauses exhausted discretionary refill categories without blocking live dispatch", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "all-chain-autopilot-budget-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });
  await writeFile(
    join(dataDir, "receipt-reconciliations.jsonl"),
    `${JSON.stringify({
      observedAt: new Date().toISOString(),
      kind: "gas_zip_native_refuel",
      realized: {
        actualKnownCostUsd: 5.25,
      },
    })}\n`,
    "utf8",
  );

  const seen = [];
  const command = ({ args }) => {
    seen.push(args);
    const name = args[0];
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "gas-budgeted",
              chain: "optimism",
              asset: "ETH",
              type: "refill_native",
              executionMethod: "gas_refuel_bridge_gas_zip",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
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
          preparation: {
            status: "ready",
            executionMethod: "gas_refuel_bridge_gas_zip",
            executor: "gas_zip_native_refuel",
            plan: {
              amountUsd: 1.2,
            },
          },
          execution: args.includes("--execute") ? { settlementStatus: "delivered" } : null,
        },
      };
    }
    return fakeCommand({ args });
  };

  const report = await runAllChainAutopilotImpl({
    execute: true,
    write: false,
    dataDir,
    runCommandImpl: command,
  });

  assert.equal(
    seen.some((args) => args[0] === "src/cli/run-refill-job-stub.mjs" && args.includes("--execute")),
    false,
  );
  assert.equal(
    seen.some((args) => args[0] === "src/cli/run-live-canary-sweep.mjs" && args.includes("--execute")),
    false,
  );
  assert.equal(
    seen.some((args) => args[0] === "src/cli/run-strategy-catalog-dispatcher.mjs" && args.includes("--execute")),
    true,
  );
  assert.equal(report.refillExecutions[0].previewBlockedReason, "discretionary_budget_24h_category_exhausted");
  assert.equal(report.refillExecutions[0].attempted, false);
  assert.equal(report.summary.refillExecutedCount, 0);
});

test("all-chain autopilot retries refill jobs with executable alternate methods after no_route", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
  assert.equal(seen.some((args) => args.includes("--execute") && args.includes("--timeout-ms=300000")), true);
});

test("all-chain autopilot treats unsupported bridge refill previews as alternate-route blockers", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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

test("all-chain autopilot promotes Soneium Gateway no_route previews to LI.FI when available", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "soneium-usdc",
              chain: "soneium",
              asset: "USDC",
              type: "refill_token",
              executionMethod: "cross_chain_bridge_or_swap",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
              candidateMethods: [
                {
                  method: "cross_chain_bridge_or_swap",
                  availability: "ready",
                  source: { chain: "base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                  missingInputs: [],
                },
                {
                  method: "cross_chain_bridge_lifi",
                  availability: "ready",
                  source: { chain: "base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                  missingInputs: [],
                },
              ],
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (!args.includes("--method=cross_chain_bridge_lifi")) {
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
          forcedMethod: "cross_chain_bridge_lifi",
          preparation: { status: "ready", executionMethod: "cross_chain_bridge_lifi" },
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
  assert.equal(report.refillExecutions[0].selectedExecutionMethod, "cross_chain_bridge_lifi");
  assert.equal(seen.some((args) => args.includes("--method=cross_chain_bridge_lifi")), true);
});

test("all-chain autopilot does not promote Gateway source-gas blockers to LI.FI", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "base-gateway-source-gas",
              chain: "avalanche",
              asset: "wBTC.OFT",
              type: "refill_token",
              executionMethod: "cross_chain_bridge_or_swap",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
              candidateMethods: [
                {
                  method: "cross_chain_bridge_or_swap",
                  availability: "ready",
                  source: { chain: "base", token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
                  missingInputs: [],
                },
                {
                  method: "cross_chain_bridge_lifi",
                  availability: "ready",
                  source: { chain: "base", token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
                  missingInputs: [],
                },
              ],
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (args.includes("--method=cross_chain_bridge_lifi")) {
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          json: {
            forcedMethod: "cross_chain_bridge_lifi",
            preparation: { status: "ready", executionMethod: "cross_chain_bridge_lifi" },
            execution: args.includes("--execute") ? { settlementStatus: "delivered" } : null,
          },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          preparation: {
            status: "blocked",
            executionMethod: "cross_chain_bridge_or_swap",
            blockedReason: "insufficient_funds",
            plan: {
              blockedReason: "insufficient_funds",
              preflightError: {
                message: "All RPC endpoints failed gas estimate for chain: base",
                attempts: [
                  {
                    message:
                      "insufficient funds for gas * price + value: have 7563079830170 want 21575038434712",
                  },
                ],
              },
            },
          },
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

  assert.equal(report.summary.refillExecutedCount, 0);
  assert.equal(report.refillExecutions[0].selectedExecutionMethod, "cross_chain_bridge_or_swap");
  assert.equal(report.refillExecutions[0].previewBlockedReason, "insufficient_funds");
  assert.equal(seen.some((args) => args.includes("--method=cross_chain_bridge_lifi")), false);
});

test("all-chain autopilot retries alternate refill routes after execution_reverted previews", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "soneium-wbtc",
              chain: "soneium",
              asset: "wBTC.OFT",
              type: "refill_token",
              executionMethod: "cross_chain_bridge_or_swap",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
              candidateMethods: [
                {
                  method: "cross_chain_bridge_or_swap",
                  availability: "ready",
                  source: { chain: "avalanche", token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
                  missingInputs: [],
                },
                {
                  method: "cross_chain_bridge_lifi",
                  availability: "ready",
                  source: { chain: "avalanche", token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
                  missingInputs: [],
                },
              ],
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (!args.includes("--method=cross_chain_bridge_lifi")) {
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          json: { preparation: { status: "blocked", blockedReason: "execution_reverted" } },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          forcedMethod: "cross_chain_bridge_lifi",
          preparation: { status: "ready", executionMethod: "cross_chain_bridge_lifi" },
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
  assert.equal(report.refillExecutions[0].previewBlockedReason, null);
  assert.equal(report.refillExecutions[0].selectedExecutionMethod, "cross_chain_bridge_lifi");
  assert.equal(seen.some((args) => args.includes("--method=cross_chain_bridge_lifi") && args.includes("--execute")), true);
});

test("all-chain autopilot reports routing_exhausted after retryable providers reject", async () => {
  const command = ({ args }) => {
    const name = args[0];
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "exhausted",
              chain: "soneium",
              asset: "USDC",
              type: "refill_token",
              executionMethod: "cross_chain_bridge_or_swap",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
              candidateMethods: [
                {
                  method: "cross_chain_bridge_or_swap",
                  availability: "ready",
                  source: { chain: "base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                  missingInputs: [],
                },
                {
                  method: "cross_chain_bridge_lifi",
                  availability: "ready",
                  source: { chain: "base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                  missingInputs: [],
                },
              ],
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
          preparation: {
            status: "blocked",
            blockedReason: args.includes("--method=cross_chain_bridge_lifi") ? "lifi_quote_rejected" : "no_route",
          },
        },
      };
    }
    return fakeCommand({ args });
  };

  const report = await runAllChainAutopilot({
    execute: false,
    write: false,
    runCommandImpl: command,
  });

  assert.equal(report.refillExecutions[0].previewBlockedReason, "routing_exhausted");
});

test("all-chain autopilot retries alternate refill methods after native gas bootstrap deadlock", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "eth-native-deadlock",
              chain: "ethereum",
              asset: "ETH",
              type: "refill_native",
              executionMethod: "same_chain_token_to_native_swap",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
              candidateMethods: [
                {
                  method: "same_chain_token_to_native_swap",
                  availability: "ready",
                  source: { chain: "ethereum", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
                  missingInputs: [],
                },
                {
                  method: "cross_chain_bridge_lifi",
                  availability: "ready",
                  source: { chain: "base", token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
                  missingInputs: [],
                },
              ],
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (!args.includes("--method=cross_chain_bridge_lifi")) {
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          json: { preparation: { status: "blocked", blockedReason: "insufficient_native_gas_balance" } },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          forcedMethod: "cross_chain_bridge_lifi",
          preparation: { status: "ready", executionMethod: "cross_chain_bridge_lifi" },
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
  assert.equal(report.refillExecutions[0].selectedExecutionMethod, "cross_chain_bridge_lifi");
  assert.equal(seen.some((args) => args.includes("--method=cross_chain_bridge_lifi") && args.includes("--execute")), true);
});

test("all-chain autopilot retries alternate refill execution methods after retryable live failures", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(args);
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "live-retry",
              chain: "soneium",
              asset: "wBTC.OFT",
              type: "refill_token",
              executionMethod: "cross_chain_bridge_lifi",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
              candidateMethods: [
                {
                  method: "cross_chain_bridge_lifi",
                  availability: "ready",
                  source: { chain: "avalanche", token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
                  missingInputs: [],
                },
                {
                  method: "cross_chain_bridge_across",
                  availability: "ready",
                  source: { chain: "avalanche", token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" },
                  missingInputs: [],
                },
              ],
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (args.includes("--execute") && args.includes("--method=cross_chain_bridge_lifi")) {
        return {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "Execution reverted",
          json: {
            forcedMethod: "cross_chain_bridge_lifi",
            execution: {
              settlementStatus: "failed",
              error: { message: "execution_reverted" },
            },
            outcomeEvent: {
              status: "failed",
              blockers: ["execution_reverted"],
            },
            error: { message: "execution_reverted" },
          },
          error: { name: "Error", message: "Execution reverted" },
        };
      }
      if (args.includes("--method=cross_chain_bridge_across")) {
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          json: {
            forcedMethod: "cross_chain_bridge_across",
            preparation: { status: "ready", executionMethod: "cross_chain_bridge_across" },
            execution: args.includes("--execute") ? { settlementStatus: "delivered" } : null,
          },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          forcedMethod: "cross_chain_bridge_lifi",
          preparation: { status: "ready", executionMethod: "cross_chain_bridge_lifi" },
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
  assert.equal(report.refillExecutions[0].selectedExecutionMethod, "cross_chain_bridge_across");
  assert.equal(seen.some((args) => args.includes("--method=cross_chain_bridge_lifi") && args.includes("--execute")), true);
  assert.equal(seen.some((args) => args.includes("--method=cross_chain_bridge_across") && args.includes("--execute")), true);
});

test("all-chain autopilot separates refill attempts from delivered executions", async () => {
  const command = ({ args }) => {
    const name = args[0];
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "blocked-execute",
              chain: "base",
              asset: "USDC",
              type: "refill_token",
              executionMethod: "cross_chain_bridge_across",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (args.includes("--execute")) {
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          json: {
            status: "blocked",
            blockers: ["strategy_per_trade_cap_exceeded"],
          },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: { preparation: { status: "ready", executionMethod: "cross_chain_bridge_across" } },
      };
    }
    return fakeCommand({ args });
  };

  const report = await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: command,
  });

  assert.equal(report.summary.refillAttemptedCount, 1);
  assert.equal(report.summary.refillExecutedCount, 0);
  assert.equal(report.refillExecutions[0].attempted, true);
  assert.equal(report.refillExecutions[0].executed, false);
  assert.equal(report.refillExecutions[0].executionStatus, "blocked");
  assert.equal(report.refillExecutions[0].executionBlockedReason, "strategy_per_trade_cap_exceeded");
});

test("all-chain autopilot reserves shared source inventory across refill jobs", async () => {
  const seen = [];
  const source = {
    chain: "avalanche",
    token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    actual: "10000",
    actualDecimal: 0.0001,
    estimatedUsd: 7.5,
  };
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
          summary: { jobCount: 0 },
          jobs: [],
        },
      };
    }
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "REBALANCE_REQUIRED", actions: [] },
          capitalPlan: { decision: "REFILL_REQUIRED", summary: { actionCount: 2, blockerCount: 0 } },
          jobs: {
            summary: { jobCount: 2, estimatedAssetValueUsd: 12 },
            jobs: [
              {
                jobId: "shared-source-1",
                chain: "base",
                asset: "wBTC.OFT",
                type: "refill_token",
                token: source.token,
                targetAmount: "8000",
                targetAmountDecimal: 0.00008,
                executionMethod: "cross_chain_bridge_lifi",
                requiresManualReview: false,
                fundingSource: { selectionStatus: "ready", source },
              },
              {
                jobId: "shared-source-2",
                chain: "bsc",
                asset: "wBTC.OFT",
                type: "refill_token",
                token: source.token,
                targetAmount: "8000",
                targetAmountDecimal: 0.00008,
                executionMethod: "cross_chain_bridge_lifi",
                requiresManualReview: false,
                fundingSource: { selectionStatus: "ready", source },
              },
            ],
          },
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
          forcedMethod: "cross_chain_bridge_lifi",
          preparation: { status: "ready", executionMethod: "cross_chain_bridge_lifi" },
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

  assert.equal(report.summary.refillAttemptedCount, 1);
  assert.equal(report.summary.refillExecutedCount, 1);
  assert.equal(report.refillExecutions.length, 2);
  assert.equal(report.refillExecutions[0].jobId, "shared-source-1");
  assert.equal(report.refillExecutions[0].executed, true);
  assert.equal(report.refillExecutions[1].jobId, "shared-source-2");
  assert.equal(report.refillExecutions[1].attempted, false);
  assert.equal(report.refillExecutions[1].previewBlockedReason, "source_inventory_reserved");
  assert.equal(seen.filter((args) => args[0].endsWith("run-refill-job-stub.mjs") && args.includes("--execute")).length, 1);
});

test("all-chain autopilot surfaces unresolved live execution status instead of preview ready", async () => {
  const command = ({ args }) => {
    const name = args[0];
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "source-confirmed-only",
              chain: "ethereum",
              asset: "ETH",
              type: "refill_native",
              executionMethod: "cross_chain_bridge_lifi",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
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
        json: args.includes("--execute")
          ? {
              execution: {
                settlementStatus: "source_confirmed_only",
              },
              outcomeEvent: {
                status: "source_confirmed_only",
              },
            }
          : {
              preparation: {
                status: "ready",
                executionMethod: "cross_chain_bridge_lifi",
              },
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

  assert.equal(report.summary.refillAttemptedCount, 1);
  assert.equal(report.summary.refillExecutedCount, 0);
  assert.equal(report.refillExecutions[0].executionStatus, "source_confirmed_only");
  assert.equal(report.refillExecutions[0].executionBlockedReason, "source_confirmed_only");
  assert.equal(report.refillExecutions[0].previewStatus, null);
});

test("all-chain autopilot keeps parsed refill execution failures as blockers", async () => {
  const command = ({ args }) => {
    const name = args[0];
    if (name.endsWith("plan-capital-manager-refill-jobs.mjs")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: {
          rebalancePlan: { decision: "BALANCED", actions: [] },
          capitalPlan: { decision: "BALANCED", summary: { actionCount: 0, blockerCount: 0 } },
          jobs: { summary: { jobCount: 0, estimatedAssetValueUsd: 0 }, jobs: [] },
        },
      };
    }
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
              jobId: "timeout-execute",
              chain: "base",
              asset: "USDC",
              type: "refill_token",
              executionMethod: "cross_chain_bridge_across",
              requiresManualReview: false,
              fundingSource: { selectionStatus: "ready" },
            },
          ],
        },
      };
    }
    if (name.endsWith("run-refill-job-stub.mjs")) {
      if (args.includes("--execute")) {
        return {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "Command failed",
          json: {
            execution: {
              settlementStatus: "failed",
              error: { message: "Signer daemon response timed out after 30000ms" },
            },
            outcomeEvent: {
              status: "failed",
            },
            error: { message: "Signer daemon response timed out after 30000ms" },
          },
          error: { name: "Error", message: "Command failed" },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        json: { preparation: { status: "ready", executionMethod: "cross_chain_bridge_across" } },
      };
    }
    return fakeCommand({ args });
  };

  const report = await runAllChainAutopilot({
    execute: true,
    write: false,
    runCommandImpl: command,
    timeoutMs: 120000,
  });

  assert.equal(report.status, "completed_with_blockers");
  assert.equal(report.blockedReason, null);
  assert.equal(report.summary.refillAttemptedCount, 1);
  assert.equal(report.summary.refillExecutedCount, 0);
  assert.equal(report.refillExecutions[0].executionStatus, "failed");
  assert.equal(report.refillExecutions[0].executionBlockedReason, "Signer daemon response timed out after 30000ms");
});

test("all-chain autopilot treats Merkl canary blocked json as recoverable during execute", async () => {
  const command = ({ args }) => {
    const name = args[0];
    if (name.endsWith("run-merkl-canary-autopilot.mjs")) {
      return {
        ok: false,
        exitCode: 1,
        stdout: JSON.stringify({
          status: "blocked",
          blockedReason: "insufficient_live_asset_balance",
          summary: {
            selectedChain: "base",
            selectedProtocolId: "yo",
            selectedBindingKind: "erc4626_vault_supply_withdraw",
            selectedAmountUsd: 0.100024,
          },
        }),
        stderr: "Error: Insufficient asset balance",
        json: {
          status: "blocked",
          blockedReason: "insufficient_live_asset_balance",
          summary: {
            selectedChain: "base",
            selectedProtocolId: "yo",
            selectedBindingKind: "erc4626_vault_supply_withdraw",
            selectedAmountUsd: 0.100024,
          },
        },
        error: { name: "Error", message: "Error: Insufficient asset balance" },
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
  assert.equal(report.summary.merklCanary.blockedReason, "insufficient_live_asset_balance");
});

test("all-chain autopilot keeps running when Merkl execution subprocesses fail without json", async () => {
  const seen = [];
  const command = ({ args }) => {
    const name = args[0];
    seen.push(name);
    if (name.endsWith("run-merkl-canary-autopilot.mjs")) {
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "Error: waitForTransaction failed for ethereum across 3 RPC endpoint(s): timeout",
        json: null,
        error: {
          name: "CommandFailed",
          message: "Error: waitForTransaction failed for ethereum across 3 RPC endpoint(s): timeout",
        },
      };
    }
    if (name.endsWith("run-merkl-portfolio-orchestrator.mjs")) {
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "Command timed out after 600000ms",
        json: null,
        error: { name: "Error", message: "Command timed out after 600000ms" },
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
  assert.ok(seen.some((name) => name.endsWith("run-strategy-catalog-dispatcher.mjs")));
  assert.ok(seen.some((name) => name.endsWith("run-payback-scheduler.mjs")));
});

test("defaultRunCommand does not retain a referenced child-process handle after the command resolves", async () => {
  const countHandles = (name) =>
    process._getActiveHandles().filter((handle) => handle?.constructor?.name === name).length;

  const beforeChildProcessCount = countHandles("ChildProcess");
  const result = await defaultRunCommand({
    args: ["-e", "console.log(JSON.stringify({ ok: true }))"],
    timeoutMs: 5_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.json, { ok: true });
  assert.equal(countHandles("ChildProcess"), beforeChildProcessCount);
});
