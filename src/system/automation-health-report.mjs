import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildAllChainAutopilotDashboardSlice,
  resolveAllChainAutopilotReport,
} from "../status/all-chain-autopilot-slice.mjs";
import {
  buildDashboardLaunchAgentSpecs,
  buildExecutorLaunchAgentSpecs,
  buildLiveAutomationLaunchAgentSpecs,
  buildResearchLaunchAgentSpecs,
  buildStrategyAutomationLaunchAgentSpecs,
} from "../runtime/launchd.mjs";

export const AUTOMATION_HEALTH_FORBIDDEN_ACTIONS = Object.freeze([
  "kill_switch_toggle",
  "daemon_start",
  "daemon_restart",
  "signer_call",
  "trade_execution",
]);

const DEFAULT_SOURCE_PATHS = Object.freeze({
  runtimeReadiness: "data/executor-runtime-readiness.json",
  fullAutomationReadiness: "data/full-automation-readiness.json",
  dashboardStatus: "dashboard/public/dashboard-status.json",
  liveRuntime: ["data/dashboard-live-runtime.json", "dashboard/public/live-runtime.json"],
  strategyTickStatus: "dashboard/public/strategy-tick-status.json",
  allChainAutopilotLatest: "data/all-chain-autopilot-latest.json",
  allChainAutopilotLatestCompleted: "data/all-chain-autopilot-latest-completed.json",
  merklCanaryQueue: "data/merkl-canary-queue.json",
  deterministicCandidates: "data/deterministic-strategy-candidates.json",
  campaignAwareOpportunities: "data/campaign-aware-opportunities.json",
  merklActive: "dashboard/public/merkl-active.json",
  destinationRepresentativeAutopilot: "data/destination-representative-autopilot-latest.json",
  routeRemediation: "data/route-remediation-autopilot.json",
});

function sourcePresent(source = null) {
  return source?.present === true && source.json && typeof source.json === "object";
}

function sourceJson(source = null) {
  return sourcePresent(source) ? source.json : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeChain(chain = null) {
  const normalized = String(chain || "").trim().toLowerCase();
  return normalized || "unknown";
}

function sortedRecord(record = {}) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function countBy(items = [], selector = (item) => item) {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortedRecord(counts);
}

function addBlocker(blockers, source, reason, extra = {}) {
  if (!reason) return;
  blockers.push({
    source,
    reason: String(reason),
    ...extra,
  });
}

function topBlockers(blockers = [], limit = 10) {
  const byReason = new Map();
  blockers.forEach((blocker, index) => {
    const reason = blocker.reason || "unknown";
    const entry = byReason.get(reason) || {
      reason,
      count: 0,
      sources: new Set(),
      examples: [],
      firstSeen: index,
    };
    entry.count += 1;
    if (blocker.source) entry.sources.add(blocker.source);
    if (entry.examples.length < 3) {
      entry.examples.push(Object.fromEntries(
        Object.entries(blocker).filter(([key]) => !["source", "reason"].includes(key)),
      ));
    }
    byReason.set(reason, entry);
  });
  return [...byReason.values()]
    .sort((a, b) => (b.count - a.count) || (a.firstSeen - b.firstSeen) || a.reason.localeCompare(b.reason))
    .slice(0, limit)
    .map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      sources: [...entry.sources].sort(),
      examples: entry.examples.filter((example) => Object.keys(example).length > 0),
    }));
}

function observedMs(report = null) {
  const ms = new Date(report?.observedAt || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function freshestAllChainReport(latest = null, completed = null) {
  if (latest && observedMs(latest) >= observedMs(completed)) return latest;
  return resolveAllChainAutopilotReport(latest, completed);
}

function summarizeRuntimeReadiness({ runtimeSource = null, fullAutomationSource = null, blockers = [] } = {}) {
  const runtime = sourceJson(runtimeSource);
  const fullAutomation = sourceJson(fullAutomationSource);
  if (!runtime && !fullAutomation) {
    addBlocker(blockers, "runtime_readiness", "runtime_readiness_snapshot_missing");
    return {
      present: false,
      sourcePath: runtimeSource?.path || null,
      ready: null,
      envReady: null,
      launchdConfigured: null,
      launchdLoaded: null,
      runtimeHealthy: null,
      nextActionCode: null,
      blockers: ["runtime_readiness_snapshot_missing"],
    };
  }

  const summary = runtime?.summary || {};
  const fullRuntime = fullAutomation?.runtime || {};
  const ready = summary.ready ?? fullRuntime.ready ?? null;
  const runtimeBlockers = [
    ...array(summary.missingEnv),
    ...array(summary.insecureFiles),
    ...array(fullAutomation?.blockers),
  ];
  if (ready === false && summary.nextActionCode) runtimeBlockers.push(summary.nextActionCode);
  for (const reason of runtimeBlockers) addBlocker(blockers, "runtime_readiness", reason);

  return {
    present: true,
    sourcePath: runtimeSource?.present ? runtimeSource.path : fullAutomationSource?.path || null,
    ready,
    envReady: summary.envReady ?? null,
    launchdConfigured: summary.launchdConfigured ?? null,
    launchdLoaded: summary.launchdLoaded ?? null,
    runtimeHealthy: summary.runtimeHealthy ?? fullRuntime.ready ?? null,
    nextActionCode: summary.nextActionCode ?? fullRuntime.nextActionCode ?? null,
    blockers: runtimeBlockers,
  };
}

function summarizeLaunchd({ launchdComponents = [], blockers = [] } = {}) {
  const components = launchdComponents.map((component) => {
    const plistPresent = component.plistPresent === true;
    if (!plistPresent) {
      addBlocker(blockers, "launchd", "launchd_plist_missing", {
        id: component.id,
        label: component.label,
      });
    }
    return {
      id: component.id,
      kind: component.kind || "unknown",
      label: component.label || null,
      plistPath: component.plistPath || null,
      plistPresent,
      running: null,
      status: plistPresent ? "configured_status_unknown" : "missing_plist",
    };
  });
  return {
    summary: {
      expectedCount: components.length,
      configuredCount: components.filter((item) => item.plistPresent).length,
      missingCount: components.filter((item) => !item.plistPresent).length,
      runningKnownCount: 0,
      healthMode: "plist_presence_only",
    },
    components,
  };
}

function summarizeDashboard({ dashboardSource = null, liveRuntimeSource = null, strategyTickSource = null, blockers = [] } = {}) {
  const dashboard = sourceJson(dashboardSource);
  const liveRuntime = sourceJson(liveRuntimeSource);
  const strategyTick = sourceJson(strategyTickSource);
  if (!dashboard) {
    addBlocker(blockers, "dashboard", "dashboard_status_missing");
  }
  for (const reason of array(dashboard?.overall?.blockers)) addBlocker(blockers, "dashboard", reason);
  for (const strategy of array(strategyTick?.strategies)) {
    for (const reason of array(strategy?.liveEligibility?.blockers)) {
      addBlocker(blockers, "strategy_tick", reason, { strategyId: strategy.strategyId || null });
    }
    for (const reason of array(strategy?.promotion?.strict?.blockers)) {
      addBlocker(blockers, "strategy_tick", reason, { strategyId: strategy.strategyId || null });
    }
    for (const reason of array(strategy?.lastTickBlockers)) {
      addBlocker(blockers, "strategy_tick", reason, { strategyId: strategy.strategyId || null });
    }
  }
  return {
    present: Boolean(dashboard),
    generatedAt: dashboard?.generatedAt || null,
    severity: dashboard?.overall?.severity || null,
    liveTrading: dashboard?.overall?.liveTrading || null,
    blockerCount: array(dashboard?.overall?.blockers).length,
    blockers: array(dashboard?.overall?.blockers),
    gatewayRouteCount: dashboard?.gateway?.routeCount ?? null,
    gatewayChainCount: dashboard?.gateway?.chainCount ?? null,
    missingAnnouncedChains: array(dashboard?.gateway?.announcedChainCoverage?.missingAnnouncedChains),
    liveRuntime: {
      present: Boolean(liveRuntime),
      sourcePath: liveRuntimeSource?.present ? liveRuntimeSource.path : null,
      enabled: liveRuntime?.enabled ?? null,
      origin: liveRuntime?.origin || null,
      updatedAt: liveRuntime?.updatedAt || null,
    },
    strategyTicks: {
      present: Boolean(strategyTick),
      generatedAt: strategyTick?.generatedAt || null,
      latestTickAt: strategyTick?.latestTickAt || null,
      strategyCount: array(strategyTick?.strategies).length,
      liveEligibleCount: array(strategyTick?.strategies).filter((item) => item?.liveEligibility?.liveEligible === true).length,
      blockedStrategyCount: array(strategyTick?.strategies).filter((item) => array(item?.liveEligibility?.blockers).length > 0).length,
    },
  };
}

function summarizeAllChain({ latestSource = null, completedSource = null, blockers = [] } = {}) {
  const latest = sourceJson(latestSource);
  const completed = sourceJson(completedSource);
  const selected = freshestAllChainReport(latest, completed);
  const slice = buildAllChainAutopilotDashboardSlice(selected);
  if (slice.present === false) {
    addBlocker(blockers, "all_chain_autopilot", "all_chain_autopilot_snapshot_missing");
  }
  const seenAllChainBlockers = new Set();
  const addAllChainBlocker = (source, blocker) => {
    const reason = blocker?.reason;
    if (!reason) return;
    const key = `${source}:${reason}:${blocker.chain || ""}:${blocker.asset || ""}`;
    if (seenAllChainBlockers.has(key)) return;
    seenAllChainBlockers.add(key);
    addBlocker(blockers, source, reason, {
      chain: blocker.chain || null,
      asset: blocker.asset || null,
    });
  };
  for (const blocker of array(slice.topBlockers)) {
    addAllChainBlocker(`all_chain_${blocker.source || "autopilot"}`, blocker);
  }
  for (const blocker of array(slice.refill?.blockers)) {
    addAllChainBlocker("all_chain_refill", blocker);
  }
  return {
    present: slice.present,
    observedAt: slice.observedAt,
    mode: slice.mode,
    status: slice.status,
    nextAction: slice.nextAction,
    blockedReason: slice.blockedReason,
    officialChainCount: slice.officialChainCount,
    refillJobCount: slice.refill.jobCount,
    refillAttemptedCount: slice.refill.attemptedCount,
    refillExecutedCount: slice.refill.executedCount,
    refillBlockedCount: slice.refill.blockedCount,
    refillUnresolvedCount: slice.refill.unresolvedCount ?? null,
    strategyDispatch: slice.strategyDispatch,
    payback: slice.payback,
    topBlockers: slice.topBlockers,
  };
}

function candidateItemsFromSources(sources = {}) {
  return [
    ...array(sourceJson(sources.merklCanaryQueue)?.queue).map((item) => ({
      source: "merkl_canary_queue",
      id: item.opportunityId || item.id || item.strategyId || null,
      chain: item.chain,
      protocol: item.protocolId || item.protocol,
      blockers: array(item.blockers),
    })),
    ...array(sourceJson(sources.deterministicCandidates)?.candidates).map((item) => ({
      source: "deterministic_candidates",
      id: item.id || item.strategyId || null,
      chain: item.chain,
      protocol: item.protocol || item.protocolId,
      blockers: [...array(item.blockers), ...array(item.missingEvidence)],
    })),
    ...array(sourceJson(sources.campaignAwareOpportunities)?.candidates).map((item) => ({
      source: "campaign_aware_opportunities",
      id: item.opportunityId || item.id || null,
      chain: item.chain,
      protocol: item.protocol,
      blockers: array(item.blockers),
    })),
  ];
}

function representativeCoverageFromSources(sources = {}) {
  const merklCoverage = sourceJson(sources.merklCanaryQueue)?.summary?.representativeCoverage;
  if (merklCoverage) return { present: true, source: "merkl_canary_queue", ...merklCoverage };
  const representative = sourceJson(sources.destinationRepresentativeAutopilot);
  const representativeCoverage = representative?.summary?.representativeCoverage || representative?.representativeCoverage || null;
  if (representativeCoverage) {
    return { present: true, source: "destination_representative_autopilot", ...representativeCoverage };
  }
  return {
    present: false,
    source: null,
    activeRepresentativeChainCount: null,
    queuedRepresentativeChainCount: null,
    missingRepresentativeChainCount: null,
    missingChains: [],
  };
}

function summarizeQueues({ sources = {}, blockers = [] } = {}) {
  const items = candidateItemsFromSources(sources);
  if (items.length === 0) addBlocker(blockers, "candidate_queues", "candidate_queue_snapshot_missing");
  for (const item of items) {
    for (const reason of array(item.blockers)) {
      addBlocker(blockers, item.source, reason, {
        id: item.id,
        chain: normalizeChain(item.chain),
        protocol: item.protocol || null,
      });
    }
  }
  const bySource = countBy(items, (item) => item.source);
  const activeItems = array(sourceJson(sources.merklActive)?.items);
  return {
    totalCandidates: items.length,
    bySource,
    byChain: countBy(items, (item) => normalizeChain(item.chain)),
    unknownChainCount: items.filter((item) => normalizeChain(item.chain) === "unknown").length,
    activeMerkl: {
      present: sourcePresent(sources.merklActive),
      activeCount: sourceJson(sources.merklActive)?.activeCount ?? activeItems.length,
      byChain: countBy(activeItems, (item) => normalizeChain(item.chain)),
    },
    representativeCoverage: representativeCoverageFromSources(sources),
  };
}

function summarizeRouteRemediation({ routeSource = null, blockers = [] } = {}) {
  const route = sourceJson(routeSource);
  if (!route) {
    return {
      present: false,
      status: null,
      candidateCount: 0,
      workOrderCount: 0,
      blockedCandidateCount: 0,
      blockerCounts: {},
      topWorkOrders: [],
    };
  }
  const blockedCandidates = array(route.blockedCandidates);
  for (const candidate of blockedCandidates) {
    for (const reason of array(candidate.blockers)) {
      addBlocker(blockers, "route_remediation", reason, {
        id: candidate.id || null,
        chain: normalizeChain(candidate.chain),
      });
    }
  }
  const blockerCounts = countBy(
    blockedCandidates.flatMap((candidate) => array(candidate.blockers)),
    (item) => item,
  );
  return {
    present: true,
    generatedAt: route.generatedAt || null,
    status: route.status || null,
    candidateCount: route.candidateCount ?? array(route.candidates).length,
    workOrderCount: route.workOrderCount ?? array(route.workOrders).length,
    blockedCandidateCount: route.blockedCandidateCount ?? blockedCandidates.length,
    blockerCounts,
    topWorkOrders: array(route.workOrders).slice(0, 5).map((item) => ({
      candidateId: item.candidateId || item.id || null,
      action: item.action || null,
      chain: item.chain || null,
      estimatedNetAfterBuildUsd: item.estimatedNetAfterBuildUsd ?? null,
    })),
  };
}

function sourceInputSummary(sources = {}) {
  return Object.fromEntries(Object.entries(sources).map(([key, value]) => [
    key,
    {
      path: value?.path || null,
      present: value?.present === true,
      error: value?.error || null,
    },
  ]));
}

export function buildAutomationHealthReport({
  now = new Date().toISOString(),
  sources = {},
  launchdComponents = [],
} = {}) {
  const blockers = [];
  const runtimeReadiness = summarizeRuntimeReadiness({
    runtimeSource: sources.runtimeReadiness,
    fullAutomationSource: sources.fullAutomationReadiness,
    blockers,
  });
  const launchd = summarizeLaunchd({ launchdComponents, blockers });
  const dashboard = summarizeDashboard({
    dashboardSource: sources.dashboardStatus,
    liveRuntimeSource: sources.liveRuntime,
    strategyTickSource: sources.strategyTickStatus,
    blockers,
  });
  const allChain = summarizeAllChain({
    latestSource: sources.allChainAutopilotLatest,
    completedSource: sources.allChainAutopilotLatestCompleted,
    blockers,
  });
  const queues = summarizeQueues({ sources, blockers });
  const routeRemediation = summarizeRouteRemediation({ routeSource: sources.routeRemediation, blockers });
  for (const [name, source] of Object.entries(sources)) {
    if (source?.error) addBlocker(blockers, "source_read", "source_read_error", { name, error: source.error });
  }

  const top = topBlockers(blockers);
  return {
    schemaVersion: 1,
    generatedAt: now,
    readOnly: true,
    forbiddenActions: [...AUTOMATION_HEALTH_FORBIDDEN_ACTIONS],
    status: top.length === 0 ? "ready" : "attention_required",
    blockerCount: blockers.length,
    runtimeReadiness,
    launchd,
    dashboard,
    allChain,
    queues,
    routeRemediation,
    topBlockers: top,
    inputs: sourceInputSummary(sources),
    policyNote: "This report only reads local snapshots and plist presence. It never toggles kill-switches, starts daemons, calls the signer, or executes trades.",
  };
}

async function defaultReadJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function defaultPathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readSource({ rootDir, name, relativePath, readJsonFile }) {
  if (Array.isArray(relativePath)) {
    let lastMissing = null;
    for (const candidatePath of relativePath) {
      const source = await readSource({ rootDir, name, relativePath: candidatePath, readJsonFile });
      if (source.present || source.error) return source;
      lastMissing = source;
    }
    return lastMissing || { path: null, present: false, json: null };
  }
  const path = resolve(rootDir, relativePath);
  try {
    return {
      path,
      present: true,
      json: await readJsonFile(path),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path, present: false, json: null };
    }
    return {
      path,
      present: false,
      json: null,
      error: error.message || String(error),
    };
  }
}

export function buildAutomationLaunchdSpecs({ rootDir = process.cwd(), nodePath = process.execPath } = {}) {
  const builders = [
    ["executor", buildExecutorLaunchAgentSpecs],
    ["liveAutomation", buildLiveAutomationLaunchAgentSpecs],
    ["dashboard", buildDashboardLaunchAgentSpecs],
    ["research", buildResearchLaunchAgentSpecs],
    ["strategyAutomation", buildStrategyAutomationLaunchAgentSpecs],
  ];
  return builders.flatMap(([kind, builder]) =>
    builder({ rootDir, nodePath }).map((spec) => ({
      id: spec.id,
      kind,
      label: spec.label,
      plistPath: spec.plistPath,
    })),
  );
}

export async function collectAutomationHealthReport({
  rootDir = process.cwd(),
  now = new Date().toISOString(),
  readJsonFile = defaultReadJsonFile,
  pathExists = defaultPathExists,
  sourcePaths = DEFAULT_SOURCE_PATHS,
  sourceOverrides = {},
  launchdSpecBuilder = buildAutomationLaunchdSpecs,
} = {}) {
  const resolvedRoot = resolve(rootDir);
  const entries = await Promise.all(
    Object.entries(sourcePaths).map(async ([name, relativePath]) => [
      name,
      await readSource({ rootDir: resolvedRoot, name, relativePath, readJsonFile }),
    ]),
  );
  const launchdComponents = await Promise.all(
    launchdSpecBuilder({ rootDir: resolvedRoot }).map(async (spec) => ({
      ...spec,
      plistPresent: await pathExists(spec.plistPath),
    })),
  );
  return buildAutomationHealthReport({
    now,
    sources: {
      ...Object.fromEntries(entries),
      ...sourceOverrides,
    },
    launchdComponents,
  });
}
