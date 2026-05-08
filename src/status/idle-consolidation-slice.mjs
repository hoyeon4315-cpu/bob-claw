import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";

const DEFAULT_WINDOW_DAYS = 7;
const IDLE_STAGE = "idle_consolidation_planned";

function timestampMs(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isoOrNull(value) {
  const parsed = timestampMs(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function finiteUsd(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundUsd(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function observedAt(record = {}) {
  return record.timestamp || record.observedAt || record.lifecycle?.observedAt || null;
}

function isIdlePlan(record = {}) {
  return record.lifecycle?.stage === IDLE_STAGE;
}

function isKillSwitchBlocked(record = {}) {
  const blockers = new Set([
    ...(Array.isArray(record.blockers) ? record.blockers : []),
    ...(Array.isArray(record.lifecycle?.blockers) ? record.lifecycle.blockers : []),
  ]);
  return blockers.has("kill_switch_present");
}

function recordUsd(record = {}) {
  return finiteUsd(record.lifecycle?.candidate?.estimatedUsd) ||
    finiteUsd(record.lifecycle?.candidate?.sourceUsd) ||
    finiteUsd(record.amountUsd);
}

function sortByObservedAt(records = []) {
  return [...records].sort((left, right) =>
    (timestampMs(observedAt(left)) || 0) - (timestampMs(observedAt(right)) || 0)
  );
}

function lastPlanGroup(plans = []) {
  const latest = sortByObservedAt(plans).at(-1);
  if (!latest) return [];
  const latestRunId = latest.lifecycle?.autopilotRunId || null;
  const latestAt = isoOrNull(observedAt(latest));
  return plans.filter((record) => {
    if (latestRunId) return record.lifecycle?.autopilotRunId === latestRunId;
    return isoOrNull(observedAt(record)) === latestAt;
  });
}

export function buildIdleConsolidationSlice({
  auditRecords = [],
  now = new Date().toISOString(),
  windowDays = DEFAULT_WINDOW_DAYS,
} = {}) {
  const nowMs = timestampMs(now) || Date.now();
  const windowMs = Math.max(0, Number(windowDays) || DEFAULT_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const windowStartMs = nowMs - windowMs;
  const recent = (auditRecords || []).filter((record) => {
    const ms = timestampMs(observedAt(record));
    return Number.isFinite(ms) && ms >= windowStartMs && ms <= nowMs;
  });
  const plans = recent.filter(isIdlePlan);
  const killSwitchBlocked = recent.filter(isKillSwitchBlocked);
  const lastPlans = lastPlanGroup(plans);
  const lastPlanAt = isoOrNull(observedAt(sortByObservedAt(lastPlans).at(-1)));
  const lastKillSwitchBlockedAt = isoOrNull(observedAt(sortByObservedAt(killSwitchBlocked).at(-1)));
  const lastPlanChains = [...new Set(lastPlans.map((record) => record.lifecycle?.candidate?.srcChain || record.chain).filter(Boolean))].sort();
  const aggregateUsd7d = plans.reduce((sum, record) => sum + recordUsd(record), 0);
  const lastPlanAggregateUsd = lastPlans.reduce((sum, record) => sum + recordUsd(record), 0);

  return {
    schemaVersion: 1,
    generatedAt: now,
    windowDays,
    windowStartAt: new Date(windowStartMs).toISOString(),
    status: plans.length > 0
      ? "planned_recent"
      : killSwitchBlocked.length > 0
        ? "blocked_by_kill_switch_recently"
        : "no_recent_plan",
    stage: IDLE_STAGE,
    plannedCount7d: plans.length,
    aggregateUsd7d: roundUsd(aggregateUsd7d),
    lastPlannedAt: lastPlanAt,
    lastPlanCandidateCount: lastPlans.length,
    lastPlanAggregateUsd: roundUsd(lastPlanAggregateUsd),
    lastPlanChains,
    killSwitchBlockedCount7d: killSwitchBlocked.length,
    lastKillSwitchBlockedAt,
  };
}

export async function buildIdleConsolidationSliceFromAudit({
  rootDir = process.cwd(),
  now = new Date().toISOString(),
  windowDays = DEFAULT_WINDOW_DAYS,
} = {}) {
  const auditRecords = await readSignerAuditLog({ rootDir });
  return buildIdleConsolidationSlice({ auditRecords, now, windowDays });
}
