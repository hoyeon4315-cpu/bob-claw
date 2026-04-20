#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { readJsonl, latestBy } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import {
  canStartExecution,
  buildExecutionBlockedEvent,
  buildExecutionFundingOutcomeEvent,
  buildExecutionFundingSnapshotEvent,
} from "../execution/journal.mjs";
import { readExecutionGuards } from "../execution/guards.mjs";
import { validateTreasuryPolicy, buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildDefaultRiskPolicy } from "../risk/policy.mjs";
import { buildExecutionRiskDecision, buildExecutionRiskState } from "../risk/execution-gate.mjs";
import {
  buildTreasuryRefillExecutionPlan,
  executeTreasuryRefillExecutionPlan,
} from "../executor/helpers/treasury-refill-job.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    force: flags.has("--force"),
    execute: flags.has("--execute"),
    jobId: options["job-id"] || null,
    mode: options.mode || "dry_run",
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    awaitDestinationSettlement: !flags.has("--no-await-destination-settlement"),
    confirmations: options.confirmations ? Number(options.confirmations) : 1,
    confirmationTimeoutMs: options["confirmation-timeout-ms"] ? Number(options["confirmation-timeout-ms"]) : 120_000,
    destinationSettlementTimeoutMs: options["destination-timeout-ms"] ? Number(options["destination-timeout-ms"]) : null,
    destinationPollIntervalMs: options["destination-poll-interval-ms"] ? Number(options["destination-poll-interval-ms"]) : 5_000,
  };
}

function printBlockedEvent(event, job) {
  console.log(`status=${event.status}`);
  console.log(`jobId=${event.jobId}`);
  console.log(`attemptId=${event.attemptId}`);
  console.log(`executionMethod=${event.executionMethod}`);
  console.log(`blockers=${event.blockers.join(",")}`);
  if (event.reviewReasons?.length) {
    console.log(`reviewReasons=${event.reviewReasons.join(",")}`);
  }
  if (job.systemEconomics?.routeKey) {
    console.log(`routeKey=${job.systemEconomics.routeKey}`);
  }
  if (Number.isFinite(job.systemEconomics?.effectiveSystemNetPnlUsd)) {
    console.log(`effectiveSystemNetPnlUsd=${job.systemEconomics.effectiveSystemNetPnlUsd}`);
  }
}

function fundingSourceAutoExecutable(fundingSource) {
  if (!fundingSource) return false;
  if (fundingSource.selectionStatus === "ready") return true;
  return (
    fundingSource.selectionStatus === "conditional" &&
    (fundingSource.missingInputs || []).length === 0 &&
    (fundingSource.settlementRequirements || []).length > 0 &&
    !fundingSource.requiresManualFunding
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobId) throw new Error("--job-id is required");

  const [jobs, events] = await Promise.all([
    readJsonl(config.dataDir, "treasury-refill-jobs"),
    readJsonl(config.dataDir, "execution-journal"),
  ]);
  const [receiptRecords, prices] = await Promise.all([
    readJsonl(config.dataDir, "receipt-reconciliations"),
    getCoinGeckoPricesUsd().catch(() => emptyPricesUsd()),
  ]);
  const latestJobs = [...latestBy(jobs, (item) => item.jobId).values()];
  const job = latestJobs.find((item) => item.jobId === args.jobId);
  if (!job) throw new Error(`Job not found: ${args.jobId}`);
  const resolved = await resolveOperationalAddress({ explicitAddress: job.address || null, dataDir: config.dataDir });

  const executionGate = canStartExecution(events, args.jobId, { force: args.force });
  if (!executionGate.ok) {
    throw new Error(`Execution blocked: ${executionGate.reason}`);
  }

  const fundingSource = job.fundingSource || null;
  if (fundingSource?.selectionStatus && !fundingSourceAutoExecutable(fundingSource)) {
    const event = buildExecutionBlockedEvent({
      job,
      mode: args.mode,
      blockers: [
        `funding_source_${fundingSource.selectionStatus}`,
        ...(fundingSource.missingInputs || []),
      ],
      fundingSource,
    });
    const store = new JsonlStore(config.dataDir);
    await store.append("execution-journal", event);
    if (args.json) {
      console.log(safeJsonStringify(event, 2));
      return;
    }
    printBlockedEvent(event, job);
    return;
  }

  const guards = await readExecutionGuards({
    emergencyStopPath: config.emergencyStopFlagPath,
    liveModePath: config.liveModeFlagPath,
    mode: args.mode,
  });
  if (guards.blocked) {
    throw new Error(`Execution guard blocked: ${guards.reasons.join(",")}`);
  }

  const signerHealth = await readSignerHealth({
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  }).catch(() => null);

  const treasuryPolicy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = await scanTreasuryInventory({
    policy: treasuryPolicy,
    address: resolved.address,
    prices,
  });
  const riskState = buildExecutionRiskState({
    receiptRecords,
    executionEvents: events,
    inventory,
  });
  const riskDecision = buildExecutionRiskDecision({
    job,
    riskState,
    riskPolicy: buildDefaultRiskPolicy(),
    mode: args.mode,
  });
  if (riskDecision.decision !== "ALLOW") {
    const event = buildExecutionBlockedEvent({
      job,
      mode: args.mode,
      blockers: [...new Set([...riskDecision.blockers, ...riskDecision.reviews])],
      fundingSource,
      riskDecision,
    });
    const store = new JsonlStore(config.dataDir);
    await store.append("execution-journal", event);
    if (args.json) {
      console.log(safeJsonStringify(event, 2));
      return;
    }
    printBlockedEvent(event, job);
    return;
  }

  const preparation = await buildTreasuryRefillExecutionPlan({
    job,
    senderAddress: resolved.address,
    bitcoinSenderAddress: signerHealth?.addresses?.bitcoin || null,
  });

  const store = new JsonlStore(config.dataDir);
  if (preparation.status !== "ready") {
    const event = buildExecutionBlockedEvent({
      job,
      mode: args.execute ? args.mode : "live_quote_snapshot",
      blockers: [preparation.blockedReason || "refill_executor_plan_blocked"],
      fundingSource,
      riskDecision,
    });
    await store.append("execution-journal", event);
    if (args.json) {
      console.log(safeJsonStringify({ event, preparation }, 2));
      return;
    }
    printBlockedEvent(event, job);
    if (preparation.executor) console.log(`executor=${preparation.executor}`);
    if (preparation.plan?.planStatus) console.log(`executorPlanStatus=${preparation.plan.planStatus}`);
    if (preparation.plan?.blockedReason) console.log(`executorBlockedReason=${preparation.plan.blockedReason}`);
    return;
  }

  const snapshotEvent = buildExecutionFundingSnapshotEvent({
    plan: preparation.plan,
    job,
    actor: args.execute ? "treasury_refill_execute" : "treasury_refill_preview",
    mode: args.execute ? args.mode : "live_quote_snapshot",
    fundingSource,
  });
  await store.append("execution-journal", snapshotEvent);

  let execution = null;
  let executionError = null;
  let outcomeEvent = null;
  if (args.execute) {
    try {
      execution = await executeTreasuryRefillExecutionPlan({
        preparation,
        socketPath: args.socketPath,
        timeoutMs: args.timeoutMs,
        awaitConfirmation: args.awaitConfirmation,
        awaitDestinationSettlement: args.awaitDestinationSettlement,
        confirmations: args.confirmations,
        confirmationTimeoutMs: args.confirmationTimeoutMs,
        destinationSettlementTimeoutMs: args.destinationSettlementTimeoutMs || undefined,
        destinationPollIntervalMs: args.destinationPollIntervalMs,
      });
    } catch (error) {
      execution = error.partialExecution || null;
      executionError = {
        name: error.name || "ExecutionFailed",
        message: error.message,
      };
      if (execution && !execution.error) {
        execution.error = executionError;
      }
    }
    if (execution) {
      await store.append("treasury-refill-executions", execution);
      outcomeEvent = buildExecutionFundingOutcomeEvent({
        plan: preparation.plan,
        execution,
        job,
        actor: "treasury_refill_execute",
        mode: args.mode,
      });
      await store.append("execution-journal", outcomeEvent);
    }
  }

  if (args.json) {
    console.log(safeJsonStringify({ preparation, snapshotEvent, execution, outcomeEvent, error: executionError }, 2));
    if (executionError) process.exitCode = 1;
    return;
  }

  console.log(`status=${args.execute ? outcomeEvent?.status || "execution_failed" : snapshotEvent.status}`);
  console.log(`jobId=${job.jobId}`);
  console.log(`mode=${args.execute ? args.mode : "live_quote_snapshot"}`);
  console.log(`executionMethod=${job.executionMethod}`);
  console.log(`executor=${preparation.executor}`);
  console.log(`executorPlanStatus=${preparation.plan.planStatus}`);
  console.log(`coversTarget=${preparation.coverage?.coversTarget ?? "n/a"}`);
  if (preparation.plan.blockedReason) console.log(`executorBlockedReason=${preparation.plan.blockedReason}`);
  if (execution?.settlementStatus) console.log(`settlementStatus=${execution.settlementStatus}`);
  if (outcomeEvent?.txHashes?.length) console.log(`txHashes=${outcomeEvent.txHashes.join(",")}`);
  if (executionError) {
    console.log(`executionError=${executionError.name}:${executionError.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
