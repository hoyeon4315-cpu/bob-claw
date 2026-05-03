#!/usr/bin/env node

import { join, resolve } from "node:path";
import process from "node:process";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { collectExecutorRuntimeReadiness } from "../runtime/executor-runtime-readiness.mjs";
import { collectAutomationHealthReport } from "../system/automation-health-report.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    skipRuntimeProbe: flags.has("--skip-runtime-probe"),
    rootDir: entries["root-dir"] ? resolve(entries["root-dir"]) : process.cwd(),
    output: entries.output ? resolve(entries.output) : join(config.dataDir, "automation-health-report.json"),
  };
}

function printSummary(report) {
  console.log(`status=${report.status}`);
  console.log(`runtimeReady=${report.runtimeReadiness.ready ?? "unknown"}`);
  console.log(`launchdConfigured=${report.launchd.summary.configuredCount}/${report.launchd.summary.expectedCount}`);
  console.log(`dashboardLiveTrading=${report.dashboard.liveTrading || "unknown"}`);
  console.log(`allChainStatus=${report.allChain.status || "unknown"}`);
  console.log(`allChainRefillBlocked=${report.allChain.refillBlockedCount ?? "unknown"}`);
  console.log(`queueCandidates=${report.queues.totalCandidates}`);
  console.log(`queueChains=${Object.entries(report.queues.byChain).map(([chain, count]) => `${chain}:${count}`).join(",") || "none"}`);
  console.log(`representativeMissingChains=${report.queues.representativeCoverage.missingRepresentativeChainCount ?? "unknown"}`);
  console.log(`routeRemediation=${report.routeRemediation.present ? report.routeRemediation.status || "unknown" : "missing"}`);
  console.log(`topBlockers=${report.topBlockers.map((item) => `${item.reason}:${item.count}`).join(",") || "none"}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceOverrides = {};
  if (!args.skipRuntimeProbe) {
    sourceOverrides.runtimeReadiness = {
      path: "live:collectExecutorRuntimeReadiness",
      present: true,
      json: await collectExecutorRuntimeReadiness(),
    };
  }
  const report = await collectAutomationHealthReport({
    rootDir: args.rootDir,
    sourceOverrides,
  });

  if (args.write) {
    await writeTextIfChanged(args.output, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printSummary(report);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
