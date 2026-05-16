#!/usr/bin/env node

import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { createCliMetricsSession, parseMetricsArgs } from "../metrics/cli-run.mjs";
import { collectExecutorRuntimeReadiness } from "../runtime/executor-runtime-readiness.mjs";
import { collectAutomationHealthReport } from "../system/automation-health-report.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

export function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  const metrics = parseMetricsArgs(argv, { resolvePath: resolve });
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    skipRuntimeProbe: flags.has("--skip-runtime-probe"),
    rootDir: entries["root-dir"] ? resolve(entries["root-dir"]) : process.cwd(),
    output: entries.output ? resolve(entries.output) : join(config.dataDir, "automation-health-report.json"),
    metricsOut: metrics.metricsOut,
    metricsFormat: metrics.metricsFormat,
  };
}

function renderSummary(report) {
  return [
    `status=${report.status}`,
    `runtimeReady=${report.runtimeReadiness.ready ?? "unknown"}`,
    `launchdConfigured=${report.launchd.summary.configuredCount}/${report.launchd.summary.expectedCount}`,
    `dashboardLiveTrading=${report.dashboard.liveTrading || "unknown"}`,
    `allChainStatus=${report.allChain.status || "unknown"}`,
    `allChainRefillBlocked=${report.allChain.refillBlockedCount ?? "unknown"}`,
    `queueCandidates=${report.queues.totalCandidates}`,
    `queueChains=${
      Object.entries(report.queues.byChain)
        .map(([chain, count]) => `${chain}:${count}`)
        .join(",") || "none"
    }`,
    `representativeMissingChains=${report.queues.representativeCoverage.missingRepresentativeChainCount ?? "unknown"}`,
    `routeRemediation=${report.routeRemediation.present ? report.routeRemediation.status || "unknown" : "missing"}`,
    `topBlockers=${report.topBlockers.map((item) => `${item.reason}:${item.count}`).join(",") || "none"}`,
  ].join("\n");
}

function buildAutomationHealthMetrics(report) {
  return [
    {
      name: "bobclaw_automation_health_runtime_ready",
      value: report.runtimeReadiness?.ready === true ? 1 : 0,
    },
    {
      name: "bobclaw_automation_health_queue_candidates",
      value: report.queues?.totalCandidates ?? 0,
    },
    {
      name: "bobclaw_automation_health_top_blocker_count",
      value: report.topBlockers?.[0]?.count ?? 0,
    },
    {
      name: "bobclaw_automation_health_refill_blocked_count",
      value: report.allChain?.refillBlockedCount ?? 0,
    },
    {
      name: "bobclaw_automation_health_launchd_configured_count",
      value: report.launchd?.summary?.configuredCount ?? 0,
    },
  ];
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const metrics = createCliMetricsSession({
    command: "report_automation_health",
    metricsOut: args.metricsOut,
    metricsFormat: args.metricsFormat,
    now: deps.now || (() => new Date()),
    nowMs: deps.nowMs || (() => Date.now()),
    writeTextImpl: deps.writeTextImpl,
  });
  const sourceOverrides = {};
  if (!args.skipRuntimeProbe) {
    const collectExecutorRuntimeReadinessImpl =
      deps.collectExecutorRuntimeReadinessImpl || collectExecutorRuntimeReadiness;
    sourceOverrides.runtimeReadiness = {
      path: "live:collectExecutorRuntimeReadiness",
      present: true,
      json: await collectExecutorRuntimeReadinessImpl(),
    };
  }
  try {
    const collectAutomationHealthReportImpl = deps.collectAutomationHealthReportImpl || collectAutomationHealthReport;
    const report = await collectAutomationHealthReportImpl({
      rootDir: args.rootDir,
      sourceOverrides,
    });

    if (args.write) {
      await (deps.writeReportImpl || writeTextIfChanged)(args.output, `${JSON.stringify(report, null, 2)}\n`);
    }

    const output = args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderSummary(report)}\n`;
    stdout.write(output);

    await metrics.finalize({
      result: report.status === "healthy" ? "ok" : "blocked",
      gauges: buildAutomationHealthMetrics(report),
    });
    return report;
  } catch (error) {
    await metrics.finalize({ result: "error" }).catch(() => {});
    stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    throw error;
  }
}

if (IS_MAIN) {
  main().catch((_error) => {
    process.exitCode = 1;
  });
}
