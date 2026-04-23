#!/usr/bin/env node

import { resolve } from "node:path";
import { runMerklCanaryAutopilot } from "../executor/merkl-canary-autopilot.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";

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
    maxUsd: entries["max-usd"] ? Number(entries["max-usd"]) : null,
    minEthereumNotionalUsd: entries["min-ethereum-notional-usd"] ? Number(entries["min-ethereum-notional-usd"]) : undefined,
    allowInefficientEthereum: flags.has("--allow-inefficient-ethereum"),
    socketPath: resolve(entries["socket-path"] || signerSocketPath()),
    timeoutMs: entries["timeout-ms"] ? Number(entries["timeout-ms"]) : signerClientTimeoutMs(),
  };
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
    txHashes: (report.execution?.stepResults || [])
      .map((step) => step.signerResult?.broadcast?.txHash)
      .filter(Boolean),
    destinationProof: report.execution?.destinationProof || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runMerklCanaryAutopilot(args);
  if (args.json) {
    console.log(safeJsonStringify(report, 2));
  } else {
    const summary = compact(report);
    console.log(`mode=${summary.mode}`);
    console.log(`status=${summary.status}`);
    console.log(`blockedReason=${summary.blockedReason || "none"}`);
    console.log(`readyCount=${summary.readyCount}`);
    console.log(`selected=${summary.selectedOpportunityId || "none"} chain=${summary.selectedChain || "n/a"} protocol=${summary.selectedProtocolId || "n/a"}`);
    console.log(`binding=${summary.selectedBindingKind || "n/a"} amount=${summary.selectedAmount || "n/a"} amountUsd=${summary.selectedAmountUsd ?? "n/a"}`);
    console.log(`txHashes=${summary.txHashes.join(",") || "none"}`);
    console.log(`destinationProof=${summary.destinationProof?.status || "none"}`);
  }
  if (report.status === "blocked") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
