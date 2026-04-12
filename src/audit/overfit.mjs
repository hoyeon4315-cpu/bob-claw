import { summarizeQuoteDecay } from "../shadow/quote-decay.mjs";
import { isBtcFamilyRoute } from "../assets/tokens.mjs";

export const DEFAULT_AUDIT_TARGETS = {
  currentQuoteSchemaVersion: null,
  minShadowHours: 168,
  minBobNeighborCoveragePct: 80,
  minGlobalRouteCoveragePctForDiscovery: 50,
  minSamplesPerCandidateRoute: 30,
  minAmountLevelsPerCandidateRoute: 4,
  minHourBuckets: 24,
  maxFailureRatePct: 10,
  maxGasSnapshotAgeMinutes: 30,
  requiredQuoteDecayWindowsSeconds: [5, 15, 30],
  minQuoteDecayCoveredGroupsPerWindow: 1,
};

function hoursBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

function minutesBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 3_600_000).toISOString();
}

function startOfUtcHour(date) {
  const value = new Date(date);
  value.setUTCMinutes(0, 0, 0);
  return value;
}

function addUtcHourBuckets(date, hours) {
  const value = startOfUtcHour(date);
  value.setUTCHours(value.getUTCHours() + hours);
  return value.toISOString();
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function sortDates(items) {
  return items.map((item) => item.observedAt).filter(Boolean).sort((a, b) => new Date(a) - new Date(b));
}

function routeKeyFromShadowObservation(item) {
  return item?.routeKey || null;
}

function amountFromShadowObservation(item) {
  return item?.amount || null;
}

function isCloudflareFailure(failure) {
  const details = failure.error?.details;
  return Boolean(
    details?.isCloudflareChallenge ||
      details?.bodySnippet?.includes("challenge-platform") ||
      details?.bodyText?.includes("challenge-platform") ||
      details?.bodyText?.includes("Just a moment"),
  );
}

function isBobNeighborRoute(route) {
  return isBtcFamilyRoute(route) && (route.srcChain === "bob" || route.dstChain === "bob");
}

function routeKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

function latestBy(items, keyFn, dateFn = (item) => item.observedAt) {
  const latest = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const existing = latest.get(key);
    if (!existing || new Date(dateFn(item)) > new Date(dateFn(existing))) {
      latest.set(key, item);
    }
  }
  return latest;
}

function latestSchemaVersion(items = []) {
  let latest = null;
  for (const item of items) {
    if (!Number.isFinite(item?.schemaVersion)) continue;
    if (latest === null || item.schemaVersion > latest) {
      latest = item.schemaVersion;
    }
  }
  return latest;
}

export function buildOverfitAudit(input, targets = DEFAULT_AUDIT_TARGETS) {
  const effectiveTargets = { ...DEFAULT_AUDIT_TARGETS, ...(targets || {}) };
  const routesRecords = input.routesRecords || [];
  const quotes = input.quotes || [];
  const failures = input.failures || [];
  const gasSnapshots = input.gasSnapshots || [];
  const gasFailures = input.gasFailures || [];
  const shadowObservations = input.shadowObservations || [];
  const now = input.now || new Date().toISOString();

  const latestRoutes = routesRecords.at(-1);
  const routes = latestRoutes?.routes || [];
  const totalGatewayRoutes = latestRoutes?.summary?.totalRoutes || routes.length || 0;
  const bobNeighborRouteKeys = new Set(routes.filter(isBobNeighborRoute).map(routeKey));

  const validQuotes = quotes.filter((quote) => quote.quoteType && quote.routeKey && quote.grossOutputRatio > 0);
  const schemaScopedRecords = [...quotes, ...failures].filter((item) => Number.isFinite(item?.schemaVersion));
  const activeSchemaVersion = Number.isFinite(effectiveTargets.currentQuoteSchemaVersion)
    ? effectiveTargets.currentQuoteSchemaVersion
    : latestSchemaVersion(schemaScopedRecords);
  const schemaQuotes = Number.isFinite(activeSchemaVersion)
    ? validQuotes.filter((quote) => quote.schemaVersion === activeSchemaVersion)
    : validQuotes;
  const schemaFailures = Number.isFinite(activeSchemaVersion)
    ? failures.filter((failure) => failure.schemaVersion === activeSchemaVersion)
    : failures;
  const activeQuotes = schemaQuotes.length > 0 ? schemaQuotes : validQuotes;
  const activeFailures = schemaQuotes.length > 0 || schemaFailures.length > 0 ? schemaFailures : failures;
  const validShadowObservations = shadowObservations.filter((item) => routeKeyFromShadowObservation(item) && item.observedAt);
  const useShadowObservations = validShadowObservations.length > 0;
  const activeObservationRouteKeys = new Set(validShadowObservations.map((item) => routeKeyFromShadowObservation(item)));
  const activeQuoteRouteKeys = new Set(activeQuotes.map((quote) => quote.routeKey));
  const sampledRouteKeys = useShadowObservations ? activeObservationRouteKeys : activeQuoteRouteKeys;
  const activeBobNeighborRouteKeys = new Set([...sampledRouteKeys].filter((key) => bobNeighborRouteKeys.has(key)));
  const datedRecords = [...activeQuotes, ...activeFailures].filter((item) => item.observedAt);
  const dates = sortDates(useShadowObservations ? validShadowObservations : datedRecords);
  const firstObservedAt = dates[0] || null;
  const lastObservedAt = dates.at(-1) || null;
  const shadowHours = firstObservedAt && lastObservedAt ? hoursBetween(firstObservedAt, lastObservedAt) : 0;
  const hourBuckets = new Set((useShadowObservations ? validShadowObservations : datedRecords).map((item) => item.observedAt?.slice(0, 13)).filter(Boolean));
  const routeCoveragePct = pct(sampledRouteKeys.size, totalGatewayRoutes);
  const bobNeighborCoveragePct = pct(activeBobNeighborRouteKeys.size, bobNeighborRouteKeys.size);
  const allAttempts = activeQuotes.length + activeFailures.length;
  const failureRatePct = pct(activeFailures.length, allAttempts);
  const cloudflareFailures = activeFailures.filter(isCloudflareFailure).length;
  const legacyRecords = [...quotes, ...failures].filter((item) => !item.schemaVersion).length;
  const sampleGroups = useShadowObservations
    ? groupBy(validShadowObservations, (item) => routeKeyFromShadowObservation(item))
    : groupBy(activeQuotes, (quote) => quote.routeKey);
  const candidateRoutes = [...sampleGroups.entries()].filter(([, routeSamples]) => routeSamples.length >= effectiveTargets.minSamplesPerCandidateRoute);
  const candidateAmountFailures = candidateRoutes.filter(([, routeSamples]) => {
    const amounts = new Set(routeSamples.map((item) => (useShadowObservations ? amountFromShadowObservation(item) : item.amount)).filter(Boolean));
    return amounts.size < effectiveTargets.minAmountLevelsPerCandidateRoute;
  });
  const latestGasByChain = latestBy(gasSnapshots, (snapshot) => snapshot.chain);
  const latestGasDates = [...latestGasByChain.values()].map((snapshot) => snapshot.observedAt).filter(Boolean);
  const maxGasAgeMinutes =
    latestGasDates.length > 0 ? Math.max(...latestGasDates.map((date) => minutesBetween(date, now))) : Infinity;
  const latencySamples = (useShadowObservations ? validShadowObservations : activeQuotes).map((item) => item.latencyMs).filter(Number.isFinite);
  const executionGasSamples = validShadowObservations.map((item) => item.executionGasUsd).filter(Number.isFinite);
  const quoteDecay = summarizeQuoteDecay(validShadowObservations);
  const quoteDecayWindows = quoteDecay.windows;
  const requiredQuoteDecayWindows = quoteDecayWindows.filter((item) =>
    effectiveTargets.requiredQuoteDecayWindowsSeconds.includes(item.windowSeconds),
  );
  const quoteDecayCoverageOk =
    !useShadowObservations ||
    requiredQuoteDecayWindows.every((item) => item.coveredGroups >= effectiveTargets.minQuoteDecayCoveredGroupsPerWindow);
  const latencyP50Ms = percentile(latencySamples, 50);
  const latencyP95Ms = percentile(latencySamples, 95);
  const executionGasP50Usd = percentile(executionGasSamples, 50);
  const executionGasP95Usd = percentile(executionGasSamples, 95);
  const remainingShadowHours = Math.max(0, effectiveTargets.minShadowHours - shadowHours);
  const remainingHourBuckets = Math.max(0, effectiveTargets.minHourBuckets - hourBuckets.size);
  const earliestShadowWindowReadyAt = firstObservedAt
    ? remainingShadowHours > 0
      ? addHours(firstObservedAt, effectiveTargets.minShadowHours)
      : now
    : null;
  const earliestHourBucketReadyAt = lastObservedAt
    ? remainingHourBuckets > 0
      ? addUtcHourBuckets(lastObservedAt, remainingHourBuckets)
      : now
    : null;
  const earliestTimeGateReadyAt =
    earliestShadowWindowReadyAt && earliestHourBucketReadyAt
      ? new Date(earliestShadowWindowReadyAt) > new Date(earliestHourBucketReadyAt)
        ? earliestShadowWindowReadyAt
        : earliestHourBucketReadyAt
      : earliestShadowWindowReadyAt || earliestHourBucketReadyAt || null;

  const checks = [
    {
      label: "shadow time window",
      ok: shadowHours >= effectiveTargets.minShadowHours,
      detail: `${shadowHours.toFixed(2)}h observed, target ${effectiveTargets.minShadowHours}h`,
    },
    {
      label: "BOB-neighbor route coverage",
      ok: bobNeighborCoveragePct >= effectiveTargets.minBobNeighborCoveragePct,
      detail: `${activeBobNeighborRouteKeys.size}/${bobNeighborRouteKeys.size} routes (${bobNeighborCoveragePct.toFixed(1)}%), target ${effectiveTargets.minBobNeighborCoveragePct}%`,
    },
    {
      label: "candidate sample depth",
      ok: candidateRoutes.length > 0,
      detail: `${candidateRoutes.length} routes have >= ${effectiveTargets.minSamplesPerCandidateRoute} samples`,
    },
    {
      label: "candidate amount diversity",
      ok: candidateRoutes.length > 0 && candidateAmountFailures.length === 0,
      detail: `${candidateAmountFailures.length} candidate routes have < ${effectiveTargets.minAmountLevelsPerCandidateRoute} amount levels`,
    },
    {
      label: "quote decay windows",
      ok: quoteDecayCoverageOk,
      detail:
        useShadowObservations && requiredQuoteDecayWindows.length > 0
          ? requiredQuoteDecayWindows
              .map((item) => `${item.windowSeconds}s=${item.coveredGroups}`)
              .join(" ")
          : "shadow observations not active",
    },
    {
      label: "time bucket diversity",
      ok: hourBuckets.size >= effectiveTargets.minHourBuckets,
      detail: `${hourBuckets.size} hourly buckets, target ${effectiveTargets.minHourBuckets}`,
    },
    {
      label: "failure rate",
      ok: failureRatePct <= effectiveTargets.maxFailureRatePct,
      detail: `${failureRatePct.toFixed(1)}%, target <= ${effectiveTargets.maxFailureRatePct}%`,
    },
    {
      label: "fresh gas snapshots",
      ok: maxGasAgeMinutes <= effectiveTargets.maxGasSnapshotAgeMinutes,
      detail: `${Number.isFinite(maxGasAgeMinutes) ? maxGasAgeMinutes.toFixed(1) : "n/a"}m old, target <= ${effectiveTargets.maxGasSnapshotAgeMinutes}m`,
    },
  ];

  const warnings = [
    {
      label: "global route coverage",
      ok: routeCoveragePct >= effectiveTargets.minGlobalRouteCoveragePctForDiscovery,
      detail: `${sampledRouteKeys.size}/${totalGatewayRoutes} routes (${routeCoveragePct.toFixed(1)}%), discovery target ${effectiveTargets.minGlobalRouteCoveragePctForDiscovery}%`,
    },
    {
      label: "legacy records",
      ok: legacyRecords === 0,
      detail: `${legacyRecords} records without schemaVersion`,
    },
    {
      label: "Cloudflare failures",
      ok: cloudflareFailures === 0,
      detail: `${cloudflareFailures} Cloudflare-like failures observed`,
    },
    {
      label: "gas snapshot failures",
      ok: gasFailures.length === 0,
      detail: `${gasFailures.length} gas snapshot failures observed`,
    },
    {
      label: "quote latency p95",
      ok: Number.isFinite(latencyP95Ms),
      detail: `${Number.isFinite(latencyP50Ms) ? latencyP50Ms.toFixed(0) : "n/a"}ms p50 · ${Number.isFinite(latencyP95Ms) ? latencyP95Ms.toFixed(0) : "n/a"}ms p95`,
    },
    {
      label: "execution gas p95",
      ok: Number.isFinite(executionGasP95Usd),
      detail: `${Number.isFinite(executionGasP50Usd) ? executionGasP50Usd.toFixed(4) : "n/a"} USD p50 · ${Number.isFinite(executionGasP95Usd) ? executionGasP95Usd.toFixed(4) : "n/a"} USD p95`,
    },
    {
      label: "quote decay coverage",
      ok: !useShadowObservations || quoteDecay.coveredGroups > 0,
      detail: quoteDecayWindows.map((item) => `${item.windowSeconds}s=${item.coveredGroups}`).join(" · "),
    },
    {
      label: "quote decay survival",
      ok: !useShadowObservations || quoteDecayWindows.some((item) => item.survivedGroups > 0),
      detail: quoteDecayWindows
        .map(
          (item) =>
            `${item.windowSeconds}s ${item.survivedGroups}/${item.profitableStartGroups}${
              Number.isFinite(item.survivalRatePct) ? ` (${item.survivalRatePct.toFixed(0)}%)` : ""
            }`,
        )
        .join(" · "),
    },
  ];

  const liveBlocked = checks.some((check) => !check.ok);
  const shadowAllowed = (useShadowObservations ? validShadowObservations.length : activeQuotes.length) > 0 && totalGatewayRoutes > 0;

  return {
    decision: liveBlocked ? "LIVE_BLOCKED" : "LIVE_CANARY_REVIEW_POSSIBLE",
    shadow: shadowAllowed ? "ALLOWED" : "BLOCKED",
    sampleSource: useShadowObservations ? "shadow_observations" : "quotes",
    firstObservedAt,
    lastObservedAt,
    quotes: quotes.length,
    activeQuotes: activeQuotes.length,
    shadowObservations: validShadowObservations.length,
    validQuotes: validQuotes.length,
    failures: failures.length,
    activeFailures: activeFailures.length,
    cloudflareFailures,
    gasSnapshots: gasSnapshots.length,
    gasFailures: gasFailures.length,
    shadowHours,
    hourBuckets: hourBuckets.size,
    targetShadowHours: effectiveTargets.minShadowHours,
    remainingShadowHours,
    targetHourBuckets: effectiveTargets.minHourBuckets,
    remainingHourBuckets,
    earliestShadowWindowReadyAt,
    earliestHourBucketReadyAt,
    earliestTimeGateReadyAt,
    latencyP50Ms,
    latencyP95Ms,
    executionGasP50Usd,
    executionGasP95Usd,
    quoteDecayCoveredGroups: quoteDecay.coveredGroups,
    quoteDecayWindows,
    totalGatewayRoutes,
    sampledRoutes: sampledRouteKeys.size,
    bobNeighborRoutes: bobNeighborRouteKeys.size,
    sampledBobNeighborRoutes: activeBobNeighborRouteKeys.size,
    checks,
    warnings,
    topSampledRoutes: [...sampleGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([key, routeSamples]) => ({
        routeKey: key,
        samples: routeSamples.length,
        amountLevels: new Set(routeSamples.map((item) => (useShadowObservations ? amountFromShadowObservation(item) : item.amount)).filter(Boolean)).size,
      })),
  };
}

export function formatAudit(audit) {
  const lines = [];
  lines.push("# Overfit Audit");
  lines.push("");
  lines.push(`decision=${audit.decision}`);
  lines.push(`shadow=${audit.shadow}`);
  lines.push(`sampleSource=${audit.sampleSource}`);
  lines.push(`firstObservedAt=${audit.firstObservedAt || "n/a"}`);
  lines.push(`lastObservedAt=${audit.lastObservedAt || "n/a"}`);
  lines.push(
    `quotes=${audit.quotes} activeQuotes=${audit.activeQuotes} shadowObservations=${audit.shadowObservations} validQuotes=${audit.validQuotes} failures=${audit.failures} activeFailures=${audit.activeFailures}`,
  );
  lines.push(`cloudflareFailures=${audit.cloudflareFailures}`);
  lines.push(`gasSnapshots=${audit.gasSnapshots} gasFailures=${audit.gasFailures}`);
  lines.push(
    `latencyP50Ms=${Number.isFinite(audit.latencyP50Ms) ? audit.latencyP50Ms.toFixed(0) : "n/a"} latencyP95Ms=${Number.isFinite(audit.latencyP95Ms) ? audit.latencyP95Ms.toFixed(0) : "n/a"}`,
  );
  lines.push(
    `executionGasP50Usd=${Number.isFinite(audit.executionGasP50Usd) ? audit.executionGasP50Usd.toFixed(4) : "n/a"} executionGasP95Usd=${Number.isFinite(audit.executionGasP95Usd) ? audit.executionGasP95Usd.toFixed(4) : "n/a"}`,
  );
  lines.push(`quoteDecayCoveredGroups=${audit.quoteDecayCoveredGroups}`);
  lines.push(
    `quoteDecayWindows=${(audit.quoteDecayWindows || [])
      .map(
        (item) =>
          `${item.windowSeconds}s:${item.coveredGroups}/${item.profitableStartGroups}/${item.survivedGroups}${
            Number.isFinite(item.survivalRatePct) ? `(${item.survivalRatePct.toFixed(0)}%)` : ""
          }`,
      )
      .join(" ")}`,
  );
  lines.push("");

  for (const check of audit.checks) {
    lines.push(`${check.ok ? "PASS" : "BLOCK"} ${check.label}: ${check.detail}`);
  }

  lines.push("");
  lines.push("Warnings:");
  for (const warning of audit.warnings) {
    lines.push(`${warning.ok ? "OK" : "WARN"} ${warning.label}: ${warning.detail}`);
  }

  lines.push("");
  lines.push("Top sampled routes:");
  for (const item of audit.topSampledRoutes) {
    lines.push(`  ${item.routeKey}: samples=${item.samples} amountLevels=${item.amountLevels}`);
  }

  lines.push("");
  lines.push("Required anti-overfit additions before live trading:");
  lines.push("  DEX executable quotes, not CoinGecko-only reference prices");
  lines.push("  exact eth_estimateGas for quote calldata with funded canary wallet");
  lines.push("  route failure-rate penalty in scoring");
  lines.push("  rolling p50/p95/p99 gas and quote latency windows");
  lines.push("  token decimals verification by chain/token");
  lines.push("  quote decay checks at 5s/15s/30s/60s");
  return lines.join("\n");
}
