#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";
import { runAllChainAutopilot, OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../executor/all-chain-autopilot.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(2, index), item.slice(index + 1)];
      }),
  );
  return {
    execute: flags.has("--execute"),
    json: flags.has("--json"),
    write: flags.has("--write"),
    loop: flags.has("--loop"),
    intervalMs: entries["interval-ms"] ? Number(entries["interval-ms"]) : 300_000,
    chains: entries.chains ? parseCsv(entries.chains) : OFFICIAL_GATEWAY_DESTINATION_CHAINS,
    maxRefillJobs: entries["max-refill-jobs"] ? Number(entries["max-refill-jobs"]) : 4,
    canaryLimit: entries["canary-limit"] ? Number(entries["canary-limit"]) : 11,
    timeoutMs: entries["timeout-ms"] ? Number(entries["timeout-ms"]) : 300_000,
    dispatchTimeoutMs: entries["dispatch-timeout-ms"] ? Number(entries["dispatch-timeout-ms"]) : 600_000,
  };
}

function printSummary(report = {}) {
  console.log(`mode=${report.mode}`);
  console.log(`status=${report.status}`);
  console.log(`blockedReason=${report.blockedReason || "none"}`);
  console.log(`officialChains=${report.summary?.officialChainCount ?? 0}`);
  console.log(`refillJobs=${report.summary?.refillJobCount ?? 0} auto=${report.summary?.autoRefillJobCount ?? 0} executed=${report.summary?.refillExecutedCount ?? 0}`);
  console.log(`canarySweep=${report.summary?.canarySweep?.status || "n/a"} ready=${report.summary?.canarySweep?.previewReadyCount ?? 0} executed=${report.summary?.canarySweep?.executedCount ?? 0}`);
  console.log(`merklCanary=${report.summary?.merklCanary?.status || "n/a"} chain=${report.summary?.merklCanary?.selectedChain || "n/a"} proof=${report.summary?.merklCanary?.proofStatus || "n/a"}`);
  console.log(`portfolio=${report.summary?.portfolio?.status || "n/a"} blocked=${report.summary?.portfolio?.blockedReason || "none"}`);
  console.log(`strategyDispatch=${report.summary?.strategyDispatch?.batchStatus || "n/a"} liveEligible=${report.summary?.strategyDispatch?.liveEligibleCount ?? "n/a"}`);
  console.log(`payback=${report.summary?.payback?.status || "n/a"} reason=${report.summary?.payback?.reason || "none"} carrySats=${report.summary?.payback?.pendingCarrySats ?? "n/a"}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let report = null;
  do {
    report = await runAllChainAutopilot(args);
    if (args.json) console.log(safeJsonStringify(report, 2));
    else printSummary(report);
    if (!args.loop) break;
    await delay(Math.max(5_000, args.intervalMs));
  } while (true);

  if (report?.status === "error") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
