#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { diagnoseSignerHealth } from "../executor/signer/health-check.mjs";
import { createCliMetricsSession, parseMetricsArgs } from "../metrics/cli-run.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

export function parseArgs(argv) {
  const flags = new Set(argv);
  const metrics = parseMetricsArgs(argv, { resolvePath: resolve });
  return {
    json: flags.has("--json"),
    metricsOut: metrics.metricsOut,
    metricsFormat: metrics.metricsFormat,
  };
}

function renderText(report) {
  const failedRpc = (report.rpc.chains || []).filter((item) => !item.ok).map((item) => item.chain);
  return [
    `cause=${report.cause}`,
    `readiness.readyForBroadcast=${report.readiness?.readyForBroadcast}`,
    `readiness.telemetryComplete=${report.readiness?.telemetryComplete}`,
    `readiness.limitations=${report.readiness?.limitations?.length ? report.readiness.limitations.join(",") : "none"}`,
    `process.daemonRunning=${report.process.daemonRunning}`,
    `process.watchdogRunning=${report.process.watchdogRunning}`,
    `heartbeat.status=${report.heartbeat.status}`,
    `heartbeat.ageMs=${report.heartbeat.ageMs ?? "n/a"}`,
    `socket.ok=${report.socket.ok}`,
    `btcRpc.ok=${report.btcRpc.ok}`,
    `evmRpc.failed=${failedRpc.length ? failedRpc.join(",") : "none"}`,
    `nonceManagers.ok=${report.nonceManagers.ok}`,
    `signerAudit.lastStage=${report.signerAudit.lastStage || "n/a"}`,
    `signerAudit.lastTimestamp=${report.signerAudit.lastTimestamp || "n/a"}`,
  ].join("\n");
}

function buildSignerHealthMetrics(report) {
  const failedRpcCount = (report.rpc?.chains || []).filter((item) => item?.ok === false).length;
  const gauges = [
    {
      name: "bobclaw_signer_health_ready_for_broadcast",
      value: report.readiness?.readyForBroadcast === true ? 1 : 0,
    },
    {
      name: "bobclaw_signer_health_failed_rpc_count",
      value: failedRpcCount,
    },
  ];
  if (Number.isFinite(report.heartbeat?.ageMs)) {
    gauges.push({
      name: "bobclaw_signer_health_heartbeat_age_ms",
      value: report.heartbeat.ageMs,
    });
  }
  return gauges;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const metrics = createCliMetricsSession({
    command: "diagnose_signer_health",
    metricsOut: args.metricsOut,
    metricsFormat: args.metricsFormat,
    now: deps.now || (() => new Date()),
    nowMs: deps.nowMs || (() => Date.now()),
    writeTextImpl: deps.writeTextImpl,
  });

  try {
    const report = await (deps.diagnoseSignerHealthImpl || diagnoseSignerHealth)();
    const output = args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderText(report)}\n`;
    stdout.write(output);
    await metrics.finalize({
      result: report.readiness?.readyForBroadcast === true ? "ok" : "blocked",
      gauges: buildSignerHealthMetrics(report),
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
