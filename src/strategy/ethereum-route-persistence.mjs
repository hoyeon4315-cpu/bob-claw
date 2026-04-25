import { isEthFamilyRoute, tokenAsset } from "../assets/tokens.mjs";

const DEFAULT_OPTIONS = {
  recentSnapshotCount: 10,
  stableRoutePresencePct: 80,
  emergingHours: 48,
  fadingHours: 48,
};

function parseRouteKey(routeKey) {
  const [left, right] = String(routeKey || "").split("->");
  const [srcChain, srcToken] = String(left || "").split(":");
  const [dstChain, dstToken] = String(right || "").split(":");
  if (!srcChain || !srcToken || !dstChain || !dstToken) return null;
  return { srcChain, srcToken, dstChain, dstToken };
}

function routeFromValue(value) {
  if (value?.route) return value.route;
  if (value?.srcChain && value?.dstChain && value?.srcToken && value?.dstToken) {
    return {
      srcChain: value.srcChain,
      srcToken: value.srcToken,
      dstChain: value.dstChain,
      dstToken: value.dstToken,
    };
  }
  if (value?.routeKey) return parseRouteKey(value.routeKey);
  if (value?.gatewayRouteKey) return parseRouteKey(value.gatewayRouteKey);
  return null;
}

function routeKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

function routeLabel(route) {
  if (!route) return null;
  const src = tokenAsset(route.srcChain, route.srcToken);
  const dst = tokenAsset(route.dstChain, route.dstToken);
  return `${route.srcChain}->${route.dstChain} ${src.ticker}->${dst.ticker}`;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function hourBucket(observedAt) {
  if (!observedAt) return null;
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 13);
}

function hoursBetween(start, end) {
  const startMs = new Date(start || 0).getTime();
  const endMs = new Date(end || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs <= 0 || endMs <= 0) return null;
  return (endMs - startMs) / 3_600_000;
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  if (finite.length % 2 === 1) return finite[middle];
  return (finite[middle - 1] + finite[middle]) / 2;
}

function lifecycleFor(entry, latestObservedAt, options) {
  const ageHours = hoursBetween(entry.firstSeenAt, latestObservedAt);
  const staleHours = hoursBetween(entry.lastSeenAt, latestObservedAt);

  if (entry.current && Number.isFinite(ageHours) && ageHours <= options.emergingHours) return "emerging";
  if (
    entry.current &&
    entry.presencePct >= options.stableRoutePresencePct &&
    entry.recentPresencePct >= options.stableRoutePresencePct
  ) {
    return "stable";
  }
  if (!entry.current && Number.isFinite(staleHours) && staleHours <= options.fadingHours) return "fading";
  if (!entry.current) return "retired";
  return "intermittent";
}

function lifecycleRank(lifecycle) {
  switch (lifecycle) {
    case "stable":
      return 0;
    case "emerging":
      return 1;
    case "intermittent":
      return 2;
    case "fading":
      return 3;
    default:
      return 4;
  }
}

export function buildEthereumRoutePersistenceSummary(
  { routeRecords = [], quotes = [], shadowObservations = [] } = {},
  options = {},
) {
  const effectiveOptions = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const snapshots = (routeRecords || [])
    .filter((record) => record?.observedAt)
    .map((record) => ({
      observedAt: record.observedAt,
      routes: (record.routes || []).filter(isEthFamilyRoute),
    }));
  const latestObservedAt = snapshots.at(-1)?.observedAt || null;
  const currentRouteKeys = new Set((snapshots.at(-1)?.routes || []).map(routeKey));
  const routeEntries = new Map();

  snapshots.forEach((snapshot, index) => {
    const seenThisSnapshot = new Set();
    for (const route of snapshot.routes) {
      const key = routeKey(route);
      if (seenThisSnapshot.has(key)) continue;
      seenThisSnapshot.add(key);

      const existing = routeEntries.get(key) || {
        routeKey: key,
        label: routeLabel(route),
        srcChain: route.srcChain,
        dstChain: route.dstChain,
        firstSeenAt: snapshot.observedAt,
        lastSeenAt: snapshot.observedAt,
        snapshotsSeen: 0,
        snapshotIndexes: [],
      };

      existing.lastSeenAt = snapshot.observedAt;
      existing.snapshotsSeen += 1;
      existing.snapshotIndexes.push(index);
      routeEntries.set(key, existing);
    }
  });

  const filteredShadowObservations = (shadowObservations || []).filter((item) => {
    const route = routeFromValue(item);
    return route && isEthFamilyRoute(route);
  });
  const filteredQuotes = (quotes || []).filter((item) => {
    const route = routeFromValue(item);
    return route && isEthFamilyRoute(route);
  });
  const sampleItems = filteredShadowObservations.length > 0 ? filteredShadowObservations : filteredQuotes;
  const sampleSource =
    filteredShadowObservations.length > 0 ? "shadow_observations" : filteredQuotes.length > 0 ? "quotes" : "none";
  const sampleStats = new Map();
  const sampleHourBuckets = new Set();

  for (const item of sampleItems) {
    const route = routeFromValue(item);
    if (!route || !isEthFamilyRoute(route)) continue;
    const key = routeKey(route);
    const existing = sampleStats.get(key) || {
      sampleCount: 0,
      amounts: new Set(),
      hourBuckets: new Set(),
      firstSampleAt: null,
      lastSampleAt: null,
    };

    existing.sampleCount += 1;
    if (item?.amount) existing.amounts.add(String(item.amount));
    const bucket = hourBucket(item.observedAt);
    if (bucket) {
      existing.hourBuckets.add(bucket);
      sampleHourBuckets.add(bucket);
    }
    if (!existing.firstSampleAt || new Date(item.observedAt || 0) < new Date(existing.firstSampleAt || 0)) {
      existing.firstSampleAt = item.observedAt || existing.firstSampleAt;
    }
    if (!existing.lastSampleAt || new Date(item.observedAt || 0) > new Date(existing.lastSampleAt || 0)) {
      existing.lastSampleAt = item.observedAt || existing.lastSampleAt;
    }
    sampleStats.set(key, existing);

    if (!routeEntries.has(key)) {
      routeEntries.set(key, {
        routeKey: key,
        label: routeLabel(route),
        srcChain: route.srcChain,
        dstChain: route.dstChain,
        firstSeenAt: item.observedAt || null,
        lastSeenAt: item.observedAt || null,
        snapshotsSeen: 0,
        snapshotIndexes: [],
      });
    }
  }

  const recentSnapshots = snapshots.slice(-effectiveOptions.recentSnapshotCount);
  const recentSnapshotRouteKeys = recentSnapshots.map((snapshot) => new Set(snapshot.routes.map(routeKey)));
  const routes = [...routeEntries.values()]
    .map((entry) => {
      const recentSeenCount = recentSnapshotRouteKeys.filter((keys) => keys.has(entry.routeKey)).length;
      const sample = sampleStats.get(entry.routeKey);
      const route = parseRouteKey(entry.routeKey);
      const presencePct = pct(entry.snapshotsSeen, snapshots.length);
      const recentPresencePct = pct(recentSeenCount, recentSnapshots.length);
      const current = currentRouteKeys.has(entry.routeKey);
      const amountLevels = sample?.amounts?.size || 0;
      const hourBuckets = sample?.hourBuckets?.size || 0;
      const routeEntry = {
        routeKey: entry.routeKey,
        label: entry.label || routeLabel(route),
        srcChain: entry.srcChain || route?.srcChain || null,
        dstChain: entry.dstChain || route?.dstChain || null,
        firstSeenAt: entry.firstSeenAt || null,
        lastSeenAt: entry.lastSeenAt || null,
        current,
        snapshotsSeen: entry.snapshotsSeen,
        presencePct,
        recentPresencePct,
        sampleCount: sample?.sampleCount || 0,
        amountLevels,
        hourBuckets,
        firstSampleAt: sample?.firstSampleAt || null,
        lastSampleAt: sample?.lastSampleAt || null,
      };

      routeEntry.persistence = lifecycleFor(routeEntry, latestObservedAt || routeEntry.lastSeenAt, effectiveOptions);
      routeEntry.ageHours = hoursBetween(routeEntry.firstSeenAt, latestObservedAt || routeEntry.lastSeenAt);
      routeEntry.hoursSinceLastSeen = hoursBetween(routeEntry.lastSeenAt, latestObservedAt || routeEntry.lastSeenAt);
      return routeEntry;
    })
    .sort(
      (left, right) =>
        Number(right.current) - Number(left.current) ||
        lifecycleRank(left.persistence) - lifecycleRank(right.persistence) ||
        right.presencePct - left.presencePct ||
        right.sampleCount - left.sampleCount ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    );

  const amountLevels = routes.map((item) => item.amountLevels).filter(Number.isFinite);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    latestObservedAt,
    snapshotCount: snapshots.length,
    currentRouteCount: routes.filter((item) => item.current).length,
    routesEverSeen: routes.length,
    stableRouteCount: routes.filter((item) => item.current && item.persistence === "stable").length,
    emergingRouteCount: routes.filter((item) => item.current && item.persistence === "emerging").length,
    intermittentRouteCount: routes.filter((item) => item.current && item.persistence === "intermittent").length,
    fadingRouteCount: routes.filter((item) => item.persistence === "fading").length,
    retiredRouteCount: routes.filter((item) => item.persistence === "retired").length,
    sampledRouteCount: routes.filter((item) => item.sampleCount > 0).length,
    currentSampledRouteCount: routes.filter((item) => item.current && item.sampleCount > 0).length,
    stableSampledRouteCount: routes.filter((item) => item.current && item.persistence === "stable" && item.sampleCount > 0).length,
    sampleSource,
    sampleCount: sampleItems.length,
    sampleHourBucketCount: sampleHourBuckets.size,
    maxAmountLevelsPerRoute: amountLevels.length ? Math.max(...amountLevels) : 0,
    medianAmountLevelsPerRoute: median(amountLevels),
    routes,
  };
}
