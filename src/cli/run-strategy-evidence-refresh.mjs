#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { devLockStatus } from "../runtime/dev-lock.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DASHBOARD_PATH = resolve(ROOT, "dashboard/public/dashboard-status.json");
const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function parseBooleanFlag(flags, name) {
  return flags.has(name);
}

function parseNumberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseArgs(argv) {
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
    json: parseBooleanFlag(flags, "--json"),
    loop: parseBooleanFlag(flags, "--loop"),
    continueOnFailure: parseBooleanFlag(flags, "--continue-on-failure"),
    intervalMs: parseNumberOption(options.intervalMs, 1_800_000),
    promotionLookbackDays: parseNumberOption(options["promotion-lookback-days"], null),
    preliveRefreshLimit: parseNumberOption(options["prelive-refresh-limit"], 1),
    preliveSimulationLimit: parseNumberOption(options["prelive-simulation-limit"], 4),
    dispatchMode: options["dispatch-mode"] || "auto",
    dispatchScope: options["dispatch-scope"] || null,
    dispatchBucket: options["dispatch-bucket"] || null,
    dispatchCommandTimeoutMs: parseNumberOption(options["dispatch-command-timeout-ms"], null),
    skipGateSelfHeal: parseBooleanFlag(flags, "--skip-gate-self-heal"),
    skipVariance: parseBooleanFlag(flags, "--skip-variance"),
    skipLaneReclassification: parseBooleanFlag(flags, "--skip-lane-reclassification"),
    skipDestinationPromotionGate: parseBooleanFlag(flags, "--skip-destination-promotion-gate"),
    skipStrategyDispatch: parseBooleanFlag(flags, "--skip-strategy-dispatch"),
    skipPreliveEvidence: parseBooleanFlag(flags, "--skip-prelive-evidence"),
    skipPromotionPreview: parseBooleanFlag(flags, "--skip-promotion-preview"),
    skipStrategyTick: parseBooleanFlag(flags, "--skip-strategy-tick"),
    skipDashboard: parseBooleanFlag(flags, "--skip-dashboard"),
  };
}

function buildNodeStep({
  name,
  script,
  args = [],
  timeoutMs = 600_000,
  devAutomation = false,
}) {
  return { name, script, args, timeoutMs, devAutomation };
}

export function buildStrategyEvidenceRefreshPlan({
  args,
  dataDir = config.dataDir,
  orchestrationSource = "strategy_evidence_refresh",
  orchestratorRunId = "strategy-evidence-refresh",
} = {}) {
  const plan = [];
  if (!args.skipGateSelfHeal) {
    plan.push(buildNodeStep({
      name: "gate_self_heal",
      script: "src/cli/run-gate-self-heal.mjs",
      args: ["--skip-dashboard"],
      timeoutMs: 600_000,
      devAutomation: true,
    }));
  }
  if (!args.skipVariance) {
    plan.push(buildNodeStep({
      name: "gas_slippage_variance",
      script: "src/cli/report-gas-slippage-variance.mjs",
      args: ["--write"],
      devAutomation: true,
    }));
  }
  if (!args.skipLaneReclassification) {
    plan.push(buildNodeStep({
      name: "lane_reclassification",
      script: "src/cli/report-lane-reclassification.mjs",
      args: ["--write"],
      devAutomation: true,
    }));
  }
  if (!args.skipDestinationPromotionGate) {
    plan.push(buildNodeStep({
      name: "destination_promotion_gate",
      script: "src/cli/report-destination-promotion-gate.mjs",
      args: ["--write"],
      devAutomation: true,
    }));
  }
  if (!args.skipStrategyDispatch) {
    const dispatchArgs = [
      "--execute",
      "--write",
      "--continue-on-failure",
      `--mode=${args.dispatchMode}`,
      `--orchestrator-source=${orchestrationSource}`,
      `--orchestrator-run-id=${orchestratorRunId}`,
    ];
    if (args.dispatchScope) dispatchArgs.push(`--scope=${args.dispatchScope}`);
    if (args.dispatchBucket) dispatchArgs.push(`--bucket=${args.dispatchBucket}`);
    if (args.dispatchCommandTimeoutMs) {
      dispatchArgs.push(`--command-timeout-ms=${args.dispatchCommandTimeoutMs}`);
    }
    plan.push(buildNodeStep({
      name: "strategy_dispatch",
      script: "src/cli/run-strategy-catalog-dispatcher.mjs",
      args: dispatchArgs,
      timeoutMs: 1_200_000,
      devAutomation: true,
    }));
  }
  if (!args.skipPreliveEvidence) {
    plan.push(buildNodeStep({
      name: "prelive_evidence_campaign",
      script: "src/cli/run-prelive-evidence-campaign.mjs",
      args: [
        "--execute",
        "--write",
        "--continue-on-failure",
        `--refresh-limit=${args.preliveRefreshLimit}`,
        `--simulation-limit=${args.preliveSimulationLimit}`,
      ],
      timeoutMs: 1_200_000,
      devAutomation: true,
    }));
  }
  if (!args.skipPromotionPreview) {
    const promotionArgs = [
      `--write=${join(dataDir, "promotion-latest.json")}`,
      "--quiet",
    ];
    if (args.promotionLookbackDays) {
      promotionArgs.push(`--lookback-days=${args.promotionLookbackDays}`);
    }
    plan.push(buildNodeStep({
      name: "promotion_preview",
      script: "src/cli/promotion-pr-preview.mjs",
      args: promotionArgs,
      devAutomation: true,
    }));
  }
  if (!args.skipStrategyTick) {
    plan.push(buildNodeStep({
      name: "strategy_tick_slice",
      script: "src/cli/report-strategy-tick-slice.mjs",
      args: ["--quiet"],
      devAutomation: false,
    }));
  }
  if (!args.skipDashboard) {
    plan.push(buildNodeStep({
      name: "status_dashboard",
      script: "src/cli/status-dashboard.mjs",
      args: ["--skip-shadow-cycle"],
      timeoutMs: 600_000,
      devAutomation: false,
    }));
  }
  return plan;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readDashboardOverview() {
  const status = await readJsonIfExists(DASHBOARD_PATH);
  return {
    severity: status?.overall?.severity || null,
    liveTrading: status?.overall?.liveTrading || null,
    blockers: status?.overall?.blockers || [],
    warnings: status?.overall?.warnings || [],
  };
}

async function readArtifactSummary(dataDir = config.dataDir) {
  const [promotion, strategyDispatch, preliveEvidence] = await Promise.all([
    readJsonIfExists(join(dataDir, "promotion-latest.json")),
    readJsonIfExists(join(dataDir, "strategy-dispatch-summary.json")),
    readJsonIfExists(join(dataDir, "prelive-evidence-campaign-summary.json")),
  ]);
  return {
    promotion: promotion
      ? {
          generatedAt: promotion.generatedAt || null,
          eligibleCount: promotion.summary?.eligibleCount ?? null,
          blockedCount: promotion.summary?.blockedCount ?? null,
        }
      : null,
    strategyDispatch: strategyDispatch
      ? {
          latestStatus: strategyDispatch.latestStatus || null,
          latestMode: strategyDispatch.latestMode || null,
          runCount: strategyDispatch.runCount ?? null,
        }
      : null,
    preliveEvidence: preliveEvidence
      ? {
          latestStatus: preliveEvidence.latestStatus || null,
          runCount: preliveEvidence.runCount ?? null,
          nextActionCode: preliveEvidence.nextAction?.code || null,
        }
      : null,
  };
}

function runNodeStep(step, env = process.env) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [resolve(ROOT, step.script), ...step.args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: step.timeoutMs,
  });
  return {
    name: step.name,
    script: step.script,
    args: step.args,
    devAutomation: step.devAutomation,
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal || null,
    durationMs: Date.now() - started,
    stdoutTail: (result.stdout || "").trim().split("\n").filter(Boolean).slice(-3).join(" | "),
    stderrTail: (result.stderr || "").trim().split("\n").filter(Boolean).slice(-3).join(" | "),
  };
}

async function persistReport(report, dataDir = config.dataDir) {
  const latestPath = join(dataDir, "strategy-evidence-refresh-latest.json");
  await writeTextIfChanged(latestPath, `${JSON.stringify(report, null, 2)}\n`);
  await new JsonlStore(dataDir).append("strategy-evidence-refresh-runs", report);
}

export async function runStrategyEvidenceRefreshOnce(args, { dataDir = config.dataDir } = {}) {
  const before = await readDashboardOverview();
  const lock = devLockStatus();
  const observedAt = new Date().toISOString();
  const orchestratorRunId = `strategy-evidence-refresh:${observedAt}`;
  const plan = buildStrategyEvidenceRefreshPlan({
    args,
    dataDir,
    orchestrationSource: "strategy_evidence_refresh",
    orchestratorRunId,
  });
  const steps = [];
  for (const step of plan) {
    if (lock.locked && step.devAutomation) {
      steps.push({
        name: step.name,
        script: step.script,
        args: step.args,
        devAutomation: step.devAutomation,
        skipped: true,
        skipReason: "dev_lock_active",
        ok: true,
        exitCode: null,
        signal: null,
        durationMs: 0,
        stdoutTail: "",
        stderrTail: "",
      });
      continue;
    }
    const result = runNodeStep(step);
    steps.push({ ...result, skipped: false, skipReason: null });
    if (!result.ok && !args.continueOnFailure) break;
  }

  const after = await readDashboardOverview();
  const artifacts = await readArtifactSummary(dataDir);
  const attemptedSteps = steps.filter((step) => step.skipped !== true);
  const report = {
    schemaVersion: 1,
    observedAt,
    devLock: lock,
    before,
    after,
    artifacts,
    attemptedStepCount: attemptedSteps.length,
    skippedStepCount: steps.filter((step) => step.skipped === true).length,
    steps,
    ok: attemptedSteps.every((step) => step.ok),
  };
  await persistReport(report, dataDir);
  return report;
}

function printSummary(report) {
  console.log(`observedAt=${report.observedAt}`);
  console.log(`devLock=${report.devLock.locked ? "locked" : "unlocked"}`);
  for (const step of report.steps) {
    const status = step.skipped ? `skipped:${step.skipReason}` : `ok:${step.ok}`;
    console.log(
      `  step=${step.name} status=${status} exit=${step.exitCode ?? "n/a"} ms=${step.durationMs}` +
        (step.ok || step.skipped ? "" : ` stderr="${step.stderrTail}"`),
    );
  }
  console.log(`liveTrading_before=${report.before.liveTrading} liveTrading_after=${report.after.liveTrading}`);
  console.log(`blockers_after=${report.after.blockers.join(",") || "none"}`);
  if (report.artifacts.promotion) {
    console.log(
      `promotion eligible=${report.artifacts.promotion.eligibleCount ?? "n/a"} blocked=${report.artifacts.promotion.blockedCount ?? "n/a"}`,
    );
  }
  if (report.artifacts.strategyDispatch) {
    console.log(
      `strategyDispatch latest=${report.artifacts.strategyDispatch.latestStatus ?? "n/a"} runs=${report.artifacts.strategyDispatch.runCount ?? "n/a"}`,
    );
  }
  if (report.artifacts.preliveEvidence) {
    console.log(
      `prelive latest=${report.artifacts.preliveEvidence.latestStatus ?? "n/a"} nextAction=${report.artifacts.preliveEvidence.nextActionCode ?? "n/a"}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.loop) {
    const report = await runStrategyEvidenceRefreshOnce(args);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printSummary(report);
    process.exit(report.ok ? 0 : 1);
  }

  while (true) {
    const report = await runStrategyEvidenceRefreshOnce(args);
    if (args.json) console.log(JSON.stringify(report));
    else printSummary(report);
    console.log(`sleeping ${args.intervalMs}ms`);
    await delay(args.intervalMs);
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
