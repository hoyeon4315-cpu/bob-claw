#!/usr/bin/env node

import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runMerklCanaryAutopilot } from "../executor/merkl-canary-autopilot.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { matchesCronExpression } from "../executor/payback/scheduler.mjs";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_CRON_EXPRESSION = "*/15 * * * *";

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
    once: flags.has("--once") || !flags.has("--loop"),
    cronExpression: entries.cron || DEFAULT_CRON_EXPRESSION,
    pollIntervalMs: entries["poll-interval-ms"] ? Number(entries["poll-interval-ms"]) : DEFAULT_POLL_INTERVAL_MS,
    maxConsecutiveFailures: entries["max-consecutive-failures"] ? Number(entries["max-consecutive-failures"]) : 3,
    maxUsd: entries["max-usd"] ? Number(entries["max-usd"]) : null,
    maxCandidates: entries["max-candidates"] ? Number(entries["max-candidates"]) : undefined,
    maxPerChain: entries["max-per-chain"] ? Number(entries["max-per-chain"]) : undefined,
    maxPerProtocol: entries["max-per-protocol"] ? Number(entries["max-per-protocol"]) : undefined,
    opportunityId: entries["opportunity-id"] || entries["candidate-id"] || null,
    minEthereumNotionalUsd: entries["min-ethereum-notional-usd"] ? Number(entries["min-ethereum-notional-usd"]) : undefined,
    allowInefficientEthereum: flags.has("--allow-inefficient-ethereum"),
    socketPath: resolve(entries["socket-path"] || signerSocketPath()),
    timeoutMs: entries["timeout-ms"] ? Number(entries["timeout-ms"]) : signerClientTimeoutMs(),
  };
}

function minuteKey(value) {
  return new Date(value).toISOString().slice(0, 16);
}

function sameMinute(left, right) {
  return Boolean(left && right && minuteKey(left) === minuteKey(right));
}

function compact(report = {}) {
  return {
    mode: report.mode || null,
    status: report.status || null,
    blockedReason: report.blockedReason || null,
    readyCount: report.summary?.readyCount ?? 0,
    selectedOpportunityId: report.summary?.selectedOpportunityId || null,
    selectedChain: report.summary?.selectedChain || null,
    selectedProtocolId: report.summary?.selectedProtocolId || null,
    selectedBindingKind: report.summary?.selectedBindingKind || null,
    selectedAmount: report.summary?.selectedAmount || null,
    selectedAmountUsd: report.summary?.selectedAmountUsd ?? null,
    selectedCount: report.summary?.selectedCount ?? 0,
    selectedChains: report.summary?.selectedChains || [],
    previewReadyCount: report.summary?.previewReadyCount ?? 0,
    deliveredCount: report.summary?.deliveredCount ?? 0,
    blockedCount: report.summary?.blockedCount ?? 0,
    txHashes: (report.execution?.stepResults || [])
      .map((step) => step.signerResult?.broadcast?.txHash)
      .filter(Boolean),
    destinationProof: report.execution?.destinationProof || null,
  };
}

function autopilotOptions(args) {
  return {
    execute: args.execute,
    write: args.write,
    maxUsd: args.maxUsd,
    maxCandidates: args.maxCandidates,
    maxPerChain: args.maxPerChain,
    maxPerProtocol: args.maxPerProtocol,
    opportunityId: args.opportunityId,
    minEthereumNotionalUsd: args.minEthereumNotionalUsd,
    allowInefficientEthereum: args.allowInefficientEthereum,
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  };
}

function printSummary(report) {
  const summary = compact(report);
  console.log(`mode=${summary.mode}`);
  console.log(`status=${summary.status}`);
  console.log(`blockedReason=${summary.blockedReason || "none"}`);
  console.log(`readyCount=${summary.readyCount}`);
  console.log(`selectedCount=${summary.selectedCount} chains=${summary.selectedChains.join(",") || "none"} previewReady=${summary.previewReadyCount} delivered=${summary.deliveredCount} blocked=${summary.blockedCount}`);
  console.log(`selected=${summary.selectedOpportunityId || "none"} chain=${summary.selectedChain || "n/a"} protocol=${summary.selectedProtocolId || "n/a"}`);
  console.log(`binding=${summary.selectedBindingKind || "n/a"} amount=${summary.selectedAmount || "n/a"} amountUsd=${summary.selectedAmountUsd ?? "n/a"}`);
  console.log(`txHashes=${summary.txHashes.join(",") || "none"}`);
  console.log(`destinationProof=${summary.destinationProof?.status || "none"}`);
}

async function runLoop(args) {
  let lastTriggeredAt = null;
  let consecutiveFailures = 0;
  while (true) {
    const now = new Date();
    const cronMatched = matchesCronExpression(args.cronExpression, now);
    let report = {
      schemaVersion: 1,
      observedAt: now.toISOString(),
      mode: args.execute ? "execute" : "preview",
      status: "idle",
      blockedReason: "cron_not_matched",
      cronExpression: args.cronExpression,
      lastTriggeredAt,
      consecutiveFailures,
    };
    if (cronMatched && !sameMinute(lastTriggeredAt, now)) {
      report = await runMerklCanaryAutopilot(autopilotOptions(args));
      report.cronExpression = args.cronExpression;
      lastTriggeredAt = report.observedAt || now.toISOString();
      if (report.status === "blocked") consecutiveFailures += 1;
      else consecutiveFailures = 0;
      report.lastTriggeredAt = lastTriggeredAt;
      report.consecutiveFailures = consecutiveFailures;
      if (consecutiveFailures >= args.maxConsecutiveFailures) {
        report.status = "halted";
        report.blockedReason = "max_consecutive_failures";
      }
    }
    if (args.json) console.log(safeJsonStringify(report, 2));
    else printSummary(report);
    if (args.once || report.status === "halted") return report;
    await delay(args.pollIntervalMs);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.loop) {
    const loopResult = await runLoop(args);
    if (loopResult.status === "halted") process.exitCode = 1;
    return;
  }
  const report = await runMerklCanaryAutopilot(autopilotOptions(args));
  if (args.json) {
    console.log(safeJsonStringify(report, 2));
  } else {
    printSummary(report);
  }
  if (report.status === "blocked") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
