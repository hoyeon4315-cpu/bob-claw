function normalized(value) {
  return String(value || "").toLowerCase();
}

export function buildNextReadinessCheckArgs(shadowCycle, address = null) {
  const nextCheck = shadowCycle?.canary?.nextReadinessCheck;
  if (!nextCheck?.routeKey || !nextCheck?.amount) return null;
  return [
    `--route-key=${nextCheck.routeKey}`,
    `--amount=${nextCheck.amount}`,
    ...(address ? [`--address=${address}`] : []),
  ];
}

export function planNextReadinessRefresh(
  { shadowCycle, readinessRecords = [], readinessFailures = [], address = null },
  options = {},
) {
  const args = buildNextReadinessCheckArgs(shadowCycle, address);
  const nextCheck = shadowCycle?.canary?.nextReadinessCheck || null;
  if (!args || !nextCheck) {
    return {
      shouldRefresh: false,
      reason: "no_next_readiness_check",
      args: null,
      latestObservedAt: null,
      ageMs: null,
    };
  }

  const nowMs = options.now instanceof Date ? options.now.getTime() : new Date(options.now || Date.now()).getTime();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs >= 0 ? options.maxAgeMs : 300_000;
  const matchingItems = [...readinessRecords, ...readinessFailures]
    .filter((item) => item.routeKey === nextCheck.routeKey && String(item.amount || "") === String(nextCheck.amount || ""))
    .filter((item) => !address || normalized(item.address) === normalized(address))
    .sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0));
  const latest = matchingItems[0] || null;

  if (!latest?.observedAt) {
    return {
      shouldRefresh: true,
      reason: "never_checked",
      args,
      latestObservedAt: null,
      ageMs: null,
    };
  }

  const ageMs = nowMs - new Date(latest.observedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
    return {
      shouldRefresh: true,
      reason: "stale_check",
      args,
      latestObservedAt: latest.observedAt,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
    };
  }

  return {
    shouldRefresh: false,
    reason: "fresh_recent_check",
    args,
    latestObservedAt: latest.observedAt,
    ageMs,
  };
}
