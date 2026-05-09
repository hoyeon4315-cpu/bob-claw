#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { BLOCKER_RESOLUTION_CONFIG } from "../config/blocker-resolution.mjs";
import { resolveKillSwitchPath } from "../executor/policy/kill-switch.mjs";
import { resolveDevLockPath } from "../runtime/dev-lock.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildStrategyEdgeSnapshots } from "../strategy/economics/strategy-edge-snapshot.mjs";
import { solveMinViableNotional } from "../strategy/economics/min-viable-notional.mjs";
import { classifyFloorFeasibility } from "../strategy/economics/floor-feasibility-classifier.mjs";
import { buildCapitalRoutingPlan } from "../executor/capital/capital-routing-plan.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function optionValue(argv, name) {
  const prefix = `${name}=`;
  const raw = argv.find((item) => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

export function parseArgs(argv = []) {
  const execute = hasFlag(argv, "--execute");
  const dryRunIdle = hasFlag(argv, "--dry-run-idle");
  return {
    preview: hasFlag(argv, "--preview") || (!execute && !dryRunIdle),
    execute,
    dryRunIdle,
    json: hasFlag(argv, "--json"),
    maxIntents: Number(optionValue(argv, "--max-intents")) || BLOCKER_RESOLUTION_CONFIG.maxOperationalIntentsPerRun,
  };
}

async function fileExists(path) {
  if (!path) return false;
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function appendJsonl(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function defaultReadGlobalGuards({
  execute = false,
  strategyTickStatus = null,
  killSwitchPath = resolveKillSwitchPath(),
  devLockPath = resolveDevLockPath(),
} = {}) {
  const blockers = [];
  const killSwitchActive = await fileExists(killSwitchPath);
  const devLockActive = execute && await fileExists(devLockPath);
  if (killSwitchActive) blockers.push("kill_switch_active");
  if (devLockActive) blockers.push("dev_lock_active");
  const readyForLiveBroadcast = (strategyTickStatus?.strategies || []).some((row) => row?.layerStatus?.runtimeExecutable === true || row?.policyReadiness?.policyOk === true);
  if (execute && readyForLiveBroadcast === false) blockers.push("readiness_guard_blocked");
  return { ok: blockers.length === 0, blockers, readyForLiveBroadcast, killSwitchActive, devLockActive };
}

function blockerStrategyIds(blockerFunnel = {}) {
  const ids = new Map();
  for (const group of blockerFunnel.rootCauseGroups || []) {
    if (group.code !== "economic_no_go:edge_below_variance_floor") continue;
    const strategyId = group.params?.strategyId || group.affectedStrategies?.[0] || null;
    if (strategyId) ids.set(strategyId, group.params || {});
  }
  for (const row of blockerFunnel.strategies || []) {
    if (row.code === "economic_no_go:edge_below_variance_floor" && row.strategyId) ids.set(row.strategyId, row.params || {});
  }
  return ids;
}

function rowByStrategy(strategyTickStatus = {}) {
  return new Map((strategyTickStatus.strategies || []).map((row) => [row.strategyId, row]));
}

function readinessFromStrategyTick(strategyTickStatus = {}) {
  return Object.fromEntries((strategyTickStatus.strategies || []).map((row) => [
    row.strategyId,
    {
      operatorHold: row.operatorHold === true || row.policyReadiness?.operatorHold === true,
      pausedByAutoKill: row.pausedByAutoKill === true,
      positionActions: row.positionActions || [],
    },
  ]));
}

function treasuryFromDashboardStatus(dashboardStatus = null) {
  const items = Array.isArray(dashboardStatus?.capitalSummary?.walletItems)
    ? dashboardStatus.capitalSummary.walletItems
    : [];
  const perChainUsd = {};
  const sources = [];
  for (const item of items) {
    const usd = finiteNumber(item.usd);
    if (!(usd > 0) || !item.chain) continue;
    perChainUsd[item.chain] = (perChainUsd[item.chain] || 0) + usd;
    sources.push({
      chain: item.chain,
      asset: item.sym || item.name || null,
      freeUsd: usd,
    });
  }
  const freeCapitalUsd = sources.reduce((sum, item) => sum + item.freeUsd, 0);
  return {
    freeCapitalUsd,
    lockedCapitalUsd: 0,
    perChainUsd,
    sources,
  };
}

function enrichSnapshotsWithBlockerParams(snapshots = [], blockerIds = new Map()) {
  return snapshots
    .filter((snapshot) => blockerIds.size === 0 || blockerIds.has(snapshot.strategyId))
    .map((snapshot) => ({
      ...snapshot,
      chain: blockerIds.get(snapshot.strategyId)?.chain || snapshot.chain || null,
    }));
}

function minViableByStrategy(snapshots = [], strategiesById = new Map()) {
  return Object.fromEntries(snapshots.map((snapshot) => {
    const strategy = strategiesById.get(snapshot.strategyId);
    const caps = strategy?.caps || null;
    const chain = snapshot.chain || Object.keys(caps?.perChainUsd || {})[0] || null;
    return [snapshot.strategyId, solveMinViableNotional({
      edgeBpsPerDay: snapshot.measuredEdgeBpsPerDay,
      roundTripCostUsd: snapshot.measuredRoundTripCostUsd,
      slippageVarianceUsd: snapshot.slippageVarianceUsd,
      varianceFloorUsd: snapshot.varianceFloorUsd,
      holdingPeriodDays: snapshot.holdingPeriodDays || 1,
      caps: caps ? { ...caps, chain } : null,
    })];
  }));
}

function buildQueueJob(planItem, { now }) {
  const intent = planItem.enqueueIntent;
  return {
    schemaVersion: 1,
    jobId: `capital-routing:${intent.intentHash}`,
    createdAt: now,
    status: "planned",
    source: "capital_routing_optimizer",
    type: "capital_routing_plan",
    strategyId: planItem.strategyId,
    chain: planItem.destinationChain,
    asset: planItem.destinationAsset,
    targetAmountDecimal: null,
    estimatedAssetValueUsd: planItem.amountUsd,
    executionMethod: "capital_manager_intent",
    requiresManualReview: false,
    reviewReasons: [],
    intent,
    intentHash: intent.intentHash,
    rationale: "Variance-floor-aware minimum viable notional funding plan.",
  };
}

async function defaultEnqueueJob(job, { dataDir }) {
  const store = new JsonlStore(dataDir);
  await store.append("capital-manager-refill-jobs", job);
  return { ok: true, jobId: job.jobId };
}

async function alreadyEnqueued(dataDir, intentHash) {
  const jobs = await readJsonl(dataDir, "capital-manager-refill-jobs").catch(() => []);
  return jobs.some((job) => job.intentHash === intentHash || job.intent?.intentHash === intentHash);
}

export async function runCapitalRoutingPlanCli(
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    dataDir = config.dataDir,
    dashboardDir = join(cwd, "dashboard", "public"),
    strategies = null,
    snapshots = null,
    treasurySnapshot = null,
    readGlobalGuards = defaultReadGlobalGuards,
    enqueueJob = defaultEnqueueJob,
    now = new Date().toISOString(),
  } = {},
) {
  const args = parseArgs(argv);
  const resolvedDataDir = resolve(cwd, dataDir);
  const resolvedDashboardDir = resolve(cwd, dashboardDir);
  const [strategyTickStatus, blockerFunnel, dashboardStatus, receiptRecords, signerAuditRecords] = await Promise.all([
    readJsonIfExists(join(resolvedDashboardDir, "strategy-tick-status.json")),
    readJsonIfExists(join(resolvedDashboardDir, "blocker-funnel.json")),
    readJsonIfExists(join(resolvedDashboardDir, "dashboard-status.json")),
    readJsonl(resolvedDataDir, "receipt-reconciliations").catch(() => []),
    readJsonl(join(cwd, "logs"), "signer-audit").catch(() => []),
  ]);
  const guards = await readGlobalGuards({ execute: args.execute, strategyTickStatus });
  if (args.execute && guards.ok === false) {
    const payload = {
      schemaVersion: 1,
      generatedAt: now,
      status: "execute_blocked_by_guard",
      blockers: guards.blockers || [],
      readyForLiveBroadcast: guards.readyForLiveBroadcast === true,
    };
    return { exitCode: 2, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "", payload };
  }

  const strategyConfigs = strategies || listStrategyCaps({ includeInactive: true });
  const strategiesById = new Map(strategyConfigs.map((strategy) => [strategy.strategyId, strategy]));
  const blockers = blockerStrategyIds(blockerFunnel || {});
  const rawSnapshots = snapshots || buildStrategyEdgeSnapshots({
    strategies: strategyConfigs,
    receiptRecords,
    auditRecords: signerAuditRecords,
    strategyTickStatus,
    now,
  });
  const selectedSnapshots = enrichSnapshotsWithBlockerParams(rawSnapshots, blockers);
  const treasury = treasurySnapshot || treasuryFromDashboardStatus(dashboardStatus);
  const minima = minViableByStrategy(selectedSnapshots, strategiesById);
  const classifications = classifyFloorFeasibility({
    snapshots: selectedSnapshots,
    minViableByStrategy: minima,
    treasury,
    strategyCapsById: Object.fromEntries(strategyConfigs.map((strategy) => [strategy.strategyId, strategy])),
  }).map((row) => ({
    ...row,
    destinationChain: blockers.get(row.strategyId)?.chain || selectedSnapshots.find((snapshot) => snapshot.strategyId === row.strategyId)?.chain || null,
  }));
  const plan = buildCapitalRoutingPlan({
    classifications,
    treasurySnapshot: treasury,
    strategyCapsById: Object.fromEntries(strategyConfigs.map((strategy) => [strategy.strategyId, strategy])),
    guards,
    readinessByStrategy: readinessFromStrategyTick(strategyTickStatus || {}),
    now,
  });

  const payload = {
    ...plan,
    mode: args.execute ? "execute" : args.dryRunIdle ? "dry-run-idle" : "preview",
    classifications,
  };
  await writeTextIfChanged(join(resolvedDataDir, "capital-routing-plan-preview.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await writeTextIfChanged(join(resolvedDashboardDir, "capital-routing-plan.json"), `${JSON.stringify(payload, null, 2)}\n`);

  const enqueueResults = [];
  if (args.execute) {
    let count = 0;
    for (const planItem of plan.routingPlan) {
      if (count >= args.maxIntents) break;
      if (!planItem.enqueueIntent || planItem.preDispatchChecks?.passed !== true) continue;
      if (await alreadyEnqueued(resolvedDataDir, planItem.enqueueIntent.intentHash)) {
        enqueueResults.push({ intentHash: planItem.enqueueIntent.intentHash, status: "deduped" });
        continue;
      }
      const job = buildQueueJob(planItem, { now });
      const result = await enqueueJob(job, { dataDir: resolvedDataDir });
      enqueueResults.push({ intentHash: planItem.enqueueIntent.intentHash, status: result?.ok === true ? "enqueued" : "error", result });
      count += 1;
    }
    await appendJsonl(join(cwd, "logs", "capital-routing-audit.jsonl"), {
      schemaVersion: 1,
      observedAt: now,
      mode: payload.mode,
      enqueueResults,
    });
  }
  await appendJsonl(join(resolvedDataDir, "capital-routing-runs.jsonl"), {
    schemaVersion: 1,
    observedAt: now,
    mode: payload.mode,
    planCount: plan.routingPlan.length,
    unresolvableCount: plan.unresolvable.length,
    totalExpectedDailyUsdOnResolve: plan.totalExpectedDailyUsdOnResolve,
    enqueueResults,
  });

  const finalPayload = { ...payload, enqueueResults };
  const stdout = args.json
    ? `${JSON.stringify(finalPayload, null, 2)}\n`
    : [
        `generatedAt=${finalPayload.generatedAt}`,
        `mode=${finalPayload.mode}`,
        `planCount=${finalPayload.routingPlan.length}`,
        `unresolvableCount=${finalPayload.unresolvable.length}`,
        `totalExpectedDailyUsdOnResolve=${finalPayload.totalExpectedDailyUsdOnResolve}`,
      ].join("\n") + "\n";
  return { exitCode: 0, stdout, stderr: "", payload: finalPayload };
}

if (IS_MAIN) {
  runCapitalRoutingPlanCli().then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
