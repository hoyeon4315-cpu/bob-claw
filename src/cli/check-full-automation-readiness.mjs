#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { collectExecutorRuntimeReadiness } from "../runtime/executor-runtime-readiness.mjs";
import { buildAggressiveVelocityStatus } from "./report-aggressive-velocity-status.mjs";
import { overlayAggressiveVelocityExecutionSurface } from "./report-strategy-execution-surfaces.mjs";
import {
  buildAllChainAutopilotDashboardSlice,
  refillNeedsLiveRemediation,
  resolveAllChainAutopilotReport,
} from "../status/all-chain-autopilot-slice.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { tokensForTicker, tokenAsset } from "../assets/tokens.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
const DEFAULT_CHILD_TIMEOUT_MS = 45_000;

export function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    strict: flags.has("--strict"),
    refresh: flags.has("--refresh"),
  };
}

function readinessChildTimeoutMs(env = process.env) {
  const parsed = Number(env.BOB_CLAW_READINESS_CHILD_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHILD_TIMEOUT_MS;
}

export function runJsonCli(scriptPath, args = [], { timeoutMs = readinessChildTimeoutMs() } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (result.error) {
    const timeout = result.error.code === "ETIMEDOUT";
    return {
      ok: false,
      status: result.status ?? null,
      signal: result.signal || null,
      stdout,
      stderr,
      json: null,
      error: timeout ? `timeout_after_${timeoutMs}ms` : result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status ?? 1,
      signal: result.signal || null,
      stdout,
      stderr,
      json: null,
      error: stderr.trim() || stdout.trim() || `exit ${result.status ?? 1}`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      signal: null,
      stdout,
      stderr,
      json: null,
      error: `invalid_json:${error.message}`,
    };
  }
  return {
    ok: true,
    status: 0,
    signal: null,
    stdout,
    stderr,
    json: parsed,
    error: null,
  };
}

export function runJsonCliAsync(scriptPath, args = [], { timeoutMs = readinessChildTimeoutMs() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    const timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      finish({
        ok: false,
        status: null,
        signal: "SIGTERM",
        stdout,
        stderr,
        json: null,
        error: `timeout_after_${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        status: null,
        signal: null,
        stdout,
        stderr,
        json: null,
        error: error.message,
      });
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      if (status !== 0) {
        finish({
          ok: false,
          status: status ?? 1,
          signal: signal || null,
          stdout,
          stderr,
          json: null,
          error: stderr.trim() || stdout.trim() || `exit ${status ?? 1}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        finish({
          ok: true,
          status: 0,
          signal: signal || null,
          stdout,
          stderr,
          json: parsed,
          error: null,
        });
      } catch (error) {
        finish({
          ok: false,
          status: 0,
          signal: signal || null,
          stdout,
          stderr,
          json: null,
          error: `invalid_json:${error.message}`,
        });
      }
    });
  });
}

export async function collectReadinessDependencies({ refresh = false, runJsonCliImpl = runJsonCliAsync } = {}) {
  const refreshArgs = refresh ? ["--json", "--write"] : ["--json"];
  const [inbound, capitalManager, strategyDispatch, payback] = await Promise.all([
    runJsonCliImpl("src/cli/run-inbound-inventory-watcher.mjs", refreshArgs),
    runJsonCliImpl(
      "src/cli/plan-capital-manager-refill-jobs.mjs",
      refresh ? ["--json", "--write", "--refresh-inventory"] : ["--json"],
    ),
    runJsonCliImpl(
      "src/cli/run-strategy-catalog-dispatcher.mjs",
      refresh ? ["--json", "--write", "--mode=auto"] : ["--json", "--mode=auto"],
    ),
    runJsonCliImpl("src/cli/report-payback-status.mjs", ["--json"]),
  ]);
  return { inbound, capitalManager, strategyDispatch, payback };
}

function classifyRefillIssue(reason = null) {
  const text = String(reason || "").trim();
  if (!text) return "unknown";
  if (text === "routing_exhausted") return "routing_exhausted";
  if (text === "quote_amount_too_low") return "quote_amount_below_minimum";
  if (
    /insufficient source balance|source_inventory_below_target_amount|source_inventory_reserved|source inventory|insufficient_funds|insufficient balance/iu.test(
      text,
    )
  ) {
    return "inventory_insufficient";
  }
  if (
    /insufficient_native_balance_for_lifi_gas|insufficient_native_balance_for_gas|insufficient_native_gas_balance|native gas|gas bootstrap/iu.test(
      text,
    )
  ) {
    return "native_gas";
  }
  if (/signer_execution_failed|Signer did not complete/iu.test(text)) {
    return "signer_execution_failed";
  }
  if (/no_route|bridge_pair_unsupported|route|router|routing/iu.test(text)) {
    return "route_unresolved";
  }
  return "execution_unresolved";
}

function normalizeQuoteAmountFloor(value) {
  if (!value || typeof value !== "object") return null;
  const minimum = value.minimum != null ? String(value.minimum) : null;
  const actual = value.actual != null ? String(value.actual) : null;
  if (!minimum && !actual) return null;
  return { minimum, actual };
}

function tokenFamilyForChainToken(chain, token) {
  if (!chain || !token) return null;
  const asset = tokenAsset(chain, token);
  return asset?.family || null;
}

function familyKeyForRoute(route) {
  if (!route?.srcChain || !route?.dstChain) return null;
  const srcFamily = tokenFamilyForChainToken(route.srcChain, route.srcToken);
  const dstFamily = tokenFamilyForChainToken(route.dstChain, route.dstToken);
  if (!srcFamily || !dstFamily) return null;
  return `${String(route.srcChain).toLowerCase()}|${srcFamily}->${String(route.dstChain).toLowerCase()}|${dstFamily}`;
}

function extractAmountFloorBody(body) {
  if (!body || body.code !== "QUOTE_AMOUNT_TOO_LOW") return null;
  const details = body.details;
  const minimum = details?.minimum != null ? String(details.minimum) : null;
  const actual = details?.actual != null ? String(details.actual) : null;
  if (!minimum && !actual) return null;
  return { minimum, actual };
}

function selectFreshestAmountFloor(prior, candidate) {
  if (!prior) return candidate;
  if (!candidate.observedAt) return prior;
  return candidate.observedAt > prior.observedAt ? candidate : prior;
}

// Build a (srcChain, srcFamily) → (dstChain, dstFamily) → { minimum, actual,
// observedAt } map from gateway quote failure records. Family-keyed because
// the persisted refill blocker tuple references the destination *asset* (e.g.
// wrapped_btc family) while Gateway's `dstToken` may be a registry-equivalent
// settlement token within the same family. Compatibility is therefore checked
// via the asset registry (`tokenAsset(chain, token).family`), not via any
// chain/token literal.
export function indexGatewayAmountFloorEvidence(records = []) {
  const byKey = new Map();
  const list = Array.isArray(records) ? records : [];
  for (const record of list) {
    const floor = extractAmountFloorBody(record?.error?.details?.body);
    if (!floor) continue;
    const key = familyKeyForRoute(record?.route);
    if (!key) continue;
    const observedAt = record?.observedAt ? String(record.observedAt) : "";
    const candidate = { ...floor, observedAt };
    byKey.set(key, selectFreshestAmountFloor(byKey.get(key), candidate));
  }
  return byKey;
}

const BTC_FAMILY_COMPATIBILITY = Object.freeze({
  btc: ["btc", "native_or_wrapped", "wrapped_btc"],
  native_or_wrapped: ["btc", "native_or_wrapped", "wrapped_btc"],
  wrapped_btc: ["btc", "native_or_wrapped", "wrapped_btc"],
});

function blockerFamilyCandidates(blocker = {}) {
  const sourceChain = blocker.sourceChain;
  const destChain = blocker.chain;
  if (!sourceChain || !destChain) return [];
  const srcTokens = tokensForTicker(blocker.sourceAsset || "");
  const dstTokens = tokensForTicker(blocker.targetAsset || blocker.asset || "");
  const srcFamilies = new Set();
  for (const token of srcTokens) {
    const family = tokenFamilyForChainToken(sourceChain, token);
    if (family) srcFamilies.add(family);
  }
  const dstFamilies = new Set();
  for (const token of dstTokens) {
    const family = tokenFamilyForChainToken(destChain, token);
    if (family) dstFamilies.add(family);
  }
  if (srcFamilies.size === 0 || dstFamilies.size === 0) return [];
  const candidates = [];
  const srcChainLower = String(sourceChain).toLowerCase();
  const dstChainLower = String(destChain).toLowerCase();
  for (const srcFamily of srcFamilies) {
    const compatibleSrcFamilies = BTC_FAMILY_COMPATIBILITY[srcFamily] || [srcFamily];
    for (const dstFamily of dstFamilies) {
      const compatibleDstFamilies = BTC_FAMILY_COMPATIBILITY[dstFamily] || [dstFamily];
      for (const sFamily of compatibleSrcFamilies) {
        for (const dFamily of compatibleDstFamilies) {
          candidates.push(`${srcChainLower}|${sFamily}->${dstChainLower}|${dFamily}`);
        }
      }
    }
  }
  return candidates;
}

// Reconcile a stale autopilot refill blocker against fresh Gateway quote
// failure evidence. When the persisted snapshot reports a routing/no-route
// taxonomy for a (sourceChain/sourceFamily → chain/family) tuple that the
// live Gateway observably treats as QUOTE_AMOUNT_TOO_LOW (route exists for a
// registry-equivalent settlement token in the same family, input below
// minimum), overlay the amount-floor evidence so downstream lifecycles can
// advance to a precise NO_LIVE_ROUTE verdict without waiting for the next
// autopilot rerun. No live policy/EV/cap/cooldown/kill-switch gate is
// relaxed. Family equivalence is derived from the asset registry; no
// chain/asset literal is hardcoded.
export function reconcileBlockerWithAmountFloorEvidence(blocker = {}, amountFloorByRoute = new Map()) {
  if (!amountFloorByRoute || amountFloorByRoute.size === 0) return blocker;
  const reason = String(blocker.reason || "").trim();
  const eligibleReason = reason === "routing_exhausted" || reason === "no_route";
  if (!eligibleReason) return blocker;
  if (blocker.quoteAmountFloor) return blocker;
  const candidates = blockerFamilyCandidates(blocker);
  for (const key of candidates) {
    const evidence = amountFloorByRoute.get(key);
    if (!evidence) continue;
    return {
      ...blocker,
      reason: "quote_amount_too_low",
      routeDeferralReason: "bridge_quote_amount_below_minimum",
      routeDeferralAction: "defer_until_input_amount_meets_route_minimum_or_consolidate_inventory",
      quoteAmountFloor: { minimum: evidence.minimum, actual: evidence.actual },
      reconciledFromFreshGatewayEvidence: true,
    };
  }
  return blocker;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function refillBlockerCostEvidence(item) {
  return {
    expectedNetUsd: finiteNumberOrNull(item.expectedNetUsd),
    requiredNetUsd: finiteNumberOrNull(item.requiredNetUsd ?? item.requiredNetPnlUsd),
    p90CostUsd: finiteNumberOrNull(item.p90CostUsd ?? item.receiptCostP90Usd ?? item.receiptCostFloorUsd),
    effectiveFloorUsd: finiteNumberOrNull(item.effectiveFloorUsd ?? item.effectiveCostFloorUsd),
  };
}

function normalizeStalePlannerMethod(value) {
  return value === true || value === false ? value : null;
}

function normalizeRefillBlocker(item = {}) {
  const reason = item.reason || null;
  // Additive normalization: surface the upstream source/route/cost-floor fields
  // emitted by `src/status/all-chain-autopilot-slice.mjs#refillBlockers`. The
  // downstream lifecycle (`src/strategy/remediation-lane-intent-candidate.mjs`)
  // needs the full normalized tuple (destination + source + method) plus
  // taxonomy + cost-floor evidence to distinguish stale snapshots, structural
  // route-absence (no cost-floor available), and EV-rejected (cost-floor
  // numeric) classes without re-deriving from stale signals. No new policy,
  // EV, or cost gate is introduced; this only widens the projection.
  return {
    chain: item.chain || null,
    asset: item.asset || null,
    targetAsset: item.targetAsset || item.asset || null,
    sourceChain: item.sourceChain || null,
    sourceAsset: item.sourceAsset || null,
    reason,
    category: classifyRefillIssue(reason),
    selectedMethod: item.selectedMethod || null,
    executorFamily: item.executorFamily || null,
    routeFamily: item.routeFamily || null,
    taxonomy: item.taxonomy || null,
    routeDeferralReason: item.routeDeferralReason || null,
    routeDeferralAction: item.routeDeferralAction || null,
    quoteAmountFloor: normalizeQuoteAmountFloor(item.quoteAmountFloor),
    reconciledFromFreshGatewayEvidence: item.reconciledFromFreshGatewayEvidence === true,
    ...refillBlockerCostEvidence(item),
    stalePlannerMethod: normalizeStalePlannerMethod(item.stalePlannerMethod),
  };
}

export function refillBlockerDetails(blockers = [], { amountFloorByRoute = null } = {}) {
  if (!Array.isArray(blockers)) return [];
  const source =
    amountFloorByRoute && amountFloorByRoute.size > 0
      ? blockers.map((blocker) => reconcileBlockerWithAmountFloorEvidence(blocker, amountFloorByRoute))
      : blockers;
  return source
    .map(normalizeRefillBlocker)
    .filter((item) => item.reason)
    .slice(0, 8);
}

function liveAutomationRefillCounts(autopilot = null) {
  const refill = autopilot?.refill || {};
  return {
    refillBlockedCount: refill.blockedCount ?? null,
    refillUnresolvedCount: refill.unresolvedCount ?? null,
    refillManualBacklogCount: refill.manualBacklogCount ?? null,
    refillStaleSnapshotMethodCount: refill.staleSnapshotMethodCount ?? null,
    refillCurrentMethodBlockedCount: refill.currentMethodBlockedCount ?? null,
    refillAttemptedCount: refill.attemptedCount ?? null,
    refillExecutedCount: refill.executedCount ?? null,
  };
}

function countByCategory(items = []) {
  return items.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
}

function strategyLiveAdmissionBlockers(strategyDispatch = {}) {
  const strategies = strategyDispatch?.executionSurfaces?.strategies || [];
  if (!Array.isArray(strategies)) return [];
  const hasConcreteWrappedBtcLoop = strategies.some(
    (strategy) => String(strategy?.id || "") === "wrapped-btc-loop-base-moonwell",
  );
  const modeRank = new Map([
    ["live", 0],
    ["dry_run", 1],
    ["shadow", 2],
    ["analysis", 3],
  ]);
  return strategies
    .map((strategy = {}) => ({
      strategyId: strategy.id || null,
      selectedMode: strategy.selectedMode || null,
      status: strategy.status || null,
      reason: strategy.reason || null,
      blockers: Array.isArray(strategy.liveAdmissionBlockers) ? strategy.liveAdmissionBlockers.filter(Boolean) : [],
    }))
    .filter(
      (strategy) =>
        !(
          hasConcreteWrappedBtcLoop &&
          strategy.strategyId === "gateway_wrapped_btc_loops" &&
          strategy.blockers.includes("route_specific_executor_inputs_required")
        ),
    )
    .filter((strategy) => strategy.strategyId && strategy.blockers.length > 0)
    .sort((left, right) => {
      const leftWrapped = left.strategyId === "wrapped-btc-loop-base-moonwell" ? 0 : 1;
      const rightWrapped = right.strategyId === "wrapped-btc-loop-base-moonwell" ? 0 : 1;
      if (leftWrapped !== rightWrapped) return leftWrapped - rightWrapped;
      const leftMode = modeRank.get(left.selectedMode) ?? 99;
      const rightMode = modeRank.get(right.selectedMode) ?? 99;
      if (leftMode !== rightMode) return leftMode - rightMode;
      return String(left.strategyId || "").localeCompare(String(right.strategyId || ""));
    })
    .slice(0, 8);
}

function resolveAmountFloorByRoute(input) {
  if (input instanceof Map) return input;
  if (Array.isArray(input)) return indexGatewayAmountFloorEvidence(input);
  return new Map();
}

export function buildFullAutomationReadiness({
  runtime,
  inbound,
  capitalManager,
  strategyDispatch,
  payback,
  autopilot,
  commandHealth = {},
  gatewayAmountFloorEvidence,
} = {}) {
  const amountFloorByRoute = resolveAmountFloorByRoute(gatewayAmountFloorEvidence);
  const runtimeReady = runtime?.summary?.ready === true;
  const operatingCapitalIngressCount = inbound?.summary?.operatingCapitalIngressCount ?? 0;
  const paybackExcludedCount = inbound?.summary?.paybackExcludedCount ?? 0;
  const ingressIsolationReady = operatingCapitalIngressCount === paybackExcludedCount;
  const capitalPlanDecision = capitalManager?.capitalPlan?.decision || null;
  const capitalJobs = capitalManager?.jobs?.summary?.jobCount ?? 0;
  const autoRefillJobCount = capitalManager?.jobs?.jobs?.filter((job) => !job.requiresManualReview).length ?? 0;
  const dispatchBatchStatus = strategyDispatch?.record?.batchStatus || null;
  const liveEligibleCount = strategyDispatch?.executionSurfaces?.summary?.liveEligibleCount ?? 0;
  const merklCanaryReadyCount = autopilot?.merklCanary?.readyCount ?? autopilot?.execution?.merklCanaryReadyCount ?? 0;
  const merklCanarySelectedCount =
    autopilot?.merklCanary?.selectedCount ?? autopilot?.execution?.merklCanarySelectedCount ?? 0;
  const merklCanaryBlockedReason =
    autopilot?.merklCanary?.blockedReason || autopilot?.execution?.merklCanaryBlockedReason || null;
  const merklCanaryStatus = autopilot?.merklCanary?.status || null;
  const merklCanaryLiveLaneReady =
    merklCanaryReadyCount > 0 && !["failed", "invalid", "error"].includes(String(merklCanaryStatus || ""));
  const liveAutomationObserved = autopilot?.present === true;
  const activeLiveAutomationRun = autopilot?.activeRun === true;
  const refillBlockers = refillBlockerDetails(autopilot?.refill?.blockers || [], { amountFloorByRoute });
  const refillIssueCounts = countByCategory(refillBlockers);
  const unresolvedRefillRoutes =
    liveAutomationObserved &&
    !activeLiveAutomationRun &&
    (refillBlockers.length > 0
      ? refillBlockers.some((item) => refillNeedsLiveRemediation(item))
      : (autopilot?.refill?.blockedCount ?? 0) > 0);
  const liveWatchReady =
    liveAutomationObserved &&
    !activeLiveAutomationRun &&
    !unresolvedRefillRoutes &&
    autopilot?.nextAction === "continue_live_watch" &&
    !["failed", "invalid", "error"].includes(String(autopilot?.status || ""));
  const paybackStatus = payback?.payback?.scheduler?.status || null;
  const paybackReason = payback?.payback?.scheduler?.reason || null;
  const paybackIsolationReady = ingressIsolationReady;
  const liveAdmissionBlockers = strategyLiveAdmissionBlockers(strategyDispatch);
  const dispatchReady =
    liveAdmissionBlockers.length === 0 &&
    (liveEligibleCount > 0 || merklCanaryLiveLaneReady || liveWatchReady) &&
    dispatchBatchStatus !== "failed" &&
    dispatchBatchStatus !== "invalid";
  const capitalAutomationReady =
    capitalPlanDecision === "BALANCED" ||
    capitalPlanDecision === "READY" ||
    capitalPlanDecision === "WATCH_ONLY" ||
    (capitalPlanDecision === "REFILL_REQUIRED" &&
      (autoRefillJobCount > 0 || (liveAutomationObserved && !unresolvedRefillRoutes)));
  const paybackReserveReady = paybackReason !== "reserve_asset_missing";
  const failedDependencyCommands = Object.entries(commandHealth)
    .filter(([, health]) => health?.ok === false)
    .map(([name]) => `dependency_command_failed:${name}`);

  const blockers = [
    ...failedDependencyCommands,
    ...(runtimeReady ? [] : ["runtime_not_ready"]),
    ...(ingressIsolationReady ? [] : ["operating_capital_not_isolated_from_payback"]),
    ...(capitalAutomationReady ? [] : ["capital_rebalancer_not_ready"]),
    ...(dispatchReady ? [] : ["strategy_dispatch_not_ready"]),
    ...(paybackIsolationReady ? [] : ["payback_isolation_not_ready"]),
    ...(activeLiveAutomationRun ? ["all_chain_autopilot_running"] : []),
    ...(unresolvedRefillRoutes ? ["refill_routes_unresolved"] : []),
    ...(paybackReserveReady ? [] : ["payback_reserve_missing"]),
  ];

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    status: blockers.length === 0 ? "ready" : "attention_required",
    ready: blockers.length === 0,
    blockers,
    runtime: {
      ready: runtimeReady,
      nextActionCode: runtime?.summary?.nextActionCode || null,
    },
    dependencyCommands: {
      failed: failedDependencyCommands,
      ready: failedDependencyCommands.length === 0,
    },
    ingress: {
      inboundEventCount: inbound?.summary?.inboundEventCount ?? 0,
      operatingCapitalIngressCount,
      paybackExcludedCount,
      ready: ingressIsolationReady,
    },
    capitalManager: {
      rebalanceDecision: capitalManager?.rebalancePlan?.decision || null,
      capitalPlanDecision,
      refillJobCount: capitalJobs,
      autoRefillJobCount,
      ready: capitalAutomationReady,
    },
    strategyDispatch: {
      batchStatus: dispatchBatchStatus,
      liveEligibleCount,
      merklCanaryReadyCount,
      merklCanarySelectedCount,
      merklCanaryBlockedReason,
      selectedCount: strategyDispatch?.record?.selectedCount ?? 0,
      liveAdmissionBlockers,
      ready: dispatchReady,
    },
    liveAutomation: {
      observed: liveAutomationObserved,
      activeRun: activeLiveAutomationRun,
      status: autopilot?.status || null,
      phase: autopilot?.phase || null,
      nextAction: autopilot?.nextAction || null,
      ...liveAutomationRefillCounts(autopilot),
      refillIssueCounts,
      refillBlockers,
      ready: !activeLiveAutomationRun && !unresolvedRefillRoutes,
    },
    payback: {
      status: paybackStatus,
      reason: paybackReason,
      isolationReady: paybackIsolationReady,
      ready: paybackIsolationReady && paybackReserveReady,
      nextAction: payback?.payback?.scheduler?.nextAction || null,
    },
    policyNote:
      "Operating capital ingress must stay isolated from payback; live dispatch still depends on policy/caps/kill-switch.",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [runtime, dependencyReports, aggressiveStatus] = await Promise.all([
    collectExecutorRuntimeReadiness(),
    collectReadinessDependencies({ refresh: args.refresh }),
    buildAggressiveVelocityStatus(),
  ]);
  const { inbound, capitalManager, strategyDispatch, payback } = dependencyReports;
  if (strategyDispatch.ok && strategyDispatch.json?.executionSurfaces) {
    strategyDispatch.json = {
      ...strategyDispatch.json,
      executionSurfaces: overlayAggressiveVelocityExecutionSurface(
        strategyDispatch.json.executionSurfaces,
        aggressiveStatus,
      ),
    };
  }
  const commandHealth = {
    inbound: { ok: inbound.ok, error: inbound.error },
    capitalManager: { ok: capitalManager.ok, error: capitalManager.error },
    strategyDispatch: { ok: strategyDispatch.ok, error: strategyDispatch.error },
    payback: { ok: payback.ok, error: payback.error },
  };
  const autopilotLatest = await readJsonIfExists(join(config.dataDir, "all-chain-autopilot-latest.json"));
  const autopilotLatestCompleted = await readJsonIfExists(
    join(config.dataDir, "all-chain-autopilot-latest-completed.json"),
  );
  const autopilot = buildAllChainAutopilotDashboardSlice(
    resolveAllChainAutopilotReport(autopilotLatest, autopilotLatestCompleted),
    { capitalManagerRefillJobsLatest: capitalManager.json },
  );
  const gatewayQuoteFailureRecords = await readJsonl(config.dataDir, "gateway-quote-failures").catch(() => []);

  const report = buildFullAutomationReadiness({
    runtime,
    inbound: inbound.json,
    capitalManager: capitalManager.json,
    strategyDispatch: strategyDispatch.json,
    payback: payback.json,
    autopilot,
    commandHealth,
    gatewayAmountFloorEvidence: gatewayQuoteFailureRecords,
  });
  report.commandHealth = commandHealth;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`status=${report.status}`);
    console.log(`ready=${report.ready}`);
    console.log(`runtimeReady=${report.runtime.ready}`);
    console.log(`ingressReady=${report.ingress.ready}`);
    console.log(`capitalManagerReady=${report.capitalManager.ready}`);
    console.log(`strategyDispatchReady=${report.strategyDispatch.ready}`);
    console.log(`paybackIsolationReady=${report.payback.isolationReady}`);
    console.log(`liveEligibleCount=${report.strategyDispatch.liveEligibleCount}`);
    console.log(`capitalPlanDecision=${report.capitalManager.capitalPlanDecision || "n/a"}`);
    console.log(`paybackStatus=${report.payback.status || "n/a"}`);
    console.log(`blockers=${report.blockers.join(",") || "none"}`);
  }

  if (args.strict && !report.ready) {
    process.exitCode = 1;
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
