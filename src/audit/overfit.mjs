export const DEFAULT_AUDIT_TARGETS = {
  currentQuoteSchemaVersion: 2,
  minShadowHours: 168,
  minBobNeighborCoveragePct: 80,
  minGlobalRouteCoveragePctForDiscovery: 50,
  minSamplesPerCandidateRoute: 30,
  minAmountLevelsPerCandidateRoute: 4,
  minHourBuckets: 24,
  maxFailureRatePct: 10,
  maxGasSnapshotAgeMinutes: 30,
};

const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
const DEFAULT_BTC_TOKEN = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const ETHEREUM_WBTC_TOKEN = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const UNI_BTC_TOKEN = "0x236f8c0a61dA474dB21B693fB2ea7AAB0c803894";
const BTC_FAMILY_TOKENS = new Set(
  [ZERO_TOKEN, DEFAULT_BTC_TOKEN, ETHEREUM_WBTC_TOKEN, UNI_BTC_TOKEN].map((token) => token.toLowerCase()),
);

function hoursBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

function minutesBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
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

function isCloudflareFailure(failure) {
  const details = failure.error?.details;
  return Boolean(
    details?.isCloudflareChallenge ||
      details?.bodySnippet?.includes("challenge-platform") ||
      details?.bodyText?.includes("challenge-platform") ||
      details?.bodyText?.includes("Just a moment"),
  );
}

function isBtcFamilyRoute(route) {
  return BTC_FAMILY_TOKENS.has(route.srcToken?.toLowerCase()) && BTC_FAMILY_TOKENS.has(route.dstToken?.toLowerCase());
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

export function buildOverfitAudit(input, targets = DEFAULT_AUDIT_TARGETS) {
  const routesRecords = input.routesRecords || [];
  const quotes = input.quotes || [];
  const failures = input.failures || [];
  const gasSnapshots = input.gasSnapshots || [];
  const gasFailures = input.gasFailures || [];
  const now = input.now || new Date().toISOString();

  const latestRoutes = routesRecords.at(-1);
  const routes = latestRoutes?.routes || [];
  const totalGatewayRoutes = latestRoutes?.summary?.totalRoutes || routes.length || 0;
  const bobNeighborRouteKeys = new Set(routes.filter(isBobNeighborRoute).map(routeKey));

  const validQuotes = quotes.filter((quote) => quote.quoteType && quote.routeKey && quote.grossOutputRatio > 0);
  const currentSchemaQuotes = validQuotes.filter((quote) => quote.schemaVersion === targets.currentQuoteSchemaVersion);
  const activeQuotes = currentSchemaQuotes.length > 0 ? currentSchemaQuotes : validQuotes;
  const activeQuoteRouteKeys = new Set(activeQuotes.map((quote) => quote.routeKey));
  const activeBobNeighborRouteKeys = new Set([...activeQuoteRouteKeys].filter((key) => bobNeighborRouteKeys.has(key)));
  const datedRecords = [...activeQuotes, ...failures].filter((item) => item.observedAt);
  const dates = sortDates(datedRecords);
  const firstObservedAt = dates[0] || null;
  const lastObservedAt = dates.at(-1) || null;
  const shadowHours = firstObservedAt && lastObservedAt ? hoursBetween(firstObservedAt, lastObservedAt) : 0;
  const hourBuckets = new Set(datedRecords.map((item) => item.observedAt?.slice(0, 13)).filter(Boolean));
  const routeCoveragePct = pct(activeQuoteRouteKeys.size, totalGatewayRoutes);
  const bobNeighborCoveragePct = pct(activeBobNeighborRouteKeys.size, bobNeighborRouteKeys.size);
  const allAttempts = activeQuotes.length + failures.length;
  const failureRatePct = pct(failures.length, allAttempts);
  const cloudflareFailures = failures.filter(isCloudflareFailure).length;
  const legacyRecords = [...quotes, ...failures].filter((item) => !item.schemaVersion).length;
  const quoteGroups = groupBy(activeQuotes, (quote) => quote.routeKey);
  const candidateRoutes = [...quoteGroups.entries()].filter(([, routeQuotes]) => routeQuotes.length >= targets.minSamplesPerCandidateRoute);
  const candidateAmountFailures = candidateRoutes.filter(([, routeQuotes]) => {
    const amounts = new Set(routeQuotes.map((quote) => quote.amount));
    return amounts.size < targets.minAmountLevelsPerCandidateRoute;
  });
  const latestGasByChain = latestBy(gasSnapshots, (snapshot) => snapshot.chain);
  const latestGasDates = [...latestGasByChain.values()].map((snapshot) => snapshot.observedAt).filter(Boolean);
  const maxGasAgeMinutes =
    latestGasDates.length > 0 ? Math.max(...latestGasDates.map((date) => minutesBetween(date, now))) : Infinity;

  const checks = [
    {
      label: "shadow time window",
      ok: shadowHours >= targets.minShadowHours,
      detail: `${shadowHours.toFixed(2)}h observed, target ${targets.minShadowHours}h`,
    },
    {
      label: "BOB-neighbor route coverage",
      ok: bobNeighborCoveragePct >= targets.minBobNeighborCoveragePct,
      detail: `${activeBobNeighborRouteKeys.size}/${bobNeighborRouteKeys.size} routes (${bobNeighborCoveragePct.toFixed(1)}%), target ${targets.minBobNeighborCoveragePct}%`,
    },
    {
      label: "candidate sample depth",
      ok: candidateRoutes.length > 0,
      detail: `${candidateRoutes.length} routes have >= ${targets.minSamplesPerCandidateRoute} samples`,
    },
    {
      label: "candidate amount diversity",
      ok: candidateRoutes.length > 0 && candidateAmountFailures.length === 0,
      detail: `${candidateAmountFailures.length} candidate routes have < ${targets.minAmountLevelsPerCandidateRoute} amount levels`,
    },
    {
      label: "time bucket diversity",
      ok: hourBuckets.size >= targets.minHourBuckets,
      detail: `${hourBuckets.size} hourly buckets, target ${targets.minHourBuckets}`,
    },
    {
      label: "failure rate",
      ok: failureRatePct <= targets.maxFailureRatePct,
      detail: `${failureRatePct.toFixed(1)}%, target <= ${targets.maxFailureRatePct}%`,
    },
    {
      label: "fresh gas snapshots",
      ok: maxGasAgeMinutes <= targets.maxGasSnapshotAgeMinutes,
      detail: `${Number.isFinite(maxGasAgeMinutes) ? maxGasAgeMinutes.toFixed(1) : "n/a"}m old, target <= ${targets.maxGasSnapshotAgeMinutes}m`,
    },
  ];

  const warnings = [
    {
      label: "global route coverage",
      ok: routeCoveragePct >= targets.minGlobalRouteCoveragePctForDiscovery,
      detail: `${activeQuoteRouteKeys.size}/${totalGatewayRoutes} routes (${routeCoveragePct.toFixed(1)}%), discovery target ${targets.minGlobalRouteCoveragePctForDiscovery}%`,
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
  ];

  const liveBlocked = checks.some((check) => !check.ok);
  const shadowAllowed = activeQuotes.length > 0 && totalGatewayRoutes > 0;

  return {
    decision: liveBlocked ? "LIVE_BLOCKED" : "LIVE_CANARY_REVIEW_POSSIBLE",
    shadow: shadowAllowed ? "ALLOWED" : "BLOCKED",
    firstObservedAt,
    lastObservedAt,
    quotes: quotes.length,
    activeQuotes: activeQuotes.length,
    validQuotes: validQuotes.length,
    failures: failures.length,
    cloudflareFailures,
    gasSnapshots: gasSnapshots.length,
    gasFailures: gasFailures.length,
    shadowHours,
    totalGatewayRoutes,
    sampledRoutes: activeQuoteRouteKeys.size,
    bobNeighborRoutes: bobNeighborRouteKeys.size,
    sampledBobNeighborRoutes: activeBobNeighborRouteKeys.size,
    checks,
    warnings,
    topSampledRoutes: [...quoteGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([key, routeQuotes]) => ({
        routeKey: key,
        samples: routeQuotes.length,
        amountLevels: new Set(routeQuotes.map((quote) => quote.amount)).size,
      })),
  };
}

export function formatAudit(audit) {
  const lines = [];
  lines.push("# Overfit Audit");
  lines.push("");
  lines.push(`decision=${audit.decision}`);
  lines.push(`shadow=${audit.shadow}`);
  lines.push(`firstObservedAt=${audit.firstObservedAt || "n/a"}`);
  lines.push(`lastObservedAt=${audit.lastObservedAt || "n/a"}`);
  lines.push(`quotes=${audit.quotes} activeQuotes=${audit.activeQuotes} validQuotes=${audit.validQuotes} failures=${audit.failures}`);
  lines.push(`cloudflareFailures=${audit.cloudflareFailures}`);
  lines.push(`gasSnapshots=${audit.gasSnapshots} gasFailures=${audit.gasFailures}`);
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

