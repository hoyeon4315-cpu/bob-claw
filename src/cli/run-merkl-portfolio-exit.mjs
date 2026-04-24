#!/usr/bin/env node

import { resolve } from "node:path";
import { runMerklPortfolioExit } from "../executor/merkl-portfolio-exit.mjs";
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
  const policy = {};
  if (entries["exit-lookahead-hours"]) policy.exitLookaheadHours = Number(entries["exit-lookahead-hours"]);
  if (entries["min-score-for-entry"]) policy.minScoreForEntry = Number(entries["min-score-for-entry"]);
  return {
    execute: flags.has("--execute"),
    force: flags.has("--force"),
    json: flags.has("--json"),
    write: flags.has("--write"),
    policy,
    socketPath: resolve(entries["socket-path"] || signerSocketPath()),
    timeoutMs: entries["timeout-ms"] ? Number(entries["timeout-ms"]) : signerClientTimeoutMs(),
  };
}

function printSummary(report) {
  console.log(`mode=${report.mode}`);
  console.log(`status=${report.status}`);
  console.log(`activePositionCount=${report.summary?.activePositionCount ?? 0}`);
  console.log(`exitReadyCount=${report.summary?.exitReadyCount ?? 0}`);
  for (const item of report.evaluations || []) {
    console.log(`${item.positionId} status=${item.status} triggers=${item.triggers.join(",") || "none"} blockers=${item.blockers.join(",") || "none"}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runMerklPortfolioExit({
    execute: args.execute,
    write: args.write,
    force: args.force,
    policy: args.policy,
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  });
  if (args.json) console.log(safeJsonStringify(report, 2));
  else printSummary(report);
  if (report.status === "blocked") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
