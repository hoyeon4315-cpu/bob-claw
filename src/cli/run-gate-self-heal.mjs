#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DASHBOARD_PATH = resolve(ROOT, "dashboard/public/dashboard-status.json");

const BENIGN_BLOCKERS = new Set([
  "stale_gas_snapshots",
  "gateway_update_pending_review",
]);

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const i = arg.indexOf("=");
        return [arg.slice(2, i), arg.slice(i + 1)];
      }),
  );
  return {
    json: flags.has("--json"),
    loop: flags.has("--loop"),
    intervalMs: Number.isFinite(Number(entries.intervalMs)) ? Number(entries.intervalMs) : 1800000,
    skipDashboard: flags.has("--skip-dashboard"),
  };
}

function runStep(name, script, args = []) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [resolve(ROOT, script), ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 600000,
  });
  const durationMs = Date.now() - started;
  const ok = result.status === 0;
  return {
    name,
    script,
    args,
    ok,
    exitCode: result.status,
    durationMs,
    stdoutTail: (result.stdout || "").trim().split("\n").slice(-3).join(" | "),
    stderrTail: (result.stderr || "").trim().split("\n").slice(-3).join(" | "),
  };
}

function readDashboardBlockers() {
  try {
    const json = JSON.parse(readFileSync(DASHBOARD_PATH, "utf8"));
    return {
      severity: json?.overall?.severity || null,
      liveTrading: json?.overall?.liveTrading || null,
      blockers: json?.overall?.blockers || [],
      warnings: json?.overall?.warnings || [],
    };
  } catch {
    return { severity: null, liveTrading: null, blockers: [], warnings: [] };
  }
}

async function selfHealOnce({ skipDashboard = false } = {}) {
  const before = readDashboardBlockers();
  const steps = [];

  steps.push(runStep("gas_snapshot", "src/cli/gas-snapshot.mjs"));
  steps.push(runStep("score_gateway", "src/cli/score-gateway.mjs", ["--write"]));
  steps.push(
    runStep("gateway_update_autopilot_ack", "src/cli/run-gateway-update-autopilot.mjs", ["--execute", "--write"]),
  );
  if (!skipDashboard) {
    steps.push(runStep("status_dashboard", "src/cli/status-dashboard.mjs", ["--skip-shadow-cycle", "--skip-canary-input-refresh"]));
  }

  const after = readDashboardBlockers();
  const cleared = before.blockers.filter((b) => !after.blockers.includes(b));
  const remaining = after.blockers;
  const remainingMeaningful = remaining.filter((b) => !BENIGN_BLOCKERS.has(b));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    before,
    after,
    cleared,
    remaining,
    remainingMeaningful,
    steps,
    ok: steps.every((s) => s.ok),
  };
}

function printSummary(report) {
  console.log(`generatedAt=${report.generatedAt}`);
  for (const step of report.steps) {
    console.log(
      `  step=${step.name} ok=${step.ok} exit=${step.exitCode} ms=${step.durationMs}` +
        (step.ok ? "" : ` stderr="${step.stderrTail}"`),
    );
  }
  console.log(`severity_before=${report.before.severity} liveTrading_before=${report.before.liveTrading}`);
  console.log(`severity_after=${report.after.severity} liveTrading_after=${report.after.liveTrading}`);
  console.log(`blockers_before=${report.before.blockers.join(",") || "none"}`);
  console.log(`blockers_after=${report.after.blockers.join(",") || "none"}`);
  console.log(`cleared=${report.cleared.join(",") || "none"}`);
  console.log(`remaining_meaningful=${report.remainingMeaningful.join(",") || "none"}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.loop) {
    const report = await selfHealOnce({ skipDashboard: args.skipDashboard });
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printSummary(report);
    process.exit(report.ok ? 0 : 1);
  }
  while (true) {
    const report = await selfHealOnce({ skipDashboard: args.skipDashboard });
    if (args.json) console.log(JSON.stringify(report));
    else printSummary(report);
    console.log(`sleeping ${args.intervalMs}ms`);
    await delay(args.intervalMs);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
