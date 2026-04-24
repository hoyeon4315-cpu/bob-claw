#!/usr/bin/env node

import { join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { PAYBACK_CONFIG } from "../config/payback.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import {
  loadLivePaybackReceiptStore,
  loadPaybackAuditLog,
} from "../executor/ingestor/execution-receipt-ingest.mjs";
import {
  runPaybackSchedulerLoop,
  runPaybackSchedulerTick,
} from "../executor/payback/scheduler.mjs";

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
    write: flags.has("--write"),
    loop: flags.has("--loop"),
    once: flags.has("--once") || !flags.has("--loop"),
    execute: flags.has("--execute"),
    pollIntervalMs: options["poll-interval-ms"] ? Number(options["poll-interval-ms"]) : undefined,
  };
}

async function loadTickInputs() {
  const [auditLogLines, receiptStore] = await Promise.all([
    loadPaybackAuditLog(),
    loadLivePaybackReceiptStore({ dataDir: config.dataDir }),
  ]);
  return { auditLogLines, receiptStore };
}

function printTickSummary(result) {
  console.log(`tickStatus=${result.status}`);
  if (result.reason) console.log(`tickReason=${result.reason}`);
  if (result.decision?.status) console.log(`decisionStatus=${result.decision.status}`);
  if (result.decision?.snapshot?.pendingCarrySats != null) {
    console.log(`pendingCarrySats=${result.decision.snapshot.pendingCarrySats}`);
  }
  if (result.compositePlan?.plannedPaybackSats != null) {
    console.log(`plannedPaybackSats=${result.compositePlan.plannedPaybackSats}`);
  }
  if (result.compositePlan?.estimatedOfframpCostSats != null) {
    console.log(`estimatedOfframpCostSats=${result.compositePlan.estimatedOfframpCostSats}`);
  }
  if (result.execution?.status) console.log(`executionStatus=${result.execution.status}`);
  if (Array.isArray(result.execution?.stepResults)) {
    for (const step of result.execution.stepResults) {
      const label = step?.label || step?.name || step?.step || "step";
      console.log(`step=${label} status=${step?.status || "n/a"}`);
    }
  }
}

export function paybackDisbursementRecordFromTickResult(result = {}) {
  return result?.execution?.disbursementRecord || null;
}

export async function persistResult(result, { dataDir = config.dataDir, logsDir = join(process.cwd(), "logs") } = {}) {
  await writeTextIfChanged(
    join(dataDir, "payback-scheduler-tick-latest.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  await new JsonlStore(dataDir).append("payback-scheduler-ticks", result);

  const disbursementRecord = paybackDisbursementRecordFromTickResult(result);
  if (disbursementRecord) {
    await new JsonlStore(logsDir).append("signer-audit", disbursementRecord);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.loop) {
    const result = await runPaybackSchedulerLoop({
      paybackConfig: PAYBACK_CONFIG,
      pollIntervalMs: args.pollIntervalMs,
      once: args.once,
      tickOptions: {
        execute: args.execute,
      },
      tickImpl: async (tickOptions) => {
        const { auditLogLines, receiptStore } = await loadTickInputs();
        const tickResult = await runPaybackSchedulerTick({
          ...tickOptions,
          auditLogLines,
          receiptStore,
        });
        if (args.write) await persistResult(tickResult);
        if (!args.json) printTickSummary(tickResult);
        return tickResult;
      },
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { auditLogLines, receiptStore } = await loadTickInputs();
  const result = await runPaybackSchedulerTick({
    auditLogLines,
    receiptStore,
    paybackConfig: PAYBACK_CONFIG,
    execute: args.execute,
  });

  if (args.write || args.execute) await persistResult(result);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printTickSummary(result);
}

const entrypointHref = process.argv[1] ? new URL(`file://${resolve(process.argv[1])}`).href : null;
if (entrypointHref && import.meta.url === entrypointHref) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
