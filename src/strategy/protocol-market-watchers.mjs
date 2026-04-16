function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countBy(items = [], selector) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function ageMinutes(observedAt = null, now = null) {
  if (!observedAt || !now) return null;
  const ageMs = new Date(now).getTime() - new Date(observedAt).getTime();
  return Number.isFinite(ageMs) ? ageMs / 60_000 : null;
}

function freshnessStatus(observedAt, { now = null, maxAgeMinutes = 360 } = {}) {
  if (!observedAt) return "missing";
  const age = ageMinutes(observedAt, now);
  if (!Number.isFinite(age)) return "unknown";
  return age <= maxAgeMinutes ? "fresh" : "stale";
}

function watcher({
  id,
  label,
  category,
  status,
  targets = [],
  blockers = [],
  evidence = null,
  nextAction = null,
}) {
  return {
    id,
    label,
    category,
    status,
    targets: unique(targets),
    blockers: unique(blockers),
    evidence,
    nextAction,
  };
}

function validationById(report = null, id = null) {
  return (report?.validations || []).find((item) => item.id === id) || null;
}

function wrappedLoopWatcher({ wrappedBtcLendingLoopSlice = null, phase3Validation = null, dashboardStatus = null } = {}) {
  const validation = validationById(phase3Validation, "wrapped_btc_loop_validation");
  const dryRunSummary = wrappedBtcLendingLoopSlice?.dryRunSummary || null;
  const staleGas = (dashboardStatus?.overall?.blockers || []).includes("stale_gas_snapshots");
  const blockers = [
    ...(validation?.blockers || []),
    staleGas ? "stale_gas_snapshots" : null,
  ];
  return watcher({
    id: "wrapped_btc_loop_market_watch",
    label: "Wrapped-BTC loop market watch",
    category: "leverage",
    status: blockers.length === 0 ? "passed" : "blocked",
    targets: ["wrapped-btc-loop-base-moonwell"],
    blockers,
    evidence: {
      strategyId: wrappedBtcLendingLoopSlice?.strategy?.id || null,
      protocol: wrappedBtcLendingLoopSlice?.strategy?.protocol || null,
      oracleModel: wrappedBtcLendingLoopSlice?.protocolAdapter?.oracleModel || null,
      referenceOracles: wrappedBtcLendingLoopSlice?.protocolAdapter?.referenceOracles || [],
      oracleStatus: wrappedBtcLendingLoopSlice?.oracleSanity?.status || null,
      oracleDriftPct: wrappedBtcLendingLoopSlice?.oracleSanity?.protocolDriftPct ?? null,
      autoUnwindPassCount: dryRunSummary?.autoUnwindPassCount ?? 0,
      dryRunReceiptRecorded: dryRunSummary?.dryRunReceiptRecorded === true,
    },
    nextAction:
      validation?.blockers?.includes("protocol_trust_tier_not_recorded")
        ? { code: "record_moonwell_trust_tier", command: null }
        : staleGas
          ? { code: "refresh_gas_snapshot", command: "npm run gas:snapshot" }
          : validation?.nextAction || null,
  });
}

function stableLoopWatcher({ secondaryStrategyScaffolds = null, phase3Validation = null } = {}) {
  const validation = validationById(phase3Validation, "stablecoin_spread_loop_validation");
  const scaffold = (secondaryStrategyScaffolds?.scaffolds || []).find((item) => item.id === "stablecoin_spread_loop") || null;
  return watcher({
    id: "stablecoin_spread_market_watch",
    label: "Stablecoin spread market watch",
    category: "leverage",
    status: validation?.overallStatus === "passed" ? "passed" : "blocked",
    targets: ["stablecoin_spread_loop"],
    blockers: [...(validation?.blockers || []), ...(scaffold?.missingEvidence || [])],
    evidence: {
      protocols: scaffold?.protocolTrack?.protocols || [],
      laneStatus: validation?.evidence?.statusNew || null,
      netPnlMeasuredUsd: validation?.evidence?.netPnlMeasuredUsd ?? null,
    },
    nextAction: validation?.nextAction || scaffold?.nextAction || null,
  });
}

function proxySpreadWatcher({ dexSpreadLatest = null, phase3Validation = null, now = null } = {}) {
  const validation = validationById(phase3Validation, "proxy_spread_expansion_validation");
  const observedAt = dexSpreadLatest?.observedAt || null;
  const freshness = freshnessStatus(observedAt, { now, maxAgeMinutes: 360 });
  return watcher({
    id: "proxy_spread_market_watch",
    label: "Proxy spread market watch",
    category: "arbitrage",
    status: freshness === "fresh" && validation?.overallStatus === "passed" ? "passed" : freshness === "fresh" ? "observe" : "blocked",
    targets: ["proxy_spread_expansion", "btc_proxy_spreads"],
    blockers: [
      freshness === "stale" ? "stale_dex_spread_surface" : null,
      freshness === "missing" ? "missing_dex_spread_surface" : null,
      ...(validation?.blockers || []),
    ],
    evidence: {
      observedAt,
      ageMinutes: round(ageMinutes(observedAt, now)),
      chainCount: dexSpreadLatest?.chainCount ?? 0,
      tokenCount: dexSpreadLatest?.tokenCount ?? 0,
    },
    nextAction:
      freshness === "stale" || freshness === "missing"
        ? { code: "refresh_proxy_spread_surface", command: "npm run collect:dex-spreads" }
        : validation?.nextAction || { code: "expand_proxy_spread_ladder", command: "npm run report:btc-proxy-spreads" },
  });
}

function gatewayLagWatcher({ quoteLagLatest = null, now = null } = {}) {
  const observedAt = quoteLagLatest?.generatedAt || quoteLagLatest?.latestSampleAt || null;
  const freshness = freshnessStatus(observedAt, { now, maxAgeMinutes: 360 });
  const dislocationReady = (quoteLagLatest?.lagStats?.profitableSampleCount ?? 0) > 0;
  return watcher({
    id: "gateway_quote_lag_watch",
    label: "Gateway quote lag watch",
    category: "gateway",
    status: freshness === "fresh" ? (dislocationReady ? "observe" : "passed") : "blocked",
    targets: ["gateway_base_btc_yield", "btc_proxy_spreads", "stablecoin_spread_loop"],
    blockers: [
      freshness === "stale" ? "stale_quote_lag_surface" : null,
      freshness === "missing" ? "missing_quote_lag_surface" : null,
    ],
    evidence: {
      observedAt,
      ageMinutes: round(ageMinutes(observedAt, now)),
      sampleCount: quoteLagLatest?.sampleCount ?? 0,
      profitableSampleCount: quoteLagLatest?.lagStats?.profitableSampleCount ?? 0,
      profitableSamplePct: quoteLagLatest?.lagStats?.profitableSamplePct ?? null,
      verdict: quoteLagLatest?.verdict || null,
    },
    nextAction:
      freshness === "stale" || freshness === "missing"
        ? { code: "refresh_quote_lag_surface", command: "npm run collect:quote-lag" }
        : null,
  });
}

function trustTierWatcher({ phase3Validation = null, protocolTrustTiers = null } = {}) {
  const recordedTargets = new Set((protocolTrustTiers?.items || []).filter((item) => item.status === "recorded").flatMap((item) => item.appliesTo || []));
  const targets = (phase3Validation?.validations || [])
    .filter((item) => (item?.blockers || []).some((blocker) => blocker === "protocol_trust_tier_not_recorded" || blocker === "protocol_tier_forbidden"))
    .map((item) => item.evidence?.strategyId || item.id.replace(/_validation$/, ""))
    .filter((item) => !recordedTargets.has(item));
  return watcher({
    id: "protocol_trust_tier_watch",
    label: "Protocol trust tier watch",
    category: "protocol",
    status: targets.length === 0 ? "passed" : "blocked",
    targets,
    blockers: targets.length === 0 ? [] : ["protocol_trust_tier_not_recorded"],
    evidence: {
      pendingTargetCount: targets.length,
    },
    nextAction: targets.length === 0 ? null : { code: "record_protocol_trust_tiers", command: null },
  });
}

export function buildProtocolMarketWatchers({
  dashboardStatus = null,
  quoteLagLatest = null,
  dexSpreadLatest = null,
  wrappedBtcLendingLoopSlice = null,
  phase3Validation = null,
  protocolTrustTiers = null,
  secondaryStrategyScaffolds = null,
  now = null,
} = {}) {
  const generatedAt = now || new Date().toISOString();
  const watchers = [
    wrappedLoopWatcher({ wrappedBtcLendingLoopSlice, phase3Validation, dashboardStatus }),
    stableLoopWatcher({ secondaryStrategyScaffolds, phase3Validation }),
    proxySpreadWatcher({ dexSpreadLatest, phase3Validation, now: generatedAt }),
    gatewayLagWatcher({ quoteLagLatest, now: generatedAt }),
    trustTierWatcher({ phase3Validation, protocolTrustTiers }),
  ];
  const topBlocked = watchers.find((item) => item.status === "blocked") || null;
  const blockerCounts = watchers
    .flatMap((item) => item.blockers || [])
    .reduce((acc, blocker) => ({ ...acc, [blocker]: (acc[blocker] || 0) + 1 }), {});
  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      watcherCount: watchers.length,
      statusCounts: countBy(watchers, (item) => item.status || "unknown"),
      blockedCount: watchers.filter((item) => item.status === "blocked").length,
      observeCount: watchers.filter((item) => item.status === "observe").length,
      topBlockedId: topBlocked?.id || null,
      topBlockers: Object.entries(blockerCounts)
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, 8)
        .map(([blocker, count]) => ({ blocker, count })),
      nextAction: topBlocked?.nextAction || null,
    },
    watchers,
  };
}

export function summarizeProtocolMarketWatchers(report = null) {
  if (!report) return null;
  const topBlocked =
    report.watchers?.find((item) => item.id === report.summary?.topBlockedId) ||
    report.watchers?.find((item) => item.status === "blocked") ||
    null;
  return {
    watcherCount: report.summary?.watcherCount ?? 0,
    blockedCount: report.summary?.blockedCount ?? 0,
    observeCount: report.summary?.observeCount ?? 0,
    statusCounts: report.summary?.statusCounts || {},
    topBlocked: topBlocked
      ? {
          id: topBlocked.id || null,
          label: topBlocked.label || null,
          status: topBlocked.status || null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
