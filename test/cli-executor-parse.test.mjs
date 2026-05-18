import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseArgs as parseGasZipArgs } from "../src/cli/run-gas-zip-refuel.mjs";
import { parseArgs as parseCapitalManagerArgs } from "../src/cli/plan-capital-manager-refill-jobs.mjs";
import {
  buildFullAutomationReadiness,
  collectReadinessDependencies,
  parseArgs as parseFullAutomationArgs,
  runJsonCli,
} from "../src/cli/check-full-automation-readiness.mjs";
import { parseArgs as parseRuntimeReadinessArgs } from "../src/cli/check-executor-runtime.mjs";
import { parseArgs as parseLaunchdArgs, retryableBootstrapFailure } from "../src/cli/manage-executor-launchd.mjs";
import {
  parseArgs as parseLiveAutomationLaunchdArgs,
  retryableBootstrapFailure as retryableLiveAutomationBootstrapFailure,
  runLiveAutomationLaunchdAction,
} from "../src/cli/manage-live-automation-launchd.mjs";
import { parseArgs as parseResetConsecutiveFailureArgs } from "../src/cli/run-reset-consecutive-failures.mjs";
import {
  parseArgs as parsePaybackSchedulerArgs,
  paybackDisbursementRecordFromTickResult,
  persistResult as persistPaybackSchedulerResult,
} from "../src/cli/run-payback-scheduler.mjs";

test("run-gas-zip-refuel parseArgs reads execution and settlement options", () => {
  const args = parseGasZipArgs([
    "--json",
    "--write",
    "--execute",
    "--src-chain=base",
    "--dst-chain=sonic",
    "--amount-wei=1000000000000000",
    "--minimum-destination-wei=990000000000000",
    "--required-destination-balance-wei=2000000000000000",
    "--sender=0x1111111111111111111111111111111111111111",
    "--recipient=0x2222222222222222222222222222222222222222",
    "--strategy-id=gas-zip-smoke",
    "--socket-path=/tmp/bob-signer.sock",
    "--timeout-ms=45000",
    "--confirmations=3",
    "--confirmation-timeout-ms=600000",
    "--destination-timeout-ms=120000",
    "--destination-poll-interval-ms=2500",
    "--gas-buffer-bps=1750",
    "--no-await-confirmation",
    "--no-await-destination-settlement",
  ]);

  assert.equal(args.json, true);
  assert.equal(args.write, true);
  assert.equal(args.execute, true);
  assert.equal(args.srcChain, "base");
  assert.equal(args.dstChain, "sonic");
  assert.equal(args.amountWei, "1000000000000000");
  assert.equal(args.minimumDestinationWei, "990000000000000");
  assert.equal(args.requiredDestinationBalanceWei, "2000000000000000");
  assert.equal(args.sender, "0x1111111111111111111111111111111111111111");
  assert.equal(args.recipient, "0x2222222222222222222222222222222222222222");
  assert.equal(args.strategyId, "gas-zip-smoke");
  assert.equal(args.socketPath, "/tmp/bob-signer.sock");
  assert.equal(args.timeoutMs, 45000);
  assert.equal(args.awaitConfirmation, false);
  assert.equal(args.awaitDestinationSettlement, false);
  assert.equal(args.confirmations, 3);
  assert.equal(args.confirmationTimeoutMs, 600000);
  assert.equal(args.destinationSettlementTimeoutMs, 120000);
  assert.equal(args.destinationPollIntervalMs, 2500);
  assert.equal(args.gasBufferBps, 1750);
});

test("plan-capital-manager-refill-jobs parseArgs reads planner flags", () => {
  const args = parseCapitalManagerArgs([
    "--json",
    "--write",
    "--refresh-inventory",
    "--include-inactive",
    "--address=0x3333333333333333333333333333333333333333",
  ]);

  assert.equal(args.json, true);
  assert.equal(args.write, true);
  assert.equal(args.refreshInventory, true);
  assert.equal(args.includeInactive, true);
  assert.equal(args.address, "0x3333333333333333333333333333333333333333");
});

test("reset-consecutive-failures parseArgs reads operator reset options", () => {
  const args = parseResetConsecutiveFailureArgs([
    "--strategy-id=wrapped-btc-loop-base-moonwell",
    "--chain=base",
    "--reason=clear after funding gas",
    "--actor=operator_via_cli",
    "--root-dir=/tmp/bob-claw",
    "--json",
  ]);

  assert.equal(args.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(args.chain, "base");
  assert.equal(args.reason, "clear after funding gas");
  assert.equal(args.actor, "operator_via_cli");
  assert.equal(args.rootDir, "/tmp/bob-claw");
  assert.equal(args.json, true);
});

test("run-payback-scheduler parseArgs reads loop and poll settings", () => {
  const args = parsePaybackSchedulerArgs([
    "--json",
    "--write",
    "--loop",
    "--execute",
    "--socket-path=/tmp/payback-signer.sock",
    "--timeout-ms=45000",
    "--confirmations=2",
    "--confirmation-timeout-ms=180000",
    "--destination-timeout-ms=240000",
    "--destination-poll-interval-ms=3000",
    "--bitcoin-settlement-timeout-ms=600000",
    "--bitcoin-poll-interval-ms=15000",
    "--poll-interval-ms=900000",
    "--no-await-confirmation",
    "--no-await-destination-settlement",
  ]);

  assert.equal(args.json, true);
  assert.equal(args.write, true);
  assert.equal(args.loop, true);
  assert.equal(args.once, false);
  assert.equal(args.execute, true);
  assert.equal(args.socketPath, "/tmp/payback-signer.sock");
  assert.equal(args.timeoutMs, 45000);
  assert.equal(args.awaitConfirmation, false);
  assert.equal(args.awaitDestinationSettlement, false);
  assert.equal(args.confirmations, 2);
  assert.equal(args.confirmationTimeoutMs, 180000);
  assert.equal(args.destinationSettlementTimeoutMs, 240000);
  assert.equal(args.destinationPollIntervalMs, 3000);
  assert.equal(args.bitcoinSettlementTimeoutMs, 600000);
  assert.equal(args.bitcoinPollIntervalMs, 15000);
  assert.equal(args.pollIntervalMs, 900000);
});

test("run-payback-scheduler parseArgs defaults to once mode", () => {
  const args = parsePaybackSchedulerArgs([]);

  assert.equal(args.loop, false);
  assert.equal(args.once, true);
  assert.equal(args.execute, false);
  assert.equal(args.pollIntervalMs, undefined);
});

test("check-executor-runtime parseArgs reads json and strict flags", () => {
  const args = parseRuntimeReadinessArgs(["--json", "--strict"]);

  assert.equal(args.json, true);
  assert.equal(args.strict, true);
});

test("check-full-automation-readiness parseArgs reads refresh flags", () => {
  const args = parseFullAutomationArgs(["--json", "--strict", "--refresh"]);

  assert.equal(args.json, true);
  assert.equal(args.strict, true);
  assert.equal(args.refresh, true);
});

test("full automation readiness child command reports timeout instead of hanging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-readiness-"));
  const scriptPath = join(dir, "slow-json.mjs");
  await writeFile(scriptPath, "setTimeout(() => {}, 1000);\n", "utf8");

  const result = runJsonCli(scriptPath, [], { timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.equal(result.error, "timeout_after_5ms");
});

test("full automation readiness collects dependency commands in parallel", async () => {
  const started = [];
  const resolvers = [];
  const collectPromise = collectReadinessDependencies({
    refresh: true,
    runJsonCliImpl: (scriptPath, args) => {
      started.push({ scriptPath, args });
      return new Promise((resolve) => {
        resolvers.push(() =>
          resolve({
            ok: true,
            status: 0,
            signal: null,
            stdout: "{}",
            stderr: "",
            json: { scriptPath, args },
            error: null,
          }),
        );
      });
    },
  });

  assert.deepEqual(
    started.map((item) => item.scriptPath),
    [
      "src/cli/run-inbound-inventory-watcher.mjs",
      "src/cli/plan-capital-manager-refill-jobs.mjs",
      "src/cli/run-strategy-catalog-dispatcher.mjs",
      "src/cli/report-payback-status.mjs",
    ],
  );
  assert.deepEqual(started[0].args, ["--json", "--write"]);
  assert.deepEqual(started[1].args, ["--json", "--write", "--refresh-inventory"]);
  assert.deepEqual(started[2].args, ["--json", "--write", "--mode=auto"]);
  assert.deepEqual(started[3].args, ["--json"]);

  for (const resolve of resolvers) resolve();
  const reports = await collectPromise;

  assert.equal(reports.strategyDispatch.json.scriptPath, "src/cli/run-strategy-catalog-dispatcher.mjs");
  assert.deepEqual(reports.payback.json.args, ["--json"]);
});

test("full automation readiness blocks when a dependency command fails", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "BALANCED" },
      capitalPlan: { decision: "BALANCED" },
      jobs: {
        summary: { jobCount: 0 },
        jobs: [],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 1 },
      executionSurfaces: { summary: { liveEligibleCount: 1 } },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
    commandHealth: {
      payback: { ok: false, error: "timeout_after_45000ms" },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.dependencyCommands.ready, false);
  assert.equal(report.blockers.includes("dependency_command_failed:payback"), true);
});

test("full automation readiness reports isolated ingress and capital plan state", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 2,
        operatingCapitalIngressCount: 2,
        paybackExcludedCount: 2,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 1 },
        jobs: [{ requiresManualReview: false }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 3 },
      executionSurfaces: { summary: { liveEligibleCount: 1 } },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
  });

  assert.equal(report.ready, true);
  assert.equal(report.capitalManager.ready, true);
  assert.equal(report.ingress.ready, true);
  assert.equal(report.strategyDispatch.liveEligibleCount, 1);
});

test("full automation readiness blocks when no auto refill or live strategy is available", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 2 },
        jobs: [{ requiresManualReview: true }, { requiresManualReview: true }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 8 },
      executionSurfaces: {
        summary: { liveEligibleCount: 0 },
        strategies: [
          {
            id: "wrapped-btc-loop-base-moonwell",
            selectedMode: "dry_run",
            currentLiveEligible: false,
            liveAdmissionBlockers: ["fresh_roundtrip_proof_recorded"],
          },
        ],
      },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.capitalManager.ready, false);
  assert.equal(report.strategyDispatch.ready, false);
  assert.deepEqual(report.strategyDispatch.liveAdmissionBlockers, [
    {
      strategyId: "wrapped-btc-loop-base-moonwell",
      selectedMode: "dry_run",
      status: null,
      reason: null,
      blockers: ["fresh_roundtrip_proof_recorded"],
    },
  ]);
  assert.deepEqual(report.blockers, ["capital_rebalancer_not_ready", "strategy_dispatch_not_ready"]);
});

test("full automation readiness prefers concrete wrapped BTC blocker over generic gateway wrapper blocker", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 3 },
        jobs: [{ requiresManualReview: false }, { requiresManualReview: false }, { requiresManualReview: false }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 14 },
      executionSurfaces: {
        summary: { liveEligibleCount: 0 },
        strategies: [
          {
            id: "gateway_wrapped_btc_loops",
            selectedMode: "shadow",
            status: "candidate_for_validation",
            reason: "policy_ready",
            liveAdmissionBlockers: ["route_specific_executor_inputs_required"],
          },
          {
            id: "wrapped-btc-loop-base-moonwell",
            selectedMode: "dry_run",
            status: "candidate_for_validation",
            reason: "recent_live_transaction_cooldown",
            liveAdmissionBlockers: ["recent_live_transaction_cooldown"],
          },
        ],
      },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
    autopilot: {
      present: true,
      activeRun: false,
      status: "completed_with_blockers",
      nextAction: "continue_live_watch",
      refill: {
        blockedCount: 0,
        blockers: [],
        attemptedCount: 2,
        executedCount: 0,
      },
    },
  });

  assert.deepEqual(report.strategyDispatch.liveAdmissionBlockers, [
    {
      strategyId: "wrapped-btc-loop-base-moonwell",
      selectedMode: "dry_run",
      status: "candidate_for_validation",
      reason: "recent_live_transaction_cooldown",
      blockers: ["recent_live_transaction_cooldown"],
    },
  ]);
});

test("full automation readiness keeps concrete wrapped BTC blocker inside the top blocker slice", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 3 },
        jobs: [{ requiresManualReview: false }, { requiresManualReview: false }, { requiresManualReview: false }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 14 },
      executionSurfaces: {
        summary: { liveEligibleCount: 0 },
        strategies: [
          {
            id: "gateway_wrapped_btc_loops",
            selectedMode: "shadow",
            status: "candidate_for_validation",
            reason: "policy_ready",
            liveAdmissionBlockers: ["route_specific_executor_inputs_required"],
          },
          {
            id: "btc_proxy_spreads",
            selectedMode: "shadow",
            status: "thin_coverage",
            reason: "partial_amount_match",
            liveAdmissionBlockers: ["route_specific_executor_inputs_required"],
          },
          {
            id: "stablecoin_entry_exit_loops",
            selectedMode: "analysis",
            status: "measured_below_policy",
            reason: "amount_mismatch",
            liveAdmissionBlockers: ["analysis_probe_only", "live_executor_not_bound"],
          },
          {
            id: "tokenized_gold_rotation",
            selectedMode: "analysis",
            status: "thin_coverage",
            reason: "gateway_gold_exit_quote_preflight_failed",
            liveAdmissionBlockers: ["gateway_gold_exit_quote_preflight_failed", "status_not_candidate_for_validation"],
          },
          {
            id: "defillama-yield-portfolio",
            selectedMode: "shadow",
            status: "shadow_ready",
            reason: "receipt_bound_pools_via_snapshot_evidenceClass",
            liveAdmissionBlockers: ["shadow_only", "live_executor_not_bound"],
          },
          {
            id: "aggressive-velocity-v1",
            selectedMode: "live",
            status: "analysis_only",
            reason: "no_high_yield_candidates_selected",
            liveAdmissionBlockers: ["no_high_yield_candidates_selected"],
          },
          {
            id: "triangular_flash_btc",
            selectedMode: "dry_run",
            status: "measured_below_policy",
            reason: "latest_flash_negative",
            liveAdmissionBlockers: ["flash_live_admission_blocked", "status_not_candidate_for_validation"],
          },
          {
            id: "eth_family_gateway",
            selectedMode: "shadow",
            status: "unobserved",
            reason: "no_multichain_eth_family_surface",
            liveAdmissionBlockers: ["multichain_eth_surface_unconfirmed"],
          },
          {
            id: "eth_mixed_stable_loops",
            selectedMode: "analysis",
            status: "unobserved",
            reason: "no_mixed_eth_legs",
            liveAdmissionBlockers: ["analysis_probe_only", "live_executor_not_bound"],
          },
          {
            id: "wrapped-btc-loop-base-moonwell",
            selectedMode: "dry_run",
            status: "candidate_for_validation",
            reason: "recent_live_transaction_cooldown",
            liveAdmissionBlockers: ["recent_live_transaction_cooldown"],
          },
        ],
      },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
    autopilot: {
      present: true,
      activeRun: false,
      status: "completed_with_blockers",
      nextAction: "continue_live_watch",
      refill: {
        blockedCount: 0,
        blockers: [],
        attemptedCount: 2,
        executedCount: 0,
      },
    },
  });

  assert.equal(
    report.strategyDispatch.liveAdmissionBlockers.some(
      (entry) =>
        entry.strategyId === "wrapped-btc-loop-base-moonwell" && entry.reason === "recent_live_transaction_cooldown",
    ),
    true,
  );
});

test("full automation readiness treats Merkl canary auto-entry as a live execution lane", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 0 },
        jobs: [],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 8 },
      executionSurfaces: {
        summary: { liveEligibleCount: 0 },
        strategies: [],
      },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
    autopilot: {
      present: true,
      status: "completed_with_blockers",
      nextAction: "continue_live_watch",
      execution: {
        merklCanaryReadyCount: 4,
        merklCanarySelectedCount: 4,
        merklCanaryBlockedReason: "same_chain_unprofitable:need_$5_on_base",
      },
      refill: {
        blockedCount: 0,
        blockers: [],
        attemptedCount: 1,
        executedCount: 1,
      },
    },
  });

  assert.equal(report.ready, true);
  assert.equal(report.strategyDispatch.ready, true);
  assert.equal(report.strategyDispatch.liveEligibleCount, 0);
  assert.equal(report.strategyDispatch.merklCanaryReadyCount, 4);
  assert.equal(report.strategyDispatch.merklCanarySelectedCount, 4);
  assert.equal(report.strategyDispatch.merklCanaryBlockedReason, "same_chain_unprofitable:need_$5_on_base");
  assert.equal(report.capitalManager.ready, true);
  assert.deepEqual(report.blockers, []);
});

test("full automation readiness treats completed live watch automation as ready idle", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 3 },
        jobs: [{ requiresManualReview: false }, { requiresManualReview: false }, { requiresManualReview: false }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 11 },
      executionSurfaces: {
        summary: { liveEligibleCount: 0 },
        strategies: [
          {
            id: "gateway_wrapped_btc_loops",
            selectedMode: "shadow",
            status: "candidate_for_validation",
            reason: "policy_ready",
            liveAdmissionBlockers: ["route_specific_executor_inputs_required"],
          },
          {
            id: "defillama-yield-portfolio",
            selectedMode: "analysis",
            status: "analysis_only",
            reason: "adapter_wired_shadow_only",
            liveAdmissionBlockers: ["analysis_probe_only", "live_executor_not_bound"],
          },
        ],
      },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
        },
      },
    },
    autopilot: {
      present: true,
      activeRun: false,
      status: "completed",
      phase: "idle_consolidation_preview",
      nextAction: "continue_live_watch",
      refill: {
        blockedCount: 0,
        blockers: [],
        attemptedCount: 0,
        executedCount: 0,
      },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.strategyDispatch.ready, false);
  assert.equal(report.strategyDispatch.liveEligibleCount, 0);
  assert.equal(report.liveAutomation.ready, true);
  assert.deepEqual(report.blockers, ["strategy_dispatch_not_ready"]);
});

test("full automation readiness reflects unresolved autopilot refill blockers and payback reserve gaps", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 2 },
        jobs: [{ requiresManualReview: false }, { requiresManualReview: false }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 4 },
      executionSurfaces: { summary: { liveEligibleCount: 1 } },
    },
    payback: {
      payback: {
        scheduler: {
          status: "defer",
          reason: "reserve_asset_missing",
          nextAction: "restore_profit_reserve_wbtc_oft",
        },
      },
    },
    autopilot: {
      present: true,
      status: "completed_with_blockers",
      nextAction: "resolve_refill_routes",
      refill: {
        blockedCount: 3,
        blockers: [
          {
            chain: "avalanche",
            asset: "wBTC.OFT",
            reason: "Insufficient source balance: required 43948, available 26523",
            selectedMethod: "cross_chain_bridge_lifi",
          },
          {
            chain: "ethereum",
            asset: "RLUSD",
            reason: "routing_exhausted",
            selectedMethod: "cross_chain_bridge_or_swap",
          },
        ],
        attemptedCount: 1,
        executedCount: 0,
      },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.liveAutomation.ready, false);
  assert.equal(report.liveAutomation.nextAction, "resolve_refill_routes");
  assert.deepEqual(report.liveAutomation.refillIssueCounts, {
    inventory_insufficient: 1,
    routing_exhausted: 1,
  });
  assert.deepEqual(report.liveAutomation.refillBlockers, [
    {
      chain: "avalanche",
      asset: "wBTC.OFT",
      reason: "Insufficient source balance: required 43948, available 26523",
      category: "inventory_insufficient",
      selectedMethod: "cross_chain_bridge_lifi",
    },
    {
      chain: "ethereum",
      asset: "RLUSD",
      reason: "routing_exhausted",
      category: "routing_exhausted",
      selectedMethod: "cross_chain_bridge_or_swap",
    },
  ]);
  assert.equal(report.payback.ready, false);
  assert.equal(report.payback.nextAction, "restore_profit_reserve_wbtc_oft");
  assert.deepEqual(report.blockers, ["refill_routes_unresolved", "payback_reserve_missing"]);
});

test("full automation readiness ignores routing exhausted refill backlog as non-live-blocking", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 1 },
        jobs: [{ requiresManualReview: true }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 4 },
      executionSurfaces: { summary: { liveEligibleCount: 1 } },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          nextAction: null,
        },
      },
    },
    autopilot: {
      present: true,
      status: "completed_with_blockers",
      nextAction: "continue_live_watch",
      refill: {
        blockedCount: 1,
        blockers: [{ reason: "routing_exhausted", chain: "ethereum", asset: "wBTC.OFT" }],
        attemptedCount: 0,
        executedCount: 0,
      },
    },
  });

  assert.equal(report.ready, true);
  assert.equal(report.capitalManager.ready, true);
  assert.equal(report.capitalManager.autoRefillJobCount, 0);
  assert.equal(report.liveAutomation.ready, true);
  assert.equal(report.liveAutomation.refillBlockedCount, 1);
  assert.equal(report.liveAutomation.refillUnresolvedCount, null);
  assert.deepEqual(report.liveAutomation.refillIssueCounts, { routing_exhausted: 1 });
  assert.deepEqual(report.blockers, []);
});

test("full automation readiness ignores deterministic LiFi native gas refill deferrals as non-live-blocking", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 1 },
        jobs: [{ requiresManualReview: false }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 4 },
      executionSurfaces: { summary: { liveEligibleCount: 1 } },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          nextAction: null,
        },
      },
    },
    autopilot: {
      present: true,
      status: "completed_with_blockers",
      nextAction: "continue_live_watch",
      refill: {
        blockedCount: 1,
        blockers: [
          {
            reason: "insufficient_native_balance_for_lifi_gas",
            chain: "base",
            asset: "wBTC.OFT",
            selectedMethod: "cross_chain_bridge_lifi",
          },
        ],
        attemptedCount: 0,
        executedCount: 0,
      },
    },
  });

  assert.equal(report.ready, true);
  assert.equal(report.liveAutomation.ready, true);
  assert.deepEqual(report.liveAutomation.refillIssueCounts, { native_gas: 1 });
  assert.deepEqual(report.blockers, []);
});

test("full automation readiness ignores deterministic policy no-trade refill deferrals as non-live-blocking", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 2 },
        jobs: [{ requiresManualReview: false }, { requiresManualReview: false }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 4 },
      executionSurfaces: { summary: { liveEligibleCount: 0 } },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          nextAction: null,
        },
      },
    },
    autopilot: {
      present: true,
      status: "completed_with_blockers",
      nextAction: "continue_live_watch",
      refill: {
        blockedCount: 2,
        blockers: [
          {
            reason: "expected_net_below_receipt_cost_p90_floor,strategy_per_day_cap_exceeded",
            chain: "base",
            asset: "wBTC.OFT",
            selectedMethod: "cross_chain_bridge_lifi",
          },
          {
            reason: "expected_net_below_receipt_cost_p90_floor",
            chain: "optimism",
            asset: "USDC",
            selectedMethod: "cross_chain_bridge_lifi",
          },
        ],
        attemptedCount: 2,
        executedCount: 0,
      },
      merklCanary: {
        readyCount: 8,
        selectedCount: 6,
        status: "completed_with_blockers",
      },
    },
  });

  assert.equal(report.ready, true);
  assert.equal(report.liveAutomation.ready, true);
  assert.deepEqual(report.blockers, []);
});

test("full automation readiness surfaces active all-chain autopilot runs as wait state", () => {
  const report = buildFullAutomationReadiness({
    runtime: {
      summary: {
        ready: true,
        nextActionCode: "ready",
      },
    },
    inbound: {
      summary: {
        inboundEventCount: 0,
        operatingCapitalIngressCount: 0,
        paybackExcludedCount: 0,
      },
    },
    capitalManager: {
      rebalancePlan: { decision: "REBALANCE_REQUIRED" },
      capitalPlan: { decision: "REFILL_REQUIRED" },
      jobs: {
        summary: { jobCount: 1 },
        jobs: [{ requiresManualReview: false }],
      },
    },
    strategyDispatch: {
      record: { batchStatus: "preview", selectedCount: 4 },
      executionSurfaces: { summary: { liveEligibleCount: 1 } },
    },
    payback: {
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          nextAction: null,
        },
      },
    },
    autopilot: {
      present: true,
      activeRun: true,
      phase: "refill_complete",
      status: "running",
      nextAction: "await_all_chain_autopilot_completion",
      refill: {
        blockedCount: 1,
        unresolvedCount: 1,
        blockers: [
          {
            reason: "max_consecutive_failures_reached",
            chain: "base",
            asset: "cbBTC",
            selectedMethod: "same_chain_token_to_token_swap",
          },
        ],
        attemptedCount: 1,
        executedCount: 0,
      },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.liveAutomation.activeRun, true);
  assert.equal(report.liveAutomation.phase, "refill_complete");
  assert.equal(report.liveAutomation.ready, false);
  assert.equal(report.liveAutomation.nextAction, "await_all_chain_autopilot_completion");
  assert.deepEqual(report.blockers, ["all_chain_autopilot_running"]);
});

test("manage-executor-launchd parseArgs reads install and path overrides", () => {
  const args = parseLaunchdArgs([
    "--json",
    "--install",
    "--launch-agents-dir=/Users/test/Library/LaunchAgents",
    "--log-dir=/tmp/bob-launchd",
    "--node-path=/usr/local/bin/node",
    "--uid=501",
  ]);

  assert.equal(args.json, true);
  assert.equal(args.install, true);
  assert.equal(args.launchAgentsDir, "/Users/test/Library/LaunchAgents");
  assert.equal(args.logDir, "/tmp/bob-launchd");
  assert.equal(args.nodePath, "/usr/local/bin/node");
  assert.equal(args.uid, 501);
});

test("manage-executor-launchd retries transient bootstrap I/O failures", () => {
  assert.equal(retryableBootstrapFailure("Bootstrap failed: 5: Input/output error"), true);
  assert.equal(retryableBootstrapFailure("service already loaded"), false);
});

test("manage-live-automation-launchd retries transient bootstrap I/O failures", () => {
  assert.equal(retryableLiveAutomationBootstrapFailure("Bootstrap failed: 5: Input/output error"), true);
  assert.equal(retryableLiveAutomationBootstrapFailure("service already loaded"), false);
});

test("manage-live-automation-launchd parseArgs reads stop and start actions", () => {
  const stopArgs = parseLiveAutomationLaunchdArgs(["--json", "--stop", "--uid=501"]);
  assert.equal(stopArgs.json, true);
  assert.equal(stopArgs.stop, true);
  assert.equal(stopArgs.uid, 501);

  const startArgs = parseLiveAutomationLaunchdArgs(["--start", "--launch-agents-dir=/tmp/agents"]);
  assert.equal(startArgs.start, true);
  assert.equal(startArgs.launchAgentsDir, "/tmp/agents");
});

test("manage-live-automation-launchd stop and start use launchctl service actions", async () => {
  const commonArgs = [
    "--uid=501",
    "--root-dir=/repo",
    "--node-path=/usr/local/bin/node",
    "--launch-agents-dir=/Users/test/Library/LaunchAgents",
    "--log-dir=/repo/logs/launchd",
  ];
  const calls = [];
  const launchctlRunner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "", error: null };
  };
  const statusReader = async (spec) => ({
    id: spec.id,
    label: spec.label,
    status: "not_loaded",
    loaded: false,
    running: false,
    pid: null,
    plistPresent: true,
  });

  const stopPayload = await runLiveAutomationLaunchdAction(parseLiveAutomationLaunchdArgs(["--stop", ...commonArgs]), {
    launchctlRunner,
    statusReader,
  });
  assert.equal(stopPayload.action, "stop");
  assert.deepEqual(calls, [
    ["bootout", "gui/501/com.bobclaw.gate-self-heal"],
    ["bootout", "gui/501/com.bobclaw.all-chain-autopilot"],
  ]);

  calls.length = 0;
  const startPayload = await runLiveAutomationLaunchdAction(
    parseLiveAutomationLaunchdArgs(["--start", ...commonArgs]),
    { launchctlRunner, statusReader },
  );
  assert.equal(startPayload.action, "start");
  assert.deepEqual(calls, [
    ["bootstrap", "gui/501", "/Users/test/Library/LaunchAgents/com.bobclaw.gate-self-heal.plist"],
    ["kickstart", "-k", "gui/501/com.bobclaw.gate-self-heal"],
    ["bootstrap", "gui/501", "/Users/test/Library/LaunchAgents/com.bobclaw.all-chain-autopilot.plist"],
    ["kickstart", "-k", "gui/501/com.bobclaw.all-chain-autopilot"],
  ]);
});

test("run-payback-scheduler persists executed payback disbursements to signer audit log", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-payback-persist-"));
  const dataDir = join(tempDir, "data");
  const logsDir = join(tempDir, "logs");
  const disbursementRecord = {
    schemaVersion: 1,
    observedAt: "2026-04-24T00:00:00.000Z",
    kind: "payback_disbursement",
    strategyId: "gateway-btc-offramp",
    periodId: "week-2026-17",
    plannedPaybackSats: 60_000,
    settledBalanceDeltaSats: 58_000,
    gatewayOrderId: "order-1",
    bitcoinTxid: "btc-tx-1",
  };
  const result = {
    schemaVersion: 1,
    observedAt: "2026-04-24T00:00:00.000Z",
    status: "submitted",
    execution: {
      status: "submitted",
      disbursementRecord,
    },
  };

  assert.deepEqual(paybackDisbursementRecordFromTickResult(result), disbursementRecord);

  await persistPaybackSchedulerResult(result, { dataDir, logsDir });

  const tickLatest = JSON.parse(await readFile(join(dataDir, "payback-scheduler-tick-latest.json"), "utf8"));
  const tickLines = (await readFile(join(dataDir, "payback-scheduler-ticks.jsonl"), "utf8")).trim().split("\n");
  const auditLines = (await readFile(join(logsDir, "signer-audit.jsonl"), "utf8")).trim().split("\n");

  assert.equal(tickLatest.status, "submitted");
  assert.equal(tickLines.length, 1);
  assert.deepEqual(JSON.parse(auditLines[0]), disbursementRecord);
});
