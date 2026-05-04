#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runAllChainAutopilot, OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../executor/all-chain-autopilot.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseArgs(argv) {
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
    dryRunFirst: flags.has("--dry-run-first"),
    enableDexProbeExecution: flags.has("--enable-dex-probe-execution"),
    json: flags.has("--json"),
    write: flags.has("--write"),
    loop: flags.has("--loop"),
    intervalMs: entries["interval-ms"] ? Number(entries["interval-ms"]) : 300_000,
    chains: entries.chains ? parseCsv(entries.chains) : OFFICIAL_GATEWAY_DESTINATION_CHAINS,
    maxRefillJobs: entries["max-refill-jobs"] ? Number(entries["max-refill-jobs"]) : 24,
    canaryLimit: entries["canary-limit"] ? Number(entries["canary-limit"]) : 11,
    canaryMaxExecutedCandidates: entries["canary-max-executed-candidates"] ? Number(entries["canary-max-executed-candidates"]) : 1,
    canaryMaxBroadcastSteps: entries["canary-max-broadcast-steps"] ? Number(entries["canary-max-broadcast-steps"]) : 4,
    canaryMaxRecentBroadcasts: entries["canary-max-recent-broadcasts"] ? Number(entries["canary-max-recent-broadcasts"]) : 1,
    canaryRecentBroadcastWindowMs: entries["canary-recent-broadcast-window-ms"] ? Number(entries["canary-recent-broadcast-window-ms"]) : 10 * 60_000,
    timeoutMs: entries["timeout-ms"] ? Number(entries["timeout-ms"]) : 300_000,
    canaryTimeoutMs: entries["canary-timeout-ms"] ? Number(entries["canary-timeout-ms"]) : 600_000,
    dispatchTimeoutMs: entries["dispatch-timeout-ms"] ? Number(entries["dispatch-timeout-ms"]) : 1_200_000,
    bootstrapBtcSats: entries["bootstrap-btc-sats"] ? Number(entries["bootstrap-btc-sats"]) : null,
    bootstrapBtcPriceUsd: entries["bootstrap-btc-price-usd"] ? Number(entries["bootstrap-btc-price-usd"]) : null,
    bootstrapTotalCapitalUsd: entries["bootstrap-total-capital-usd"] ? Number(entries["bootstrap-total-capital-usd"]) : null,
  };
}

function printSummary(report = {}) {
  console.log(`mode=${report.mode}`);
  console.log(`status=${report.status}`);
  console.log(`blockedReason=${report.blockedReason || "none"}`);
  console.log(`officialChains=${report.summary?.officialChainCount ?? 0}`);
  console.log(`refillJobs=${report.summary?.refillJobCount ?? 0} auto=${report.summary?.autoRefillJobCount ?? 0} executed=${report.summary?.refillExecutedCount ?? 0} treasury=${report.summary?.treasuryRefillJobCount ?? 0} capitalManager=${report.summary?.capitalManagerRefillJobCount ?? 0} inbound=${report.summary?.inboundRouteJobCount ?? 0}`);
  console.log(`inboundEvents=${report.summary?.inboundInventory?.inboundEventCount ?? 0} operatingCapital=${report.summary?.inboundInventory?.operatingCapitalIngressCount ?? 0} paybackExcluded=${report.summary?.inboundInventory?.paybackExcludedCount ?? 0} routed=${report.summary?.inboundInventory?.routeReadyCount ?? 0} appendedJobs=${report.summary?.inboundInventory?.appendedJobs ?? "n/a"}`);
  console.log(`capitalManager=rebalance:${report.summary?.capitalManager?.rebalanceDecision || "n/a"} capitalPlan:${report.summary?.capitalManager?.capitalPlanDecision || "n/a"} jobs=${report.summary?.capitalManager?.refillJobCount ?? 0} auto=${report.summary?.capitalManager?.autoRefillJobCount ?? 0}`);
  console.log(`canarySweep=${report.summary?.canarySweep?.status || "n/a"} ready=${report.summary?.canarySweep?.previewReadyCount ?? 0} executed=${report.summary?.canarySweep?.executedCount ?? 0} candidates=${report.summary?.canarySweep?.executedCandidateCount ?? 0} txSteps=${report.summary?.canarySweep?.broadcastStepCount ?? 0}`);
  console.log(`merklQueue=chains:${report.summary?.merklQueue?.chainCount ?? 0} representativeMissing:${report.summary?.merklQueue?.representativeCoverage?.missingRepresentativeChainCount ?? "n/a"} topMissing:${report.summary?.merklQueue?.representativeCoverage?.topMissingChain || "n/a"}`);
  console.log(`destinationAllocator=activeReady:${report.summary?.destinationAllocator?.activeReadyCandidateCount ?? 0} chains:${(report.summary?.destinationAllocator?.tier1ActiveReadyChains || []).join(",") || "none"}`);
  console.log(`representativeExecution=readyButNotQueued:${(report.summary?.representativeExecutionCoverage?.allocatorReadyButNotQueuedChains || []).join(",") || "none"} action:${report.summary?.representativeExecutionCoverage?.topAction || "n/a"}`);
  console.log(`destinationRepresentative=${report.summary?.destinationRepresentative?.status || "n/a"} chain=${report.summary?.destinationRepresentative?.selectedChain || "n/a"} protocol=${report.summary?.destinationRepresentative?.selectedProtocolId || "n/a"} proof=${report.summary?.destinationRepresentative?.proofStatus || "n/a"}`);
  console.log(`merklCanary=${report.summary?.merklCanary?.status || "n/a"} chain=${report.summary?.merklCanary?.selectedChain || "n/a"} proof=${report.summary?.merklCanary?.proofStatus || "n/a"}`);
  console.log(`portfolio=${report.summary?.portfolio?.status || "n/a"} blocked=${report.summary?.portfolio?.blockedReason || "none"}`);
  console.log(`strategyDispatch=${report.summary?.strategyDispatch?.batchStatus || "n/a"} liveEligible=${report.summary?.strategyDispatch?.liveEligibleCount ?? "n/a"} capitalReady=${report.summary?.strategyDispatch?.capitalDispatchReadiness || "n/a"}`);
  console.log(`payback=${report.summary?.payback?.status || "n/a"} reason=${report.summary?.payback?.reason || "none"} carrySats=${report.summary?.payback?.pendingCarrySats ?? "n/a"}`);
  console.log(`executionGate=liveSteps:${report.summary?.executionGate?.liveCapableStepExecution === true ? "enabled" : "blocked"} reason=${report.summary?.executionGate?.blockedReason || "none"}`);
}

export async function runAutopilotCommand(args, { runner = runAllChainAutopilot } = {}) {
  if (!(args?.execute && args?.dryRunFirst)) {
    const report = await runner(args);
    return {
      mode: args?.execute ? "execute" : "preview",
      preview: null,
      execution: null,
      final: report,
    };
  }

  const preview = await runner({
    ...args,
    execute: false,
  });
  if (preview?.status === "error") {
    return {
      mode: "dry_run_first",
      preview,
      execution: null,
      final: preview,
    };
  }

  const execution = await runner({
    ...args,
    execute: true,
  });
  return {
    mode: "dry_run_first",
    preview,
    execution,
    final: execution,
  };
}

export async function main(argv = process.argv.slice(2), { runner = runAllChainAutopilot } = {}) {
  const args = parseArgs(argv);
  let finalReport = null;
  do {
    const outcome = await runAutopilotCommand(args, { runner });
    finalReport = outcome.final;
    if (args.json) {
      if (outcome.mode === "dry_run_first") {
        console.log(safeJsonStringify({
          schemaVersion: 1,
          mode: outcome.mode,
          preview: outcome.preview,
          execution: outcome.execution,
          final: outcome.final,
        }, 2));
      } else {
        console.log(safeJsonStringify(outcome.final, 2));
      }
    } else {
      if (outcome.mode === "dry_run_first") {
        console.log("[dry-run-first:preview]");
        printSummary(outcome.preview);
        console.log("");
        console.log("[dry-run-first:execution]");
      }
      printSummary(outcome.final);
    }
    if (!args.loop) break;
    await delay(Math.max(5_000, args.intervalMs));
  } while (true);

  if (finalReport?.status === "error") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
