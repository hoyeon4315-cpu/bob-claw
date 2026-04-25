#!/usr/bin/env node

import { resolve } from "node:path";
import { runDestinationRepresentativeAutopilot } from "../executor/destination-representative-autopilot.mjs";
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
    socketPath: resolve(entries["socket-path"] || signerSocketPath()),
    timeoutMs: entries["timeout-ms"] ? Number(entries["timeout-ms"]) : signerClientTimeoutMs(),
  };
}

function printSummary(report = {}) {
  console.log(`status=${report.status}`);
  console.log(`mode=${report.mode}`);
  console.log(`blockedReason=${report.blockedReason || "none"}`);
  console.log(`candidateCount=${report.summary?.candidateCount ?? 0}`);
  console.log(`readyCount=${report.summary?.readyCount ?? 0}`);
  console.log(`selected=${report.summary?.selected?.templateId || "none"}`);
  console.log(`proof=${report.summary?.proofStatus || "none"}`);
  console.log(`txHashes=${(report.summary?.txHashes || []).join(",") || "none"}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runDestinationRepresentativeAutopilot(args);
  if (args.json) console.log(safeJsonStringify(report, 2));
  else printSummary(report);
  if (report.status === "error") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
