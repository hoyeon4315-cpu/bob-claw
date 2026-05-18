#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { collectExecutorRuntimeReadiness } from "../runtime/executor-runtime-readiness.mjs";
import { collectAutomationHealthReport } from "../system/automation-health-report.mjs";
import { buildAggressiveVelocityStatus } from "./report-aggressive-velocity-status.mjs";

const IS_MAIN = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
const DEFAULT_CHILD_TIMEOUT_MS = 45_000;
const FULL_AUTOMATION_TIMEOUT_MS = 75_000;

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
    skipCapitalManagerProbe: flags.has("--skip-capital-manager-probe"),
    rootDir: entries["root-dir"] ? resolve(entries["root-dir"]) : process.cwd(),
    output: entries.output ? resolve(entries.output) : join(config.dataDir, "automation-health-report.json"),
  };
}

function runJsonCli(scriptPath, args = [], { timeoutMs = DEFAULT_CHILD_TIMEOUT_MS } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (result.error || result.status !== 0) return null;
  try {
    return JSON.parse(String(result.stdout || ""));
  } catch {
    return null;
  }
}

export function attachAggressiveVelocityStatus(report, aggressiveStatus) {
  if (!report || !aggressiveStatus?.strategyId) return report;
  return {
    ...report,
    strategyDiagnostics: {
      ...(report.strategyDiagnostics || {}),
      aggressiveVelocity: {
        strategyId: aggressiveStatus.strategyId,
        status: aggressiveStatus.status,
        reason: aggressiveStatus.reason,
        currentLiveEligible: aggressiveStatus.currentLiveEligible === true,
        liveAdmissionBlockers: aggressiveStatus.liveAdmissionBlockers || [],
        selectedCount: aggressiveStatus.selectedCount ?? 0,
        totalQualified: aggressiveStatus.totalQualified ?? 0,
        selectionDiagnostics: aggressiveStatus.selectionDiagnostics || null,
        rejectionEvidence: aggressiveStatus.rejectionEvidence || null,
      },
    },
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
  console.log(
    `queueChains=${
      Object.entries(report.queues.byChain)
        .map(([chain, count]) => `${chain}:${count}`)
        .join(",") || "none"
    }`,
  );
  console.log(
    `representativeMissingChains=${report.queues.representativeCoverage.missingRepresentativeChainCount ?? "unknown"}`,
  );
  console.log(
    `routeRemediation=${report.routeRemediation.present ? report.routeRemediation.status || "unknown" : "missing"}`,
  );
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
  if (!args.skipCapitalManagerProbe) {
    const capitalManagerJson = runJsonCli("src/cli/plan-capital-manager-refill-jobs.mjs", ["--json"]);
    if (capitalManagerJson) {
      sourceOverrides.capitalManagerRefillJobsLatest = {
        path: "live:plan-capital-manager-refill-jobs",
        present: true,
        json: capitalManagerJson,
      };
    }
  }
  const fullAutomationJson = runJsonCli("src/cli/check-full-automation-readiness.mjs", ["--json"], {
    timeoutMs: FULL_AUTOMATION_TIMEOUT_MS,
  });
  if (fullAutomationJson) {
    sourceOverrides.fullAutomationReadiness = {
      path: "live:check-full-automation-readiness",
      present: true,
      json: fullAutomationJson,
    };
  }
  const report = await collectAutomationHealthReport({
    rootDir: args.rootDir,
    sourceOverrides,
  });
  const aggressiveStatus = await buildAggressiveVelocityStatus();
  const enrichedReport = attachAggressiveVelocityStatus(report, aggressiveStatus);

  if (args.write) {
    await writeTextIfChanged(args.output, `${JSON.stringify(enrichedReport, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(enrichedReport, null, 2));
    return;
  }

  printSummary(enrichedReport);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
