#!/usr/bin/env node

import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { BLOCKER_RESOLUTION_CONFIG, buildBlockerResolutionConfig } from "../config/blocker-resolution.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  normalizeBlocker,
  paramsHash as blockerParamsHash,
  isFilterBlockerCode,
  isHardSafetyStop,
} from "../executor/policy/blocker-codes.mjs";
import { planProofAcquisition } from "../executor/blocker-resolution/proof-acquisition.mjs";
// Side-effect import ensures all blocker recipes (including newly registered capital/reader ones) are registered before any resolution run
import "../executor/blocker-resolution/recipes.mjs";
import {
  readCircuitState,
  writeCircuitState,
  circuitAllowsDependency,
} from "../executor/blocker-resolution/circuit-breaker.mjs";
import {
  readPendingDispatches,
  writePendingDispatches,
  reconcilePendingDispatches,
} from "../executor/blocker-resolution/dispatch-tracker.mjs";
import { buildBlockerFunnelSlice } from "../status/blocker-funnel-slice.mjs";
import { readLiveBroadcastGlobalGuards } from "./live-broadcast-guards.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function optionValue(argv, name) {
  const prefix = `${name}=`;
  const raw = argv.find((item) => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function parseArgs(argv = []) {
  const execute = hasFlag(argv, "--execute");
  const dryRunIdle = hasFlag(argv, "--dry-run-idle");
  return {
    preview: hasFlag(argv, "--preview") || (!execute && !dryRunIdle),
    execute,
    dryRunIdle,
    enableExpensive: hasFlag(argv, "--enable-expensive"),
    maxAttempts: Number(optionValue(argv, "--max-attempts")) || null,
    maxWallSeconds: Number(optionValue(argv, "--max-wall-seconds")) || null,
    maxRpc: Number(optionValue(argv, "--max-rpc")) || null,
    intervalMs: Number(optionValue(argv, "--interval-ms")) || 5 * 60 * 1000,
    json: hasFlag(argv, "--json"),
    loop: hasFlag(argv, "--loop"),
  };
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

function sha16(value) {
  return blockerParamsHash({ value });
}

function paramsKeyFor(code, params) {
  return sha16(`${code}:${blockerParamsHash(params || {})}`);
}

async function acquireLock(lockPath, { now = new Date().toISOString(), staleMs = 30 * 60 * 1000 } = {}) {
  const existing = await readJsonIfExists(lockPath);
  if (existing?.createdAt) {
    const ageMs = Date.now() - new Date(existing.createdAt).getTime();
    if (Number.isFinite(ageMs) && ageMs < staleMs) {
      return { ok: false, reason: "lock_active", existing };
    }
  }
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, createdAt: now }, null, 2)}\n`, { flag: "w" });
  return { ok: true };
}

async function releaseLock(lockPath) {
  await rm(lockPath, { force: true }).catch(() => {});
}

function firstBlocker(row = {}) {
  if (Array.isArray(row.lastTickBlockers) && row.lastTickBlockers.length) return row.lastTickBlockers[0];
  if (row.topDenyReason) return row.topDenyReason;
  if (row.topBlocker) return row.topBlocker;
  if (row.layerStatus?.runtimeBlocker) return row.layerStatus.runtimeBlocker;
  return null;
}

function buildGroupsFromStrategyTick(strategyTickStatus = null) {
  const groups = new Map();
  for (const row of strategyTickStatus?.strategies || []) {
    const raw = firstBlocker(row);
    if (!raw) continue;
    const normalized = normalizeBlocker(raw, { strategyId: row.strategyId, chain: row.chain || null });
    if (isFilterBlockerCode(normalized.code)) continue;
    const paramsKey = paramsKeyFor(normalized.code, normalized.params);
    const group = groups.get(paramsKey) || {
      strategyId: row.strategyId,
      code: normalized.code,
      params: normalized.params,
      paramsKey,
      observedAt: row.lastTickAt || strategyTickStatus.generatedAt || new Date().toISOString(),
      affectedStrategies: [],
      legacyTexts: [],
    };
    group.affectedStrategies.push(row.strategyId);
    group.legacyTexts.push(normalized.legacyText);
    groups.set(paramsKey, group);
  }
  return [...groups.values()];
}

function buildFilteredCandidatesFromStrategyTick(strategyTickStatus = null) {
  const rows = [];
  for (const row of strategyTickStatus?.strategies || []) {
    const raw = firstBlocker(row);
    if (!raw) continue;
    const normalized = normalizeBlocker(raw, { strategyId: row.strategyId, chain: row.chain || null });
    if (!isFilterBlockerCode(normalized.code)) continue;
    rows.push({
      strategyId: row.strategyId,
      code: normalized.code,
      legacyCode: normalized.legacyText,
      params: normalized.params,
      observedAt: row.lastTickAt || strategyTickStatus.generatedAt || new Date().toISOString(),
    });
  }
  return rows;
}

function sortGroupsByRoi(groups = [], plans = new Map()) {
  return [...groups].sort((left, right) => {
    const l = plans.get(left.paramsKey)?.expectedDailyUsdOnResolve;
    const r = plans.get(right.paramsKey)?.expectedDailyUsdOnResolve;
    if (Number.isFinite(l) || Number.isFinite(r))
      return (r ?? Number.NEGATIVE_INFINITY) - (l ?? Number.NEGATIVE_INFINITY);
    return left.code.localeCompare(right.code);
  });
}

function edgeFloorClassificationFor(group = {}, plan = {}, capitalRoutingByStrategy = new Map()) {
  if (group.code !== "economic_no_go:edge_below_variance_floor") return null;
  const strategyId = group.params?.strategyId || group.strategyId || group.affectedStrategies?.[0] || null;
  return (
    plan.actions?.[0]?.classification ||
    plan.actions?.[0]?.params?.classification ||
    capitalRoutingByStrategy.get(strategyId)?.classification ||
    null
  );
}

function previewResolverActionable(group = {}, plan = {}, capitalRoutingByStrategy = new Map()) {
  const category = group.code.split(":")[0];
  const classification = edgeFloorClassificationFor(group, plan, capitalRoutingByStrategy);
  if (group.code === "economic_no_go:edge_below_variance_floor" && classification === "ready_with_capital_addition")
    return true;
  if (
    group.code === "economic_no_go:edge_below_variance_floor" &&
    ["thin_evidence", "missing_input", "missing_yield_evidence", "ready_with_yield_shadow_evidence"].includes(
      classification,
    )
  )
    return true;
  return ["proof_acquisition", "refill_or_inventory"].includes(category) && !isHardSafetyStop(group.code);
}

function previewRequiresStrategyOrCapitalChange(group = {}, plan = {}, capitalRoutingByStrategy = new Map()) {
  const classification = edgeFloorClassificationFor(group, plan, capitalRoutingByStrategy);
  if (group.code === "economic_no_go:edge_below_variance_floor" && classification) {
    return ["needs_capital_acquisition", "floor_infeasible_at_committed_caps", "negative_or_zero_edge"].includes(
      classification,
    );
  }
  const category = group.code.split(":")[0];
  return (
    ["economic_no_go", "executor_unbound", "code_required"].includes(category) || plan.requiresExternalDeposit === true
  );
}

function applyAttemptUpdate(current, update) {
  if (update === "reset") return 0;
  if (update === "increment") return (Number(current) || 0) + 1;
  return Number(current) || 0;
}

function statePatchForPlan(group, plan, previous = {}) {
  return {
    ...previous,
    code: group.code,
    params: group.params,
    affectedStrategies: group.affectedStrategies,
    attemptCount: applyAttemptUpdate(previous.attemptCount, plan.attemptCountUpdate),
    lastResolverAction: plan.actions?.[0]?.type || null,
    lastResolverOutcome: plan.status,
    nextRetryAt: plan.nextRetryAt || null,
    expectedDailyUsdOnResolve: plan.expectedDailyUsdOnResolve,
    requiresExternalDeposit: plan.requiresExternalDeposit,
    updatedAt: new Date().toISOString(),
  };
}

function summaryFromPlans(funnel, plans) {
  return {
    resolverActionableCount: funnel.resolverActionableCount,
    requiresStrategyOrCapitalChangeCount: funnel.requiresStrategyOrCapitalChangeCount,
    pendingDispatchCount: funnel.pendingDispatchCount,
    planCount: plans.length,
    proofRefreshedCount: plans.filter((item) => item.status === "proof_refreshed").length,
    pendingReceiptCount: plans.filter((item) => item.status === "pending_receipt").length,
    hardSafetyStopCount: plans.filter((item) => item.status === "hard_safety_stop").length,
  };
}

function applyPlansToStateAndBuildPreview({
  orderedGroups,
  plansByKey,
  resolverState,
  reconciled,
  cfg,
  capitalRoutingByStrategy,
}) {
  let proofCount = 0;
  let operationalCount = 0;
  const nextState = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    byParamsKey: { ...(resolverState.byParamsKey || {}) },
    confirmedDispatches: [...(resolverState.confirmedDispatches || []), ...reconciled.confirmed],
  };
  const nextPending = [...reconciled.pending];
  const previewPlans = [];

  for (const group of orderedGroups) {
    const plan = plansByKey.get(group.paramsKey);
    if (!plan) continue;
    const firstAction = plan.actions?.[0] || null;
    if (firstAction?.type === "refresh_command") proofCount += 1;
    if (firstAction?.type === "operational_intent") operationalCount += 1;

    const budgetSkipped =
      proofCount > cfg.maxProofAcquisitionsPerRun || operationalCount > cfg.maxOperationalIntentsPerRun;

    const effectivePlan = budgetSkipped
      ? {
          ...plan,
          status: "skipped_budget",
          attemptCountUpdate: "unchanged",
          unresolvedReason: "resource_budget_exhausted",
        }
      : plan;

    nextState.byParamsKey[group.paramsKey] = statePatchForPlan(
      group,
      effectivePlan,
      nextState.byParamsKey[group.paramsKey],
    );

    if (effectivePlan.status === "pending_receipt") {
      for (const action of effectivePlan.actions || []) {
        if (action.dispatch) nextPending.push(action.dispatch);
      }
    }

    previewPlans.push({
      paramsKey: group.paramsKey,
      code: group.code,
      params: group.params,
      affectedStrategies: group.affectedStrategies,
      status: effectivePlan.status,
      actions: effectivePlan.actions || [],
      expectedDailyUsdOnResolve: effectivePlan.expectedDailyUsdOnResolve,
      requiresExternalDeposit: effectivePlan.requiresExternalDeposit,
      resolverActionable: previewResolverActionable(group, effectivePlan, capitalRoutingByStrategy),
      requiresStrategyOrCapitalChange: previewRequiresStrategyOrCapitalChange(
        group,
        effectivePlan,
        capitalRoutingByStrategy,
      ),
    });
  }

  return { nextState, nextPending, previewPlans };
}

async function buildBlockerPlans({
  groups,
  resolverState,
  guards,
  capitalRoutingByStrategy,
  mode,
  executeAction,
  circuitState,
  cfg,
  now,
}) {
  const plansByKey = new Map();
  const previewPlans = [];
  for (const group of groups) {
    const previous = resolverState.byParamsKey?.[group.paramsKey] || {};
    const context = {
      readyForLiveBroadcast: guards.readyForLiveBroadcast,
      operatorHold: group.params?.operatorHold === true,
      pausedByAutoKill: group.params?.pausedByAutoKill === true,
      capitalRoutingByStrategy,
    };
    const plan = await planProofAcquisition({
      strategyId: group.strategyId,
      code: group.code,
      params: group.params,
      paramsKey: group.paramsKey,
      observedAt: group.observedAt,
      context,
      attemptCount: previous.attemptCount || 0,
      mode,
      executeAction,
      circuitState,
      circuitAllows: (state, dep) =>
        circuitAllowsDependency(state, dep, {
          config: {
            failureThreshold: cfg.circuitBreakerFailureThreshold,
            halfOpenAfterMs: cfg.circuitBreakerHalfOpenAfterMs,
          },
          now,
        }),
    });
    plansByKey.set(group.paramsKey, plan);
  }
  return { plansByKey, previewPlans };
}

function buildResolverPathsAndConfig(cwd, dataDir, dashboardDir, args) {
  const resolvedDataDir = resolve(cwd, dataDir);
  const resolvedDashboardDir = resolve(cwd, dashboardDir);
  const cfg = buildBlockerResolutionConfig({
    maxResolverWallSeconds: args.maxWallSeconds || undefined,
    maxRpcCallsPerRun: args.maxRpc || undefined,
    maxAutoAttemptsProofAcquisition: args.maxAttempts || undefined,
  });
  const paths = {
    strategyTick: join(resolvedDashboardDir, "strategy-tick-status.json"),
    blockerFunnel: join(resolvedDashboardDir, "blocker-funnel.json"),
    state: join(resolvedDataDir, "blocker-resolver-state.json"),
    circuit: join(resolvedDataDir, "blocker-resolver-circuit-state.json"),
    pending: join(resolvedDataDir, "blocker-resolver-pending-dispatch.json"),
    capitalRoutingPlan: join(resolvedDashboardDir, "capital-routing-plan.json"),
    preview: join(resolvedDataDir, "blocker-resolution-preview.json"),
    runs: join(resolvedDataDir, "blocker-resolution-runs.jsonl"),
    audit: join(cwd, "logs", "blocker-resolver-audit.jsonl"),
    lock: join(resolvedDataDir, "blocker-resolver.lock"),
  };
  return { resolvedDataDir, resolvedDashboardDir, paths, cfg };
}

function handleExecuteGuardBlock(args, guards, now) {
  if (args.execute && guards.ok === false) {
    const payload = {
      schemaVersion: 1,
      observedAt: now,
      status: "execute_blocked_by_guard",
      blockers: guards.blockers || [],
      readyForLiveBroadcast: guards.readyForLiveBroadcast === true,
    };
    return {
      exitCode: 2,
      stdout: `${JSON.stringify(payload, null, 2)}\n`,
      stderr: "",
      payload,
    };
  }
  return null;
}

async function handleLockAcquisition(lockPath, now) {
  const lock = await acquireLock(lockPath, { now });
  if (!lock.ok) {
    const payload = { status: "lock_active", observedAt: now, lock: lock.existing || null };
    return { exitCode: 2, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "", payload };
  }
  return null;
}

async function loadBlockerResolverInputs(paths, cwd, resolvedDataDir, strategyTickStatus, now) {
  const [resolverStateRaw, circuitState, pendingDispatches, signerAuditRecords, receiptRecords, capitalRoutingPlan] =
    await Promise.all([
      readJsonIfExists(paths.state),
      readCircuitState(paths.circuit),
      readPendingDispatches(paths.pending),
      readJsonl(join(cwd, "logs"), "signer-audit").catch(() => []),
      readJsonl(resolvedDataDir, "receipt-reconciliations").catch(() => []),
      readJsonIfExists(paths.capitalRoutingPlan),
    ]);

  const resolverState = resolverStateRaw || { schemaVersion: 1, byParamsKey: {} };
  const reconciled = reconcilePendingDispatches(pendingDispatches, {
    signerAuditRecords,
    receiptRecords,
    observedAt: now,
  });
  const groups = buildGroupsFromStrategyTick(strategyTickStatus);
  const filteredCandidates = buildFilteredCandidatesFromStrategyTick(strategyTickStatus);
  const capitalRoutingByStrategy = new Map([
    ...(capitalRoutingPlan?.routingPlan || []).map((row) => [row.strategyId, row]),
    ...(capitalRoutingPlan?.unresolvable || []).map((row) => [row.strategyId, row]),
    ...(capitalRoutingPlan?.classifications || []).map((row) => [row.strategyId, row]),
  ]);

  return {
    resolverState,
    reconciled,
    groups,
    filteredCandidates,
    capitalRoutingPlan,
    capitalRoutingByStrategy,
    circuitState,
  };
}

export async function runBlockerResolverCli(
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    dataDir = config.dataDir,
    dashboardDir = join(cwd, "dashboard", "public"),
    readGlobalGuards = readLiveBroadcastGlobalGuards,
    executeAction = async (action) => ({
      ok: true,
      actionType: action.type,
      enqueued: action.type === "operational_intent",
    }),
    now = new Date().toISOString(),
  } = {},
) {
  const args = parseArgs(argv);
  const { resolvedDataDir, resolvedDashboardDir, paths, cfg } = buildResolverPathsAndConfig(
    cwd,
    dataDir,
    dashboardDir,
    args,
  );
  const strategyTickStatus = (await readJsonIfExists(paths.strategyTick)) || { strategies: [] };
  const mode = args.execute ? "execute" : args.dryRunIdle ? "dry-run-idle" : "preview";
  const guards = await readGlobalGuards({ execute: args.execute, strategyTickStatus });
  const guardBlock = handleExecuteGuardBlock(args, guards, now);
  if (guardBlock) return guardBlock;

  const lockBlock = await handleLockAcquisition(paths.lock, now);
  if (lockBlock) return lockBlock;

  try {
    const inputs = await loadBlockerResolverInputs(paths, cwd, resolvedDataDir, strategyTickStatus, now);
    const {
      resolverState,
      reconciled,
      groups,
      filteredCandidates,
      capitalRoutingPlan,
      capitalRoutingByStrategy,
      circuitState,
    } = inputs;

    const { plansByKey, previewPlans: initialPreviewPlans } = await buildBlockerPlans({
      groups,
      resolverState,
      guards,
      capitalRoutingByStrategy,
      mode,
      executeAction,
      circuitState,
      cfg,
      now,
    });
    const orderedGroups = sortGroupsByRoi(groups, plansByKey);
    const { nextState, nextPending, previewPlans } = applyPlansToStateAndBuildPreview({
      orderedGroups,
      plansByKey,
      resolverState,
      reconciled,
      cfg,
      capitalRoutingByStrategy,
    });

    const funnel = buildBlockerFunnelSlice({
      strategyTickStatus,
      resolverState: nextState,
      circuitBreakerState: circuitState,
      pendingDispatches: nextPending,
      capitalRoutingPlan,
      generatedAt: now,
      config: cfg,
    });
    const payload = {
      schemaVersion: 1,
      generatedAt: now,
      mode,
      status: "completed",
      groups: previewPlans,
      summary: summaryFromPlans(funnel, previewPlans),
      filteredCandidates: {
        count: filteredCandidates.length,
        rows: filteredCandidates,
      },
      resolverActionable: previewPlans.filter((item) => item.resolverActionable),
      requiresStrategyOrCapitalChange: previewPlans.filter((item) => item.requiresStrategyOrCapitalChange),
      circuitBreakerState: circuitState,
      pendingDispatchCount: nextPending.length,
    };

    if (args.preview || args.dryRunIdle) {
      await writeTextIfChanged(paths.preview, `${JSON.stringify(payload, null, 2)}\n`);
    }
    await writeTextIfChanged(paths.state, `${JSON.stringify(nextState, null, 2)}\n`);
    await writePendingDispatches(paths.pending, nextPending);
    await writeCircuitState(paths.circuit, circuitState);
    await writeTextIfChanged(paths.blockerFunnel, `${JSON.stringify(funnel, null, 2)}\n`);
    await appendJsonl(paths.runs, {
      schemaVersion: 1,
      observedAt: now,
      mode,
      summary: payload.summary,
    });
    for (const plan of previewPlans) {
      await appendJsonl(paths.audit, {
        schemaVersion: 1,
        observedAt: now,
        mode,
        paramsKey: plan.paramsKey,
        code: plan.code,
        affectedStrategies: plan.affectedStrategies,
        outcome: plan.status,
        actionType: plan.actions?.[0]?.type || null,
      });
    }
    const stdout = args.json
      ? `${JSON.stringify(payload, null, 2)}\n`
      : [
          `status=${payload.status}`,
          `mode=${mode}`,
          `groups=${payload.groups.length}`,
          `resolverActionable=${payload.summary.resolverActionableCount}`,
          `requiresStrategyOrCapitalChange=${payload.summary.requiresStrategyOrCapitalChangeCount}`,
          `pendingDispatch=${payload.pendingDispatchCount}`,
        ].join("\n") + "\n";
    return { exitCode: 0, stdout, stderr: "", payload };
  } finally {
    await releaseLock(paths.lock);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.loop) {
    const runArgv = process.argv.slice(2).filter((item) => item !== "--loop" && !item.startsWith("--interval-ms="));
    while (true) {
      const result = await runBlockerResolverCli(runArgv);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
      await delay(args.intervalMs);
    }
  }
  const result = await runBlockerResolverCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
