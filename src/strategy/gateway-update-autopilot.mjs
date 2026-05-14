import { summarizeAutonomousDiscoveryBoard } from "./autonomous-discovery-board.mjs";
import {
  OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  OFFICIAL_GATEWAY_ROUTE_CHAINS,
  summarizeOfficialGatewayRouteSurface,
} from "./autonomous-discovery-board.mjs";
import { summarizeStrategySnapshot } from "./strategy-snapshot.mjs";

function sample(items = [], limit = 20) {
  return items.slice(0, limit);
}

function previewSteps(steps = []) {
  return steps.map((step) => ({
    id: step.id,
    script: step.script,
    ok: null,
    exitCode: null,
    signal: null,
    durationMs: null,
    stdoutSummary: null,
    stderrSummary: null,
  }));
}

export function defaultGatewayUpdateAutopilotPnl(overrides = {}) {
  return {
    paper: {
      btc: null,
      usdProjection: null,
      status: overrides.paperStatus || "gateway_update_refresh_has_no_paper_btc_pnl",
    },
    estimated: {
      btc: null,
      usdProjection: null,
      status: overrides.estimatedStatus || "gateway_update_refresh_has_no_estimated_btc_pnl",
    },
    realized: {
      btc: null,
      usdProjection: null,
      status: overrides.realizedStatus || "gateway_update_refresh_has_no_realized_btc_pnl",
    },
  };
}

export function buildGatewayUpdateAlertRecord(result) {
  return {
    observedAt: result.observedAt,
    updateDetected: result.updateDetected,
    changeReasons: result.changeReasons,
    routeCount: result.snapshot.routeCount,
    chains: result.snapshot.chains,
    routeHash: result.snapshot.routeHash,
    schemaHash: result.schemaHash,
    ethFamily: {
      routeCount: result.ethFamily?.routeCount || 0,
      surfaceChanged: Boolean(result.ethFamily?.surfaceChanged),
      chainPairs: result.ethFamily?.chainPairs || [],
      addedRoutesCount: result.diff.addedEthFamilyRoutes.length,
      removedRoutesCount: result.diff.removedEthFamilyRoutes.length,
      addedRoutesSample: sample(result.diff.addedEthFamilyRoutes),
      removedRoutesSample: sample(result.diff.removedEthFamilyRoutes),
      addedChainPairs: result.diff.addedEthFamilyChainPairs || [],
      removedChainPairs: result.diff.removedEthFamilyChainPairs || [],
      followUpCommands:
        result.diff.addedEthFamilyRoutes.length > 0 || result.diff.removedEthFamilyRoutes.length > 0
          ? ["npm run analyze:ethereum-routes -- --write", "npm run audit:eth-family-overfit"]
          : [],
    },
    routeDiff: {
      changed: result.diff.changed,
      reason: result.diff.reason,
      addedRoutesCount: result.diff.addedRoutes.length,
      removedRoutesCount: result.diff.removedRoutes.length,
      addedRoutesSample: sample(result.diff.addedRoutes),
      removedRoutesSample: sample(result.diff.removedRoutes),
      addedChains: result.diff.addedChains,
      removedChains: result.diff.removedChains,
      addedTokensCount: result.diff.addedTokens.length,
      removedTokensCount: result.diff.removedTokens.length,
      addedTokensSample: sample(result.diff.addedTokens),
      removedTokensSample: sample(result.diff.removedTokens),
    },
    schemaDiff: result.schemaDiff,
    probeHealthDiff: result.probeHealthDiff,
    probeFailures: result.probeFailures,
    probes: result.probes.map((probe) => ({
      ok: probe.ok,
      routeKey: probe.routeKey,
      latencyMs: probe.latencyMs || null,
      shape: probe.shape || null,
      error: probe.error || null,
    })),
    scanRecommendations: result.diff.addedRoutes.slice(0, 20).map((routeKey) => ({
      routeKey,
      command: `npm run scan:quote-surface -- --route-key="${routeKey}"`,
    })),
    ethFamilyScanRecommendations: result.diff.addedEthFamilyRoutes.slice(0, 20).map((routeKey) => ({
      routeKey,
      command: `npm run scan:quote-surface -- --route-key="${routeKey}"`,
    })),
  };
}

export function buildGatewayUpdateAutopilotRefreshPlan({ watchResult = null } = {}) {
  const changeReasons = watchResult?.changeReasons || [];
  if (!watchResult?.updateDetected) {
    return {
      executionMode: "planning_only",
      triggered: false,
      reason: "no_gateway_surface_update_detected",
      steps: [],
    };
  }

  const steps = [
    {
      id: "refresh_gateway_inventory",
      script: "verify:gateway:asset-coverage",
      command: "npm run verify:gateway:asset-coverage",
      artifact: "data/gateway-routes.jsonl",
    },
    {
      id: "refresh_gateway_gold_readiness",
      script: "report:gateway-gold-readiness",
      command: "npm run report:gateway-gold-readiness -- --write",
      artifact: "data/gateway-gold-readiness-latest.json",
    },
    {
      id: "refresh_btc_quote_surface",
      script: "scan:quote-surface",
      command: `npm run scan:quote-surface -- --family=btc --route-limit=12 --chains=${OFFICIAL_GATEWAY_ROUTE_CHAINS.join(",")}`,
      artifact: "data/quote-surface-scans.jsonl",
    },
    ...(changeReasons.includes("eth_family_surface")
      ? [
          {
            id: "refresh_eth_quote_surface",
            script: "scan:quote-surface",
            command: `npm run scan:quote-surface -- --family=eth --route-limit=12 --chains=${OFFICIAL_GATEWAY_DESTINATION_CHAINS.join(",")}`,
            artifact: "data/quote-surface-scans.jsonl",
          },
        ]
      : []),
    {
      id: "refresh_autonomous_discovery_board",
      script: "report:autonomous-discovery-board",
      command: "npm run report:autonomous-discovery-board -- --write",
      artifact: "data/autonomous-discovery-board.json",
    },
    {
      id: "refresh_strategy_snapshot",
      script: "report:strategy-snapshot",
      command: "npm run report:strategy-snapshot -- --write",
      artifact: "data/strategy-snapshot.json",
    },
  ];

  return {
    executionMode: "planning_only",
    triggered: true,
    reason: "gateway_surface_update_detected",
    changeReasons,
    steps,
  };
}

export function buildGatewayUpdateAutopilotRecord({
  watchResult = null,
  refreshPlan = null,
  refreshExecution = null,
  autonomousDiscoveryBoard = null,
  strategySnapshot = null,
  observedRoutes = [],
  mode = "preview",
  now = null,
} = {}) {
  const routeSurface = summarizeOfficialGatewayRouteSurface(observedRoutes);
  const triggered = Boolean(refreshPlan?.triggered);
  const executionStatus = !triggered
    ? "noop"
    : mode === "execute"
      ? refreshExecution?.executionStatus || "failed"
      : "preview";
  const autonomousDiscoverySummary = summarizeAutonomousDiscoveryBoard(autonomousDiscoveryBoard);
  const strategySnapshotSummary = summarizeStrategySnapshot(strategySnapshot);
  return {
    schemaVersion: 1,
    observedAt: now || new Date().toISOString(),
    mode,
    executionMode: "planning_only",
    watch: {
      updateDetected: Boolean(watchResult?.updateDetected),
      changeReasons: watchResult?.changeReasons || [],
      routeCount: watchResult?.snapshot?.routeCount ?? 0,
      routeHash: watchResult?.snapshot?.routeHash || null,
      schemaHash: watchResult?.schemaHash || null,
      probeHealthHash: watchResult?.probeHealthHash || null,
      addedRoutesCount: watchResult?.diff?.addedRoutes?.length ?? 0,
      removedRoutesCount: watchResult?.diff?.removedRoutes?.length ?? 0,
      addedChains: watchResult?.diff?.addedChains || [],
      removedChains: watchResult?.diff?.removedChains || [],
    },
    supportedSurface: routeSurface,
    refresh: {
      triggered,
      reason: refreshPlan?.reason || null,
      stepCount: refreshPlan?.steps?.length ?? 0,
      executionStatus,
      commands: (refreshPlan?.steps || []).map((step) => step.command),
      steps: mode === "execute" ? refreshExecution?.steps || [] : previewSteps(refreshPlan?.steps || []),
    },
    planningArtifacts: {
      autonomousDiscoveryBoard: autonomousDiscoverySummary,
      strategySnapshot: strategySnapshotSummary,
    },
    pnl: autonomousDiscoverySummary?.pnl || defaultGatewayUpdateAutopilotPnl(),
  };
}

export function summarizeGatewayUpdateAutopilotRuns(records = []) {
  const latest = records.at(-1) || null;
  return {
    generatedAt: new Date().toISOString(),
    executionMode: "planning_only",
    runCount: records.length,
    previewCount: records.filter((record) => record?.refresh?.executionStatus === "preview").length,
    successCount: records.filter((record) => record?.refresh?.executionStatus === "succeeded").length,
    failureCount: records.filter((record) => record?.refresh?.executionStatus === "failed").length,
    noopCount: records.filter((record) => record?.refresh?.executionStatus === "noop").length,
    latestObservedAt: latest?.observedAt || null,
    latestMode: latest?.mode || null,
    latestUpdateDetected: latest?.watch?.updateDetected ?? false,
    latestChangeReasons: latest?.watch?.changeReasons || [],
    latestRouteHash: latest?.watch?.routeHash || null,
    latestSchemaHash: latest?.watch?.schemaHash || null,
    latestProbeHealthHash: latest?.watch?.probeHealthHash || null,
    latestExecutionStatus: latest?.refresh?.executionStatus || null,
    latestSupportedSurface: latest?.supportedSurface || summarizeOfficialGatewayRouteSurface([]),
    latestAutonomousDiscoveryBoard: latest?.planningArtifacts?.autonomousDiscoveryBoard || null,
    latestStrategySnapshot: latest?.planningArtifacts?.strategySnapshot || null,
    pnl: latest?.pnl || defaultGatewayUpdateAutopilotPnl(),
  };
}
