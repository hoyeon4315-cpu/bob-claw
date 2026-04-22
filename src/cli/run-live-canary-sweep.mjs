#!/usr/bin/env node

import { signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { runLiveCanarySweep } from "../executor/live-canary-sweep.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

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
    write: flags.has("--write"),
    execute: flags.has("--execute"),
    chains: options.chains ? parseCsv(options.chains) : null,
    excludeChains: options["exclude-chains"] ? parseCsv(options["exclude-chains"]) : [],
    limit: options.limit ? Number(options.limit) : 8,
    tinyUsd: options["tiny-usd"] ? Number(options["tiny-usd"]) : undefined,
    nativeTinyUsd: options["native-tiny-usd"] ? Number(options["native-tiny-usd"]) : undefined,
    minHoldingUsd: options["min-holding-usd"] ? Number(options["min-holding-usd"]) : undefined,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
  };
}

function compactResult(result) {
  return {
    id: result.candidate?.id || null,
    chain: result.candidate?.chain || null,
    kind: result.candidate?.kind || null,
    routeKey: result.candidate?.routeKey || null,
    status: result.status,
    blockedReason: result.blockedReason || null,
    amount: result.candidate?.amount || null,
    amountUsd: result.plan?.amountUsd ?? null,
    lastTxHash: result.execution?.lastTxHash || null,
    settlementStatus: result.execution?.settlementStatus || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runLiveCanarySweep(args);

  if (args.json) {
    console.log(safeJsonStringify(report, 2));
  } else {
    console.log(`mode=${report.mode}`);
    console.log(`status=${report.status}`);
    console.log(`blockedReason=${report.blockedReason || "none"}`);
    console.log(`candidateCount=${report.summary.candidateCount}`);
    console.log(`previewReady=${report.summary.previewReadyCount}`);
    console.log(`executed=${report.summary.executedCount}`);
    console.log(`delivered=${report.summary.deliveredCount}`);
    console.log(`blocked=${report.summary.blockedCount}`);
    for (const result of report.results.map(compactResult).slice(0, 20)) {
      console.log(
        `${result.status} ${result.chain || "n/a"} ${result.kind || "n/a"} ${result.routeKey || "n/a"} blocked=${result.blockedReason || "none"} tx=${result.lastTxHash || "n/a"}`,
      );
    }
  }

  if (report.status === "blocked" || report.status === "stopped") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
