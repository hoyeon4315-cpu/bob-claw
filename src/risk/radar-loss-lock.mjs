function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function realizedAt(record = {}) {
  return record.settledAt || record.observedAt || record.timestamp || null;
}

function withinLast24h(record = {}, now) {
  const timestamp = realizedAt(record);
  if (!timestamp) return false;
  const ageMs = new Date(now).getTime() - new Date(timestamp).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 86_400_000;
}

export function resolveRadarLockPath(env = process.env) {
  return env?.RADAR_LOCK_PATH || "~/.bob-claw/RADAR_LOCK";
}

export function evaluateRadarLossLock({
  realizationRecords = [],
  now = new Date().toISOString(),
  thresholdUsd = 25,
  lockPath = null,
  env = process.env,
} = {}) {
  const threshold = Number(thresholdUsd);
  const loss24hUsd = (realizationRecords || [])
    .filter((record) => record?.lifecycle?.strategyRealized === true)
    .filter((record) => withinLast24h(record, now))
    .reduce((total, record) => {
      const pnl = finiteNumber(record.netRealizedPnlUsd);
      return pnl !== null && pnl < 0 ? total + Math.abs(pnl) : total;
    }, 0);

  return {
    evaluatedAt: now,
    tripped: loss24hUsd > threshold,
    loss24hUsd,
    thresholdUsd: threshold,
    lockPath: lockPath || resolveRadarLockPath(env),
  };
}
