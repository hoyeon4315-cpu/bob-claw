#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { validateTreasuryPolicy, buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildDefaultRiskPolicy } from "../risk/policy.mjs";
import { buildExecutionRiskDecision, buildExecutionRiskState } from "../risk/execution-gate.mjs";
import { readRefillJobById } from "../executor/helpers/refill-job-store.mjs";

export function parseArgs(argv) {
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
    jobId: options["job-id"] || null,
    mode: options.mode || "dry_run",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobId) throw new Error("--job-id is required");

  const [jobs, receiptRecords, executionEvents, prices] = await Promise.all([
    readRefillJobById(config.dataDir, args.jobId),
    readJsonl(config.dataDir, "receipt-reconciliations"),
    readJsonl(config.dataDir, "execution-journal"),
    getCoinGeckoPricesUsd().catch(() => emptyPricesUsd()),
  ]);
  const job = jobs;
  if (!job) throw new Error(`Job not found: ${args.jobId}`);
  const resolved = await resolveOperationalAddress({ explicitAddress: job.address || null, dataDir: config.dataDir });

  const treasuryPolicy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = await scanTreasuryInventory({
    policy: treasuryPolicy,
    address: resolved.address,
    prices,
  });

  const riskPolicy = buildDefaultRiskPolicy();
  const riskState = buildExecutionRiskState({
    receiptRecords,
    executionEvents,
    inventory,
    resumeAfterFailureAt: riskPolicy.resumeAfterFailureAt || null,
  });
  const decision = buildExecutionRiskDecision({
    job,
    riskState,
    riskPolicy,
    mode: args.mode,
  });

  if (args.json) {
    console.log(JSON.stringify({ riskState, decision }, null, 2));
    return;
  }

  console.log(`decision=${decision.decision}`);
  if (decision.blockers.length) console.log(`blockers=${decision.blockers.join(",")}`);
  if (decision.reviews.length) console.log(`reviews=${decision.reviews.join(",")}`);
  if (decision.warnings.length) console.log(`warnings=${decision.warnings.join(",")}`);
  console.log(`walletEstimatedUsd=${decision.metrics.walletEstimatedUsd ?? "n/a"}`);
  console.log(`effectiveSystemNetPnlUsd=${decision.metrics.effectiveSystemNetPnlUsd ?? "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
