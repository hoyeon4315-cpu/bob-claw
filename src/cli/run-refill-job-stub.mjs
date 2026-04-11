#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { readJsonl, latestBy } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { canStartExecution, buildExecutionAttemptEvent } from "../execution/journal.mjs";
import { readExecutionGuards } from "../execution/guards.mjs";
import { validateTreasuryPolicy, buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildDefaultRiskPolicy } from "../risk/policy.mjs";
import { buildExecutionRiskDecision, buildExecutionRiskState } from "../risk/execution-gate.mjs";

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
    jobId: options["job-id"] || null,
    mode: options.mode || "dry_run",
  };
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

  const guards = await readExecutionGuards({
    emergencyStopPath: config.emergencyStopFlagPath,
    liveModePath: config.liveModeFlagPath,
    mode: args.mode,
  });
  if (guards.blocked) {
    throw new Error(`Execution guard blocked: ${guards.reasons.join(",")}`);
  }

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
    throw new Error(`Risk gate blocked: ${[...riskDecision.blockers, ...riskDecision.reviews].join(",")}`);
  }

  const event = buildExecutionAttemptEvent({
    job,
    mode: args.mode,
    guards,
    riskDecision,
  });

  const store = new JsonlStore(config.dataDir);
  await store.append("execution-journal", event);

  if (args.json) {
    console.log(JSON.stringify(event, null, 2));
    return;
  }

  console.log(`status=${event.status}`);
  console.log(`jobId=${event.jobId}`);
  console.log(`attemptId=${event.attemptId}`);
  console.log(`mode=${event.mode}`);
  console.log(`executionMethod=${event.executionMethod}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
