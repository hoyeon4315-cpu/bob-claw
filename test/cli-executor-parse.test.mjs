import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseArgs as parseGasZipArgs } from "../src/cli/run-gas-zip-refuel.mjs";
import { parseArgs as parseCapitalManagerArgs } from "../src/cli/plan-capital-manager-refill-jobs.mjs";
import { buildFullAutomationReadiness, parseArgs as parseFullAutomationArgs } from "../src/cli/check-full-automation-readiness.mjs";
import { parseArgs as parseRuntimeReadinessArgs } from "../src/cli/check-executor-runtime.mjs";
import { parseArgs as parseLaunchdArgs, retryableBootstrapFailure } from "../src/cli/manage-executor-launchd.mjs";
import { retryableBootstrapFailure as retryableLiveAutomationBootstrapFailure } from "../src/cli/manage-live-automation-launchd.mjs";
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
      executionSurfaces: { summary: { liveEligibleCount: 0 } },
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
  assert.deepEqual(report.blockers, ["capital_rebalancer_not_ready", "strategy_dispatch_not_ready"]);
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
        attemptedCount: 1,
        executedCount: 0,
      },
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.liveAutomation.ready, false);
  assert.equal(report.liveAutomation.nextAction, "resolve_refill_routes");
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
  assert.deepEqual(report.blockers, []);
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
