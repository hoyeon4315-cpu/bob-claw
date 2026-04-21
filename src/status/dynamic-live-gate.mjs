// Dynamic live-trading gate.
//
// Plan §5b.6 T6. The existing applyLaneAwareLivePolicy checks only
// whether edgeViability.verdict.code === "policy_ready" and promotes
// the lane past hard blockers. That is static: a stale verdict from
// weeks ago would still unlock live trading.
//
// This module adds two dimensions the plan requires:
//   1. horizon — the verdict must have been produced within the last
//      horizonDays (default 14).
//   2. revalidation freshness — the most recent revalidation scheduler
//      tick must have succeeded and be within its own freshness budget
//      (default 12h).
//
// Pure function. Caller supplies the current time, the edge verdict
// record, and the latest revalidation snapshot. Output is a frozen
// record the existing live-policy layer can consume as an additional
// gate (AND-combined with applyLaneAwareLivePolicy's own decision).

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_HORIZON_DAYS = 14;
const DEFAULT_REVALIDATION_MAX_AGE_MS = 12 * HOUR_MS;
const DEFAULT_MIN_SHADOW_OBSERVATIONS = 8;

function parseTs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

function verdictCode(edgeViability) {
  return edgeViability?.verdict?.code ?? null;
}

function verdictObservedAt(edgeViability) {
  return (
    edgeViability?.verdict?.observedAt ??
    edgeViability?.observedAt ??
    edgeViability?.verdict?.evaluatedAt ??
    edgeViability?.evaluatedAt ??
    null
  );
}

function shadowObservationCount(edgeViability) {
  const n =
    edgeViability?.shadowObservationCount ??
    edgeViability?.measuredLoopCount ??
    edgeViability?.policyReadyCount ??
    0;
  return Number.isFinite(n) ? n : 0;
}

export function evaluateDynamicLiveGate({
  edgeViability = null,
  revalidationSnapshot = null,
  now = new Date().toISOString(),
  horizonDays = DEFAULT_HORIZON_DAYS,
  revalidationMaxAgeMs = DEFAULT_REVALIDATION_MAX_AGE_MS,
  minShadowObservations = DEFAULT_MIN_SHADOW_OBSERVATIONS,
} = {}) {
  const nowMs = parseTs(now);
  if (nowMs == null) {
    throw new TypeError("now must be a valid timestamp");
  }
  if (!Number.isFinite(horizonDays) || horizonDays <= 0) {
    throw new TypeError("horizonDays must be a positive finite number");
  }

  const blockers = [];
  const warnings = [];

  const code = verdictCode(edgeViability);
  if (code !== "policy_ready") {
    blockers.push({
      kind: "verdict_not_policy_ready",
      detail: code
        ? `current verdict=${code}`
        : "no verdict supplied",
    });
  }

  const verdictTs = parseTs(verdictObservedAt(edgeViability));
  const verdictAgeMs = verdictTs == null ? null : nowMs - verdictTs;
  const horizonMs = horizonDays * DAY_MS;
  const verdictWithinHorizon = verdictAgeMs != null && verdictAgeMs >= 0 && verdictAgeMs <= horizonMs;

  if (verdictAgeMs == null) {
    blockers.push({
      kind: "verdict_timestamp_missing",
      detail: "edgeViability.verdict.observedAt (or fallback) is required for horizon enforcement",
    });
  } else if (verdictAgeMs < 0) {
    warnings.push({
      kind: "verdict_timestamp_skewed",
      detail: `verdict ${Math.abs(verdictAgeMs)}ms in the future; treating as fresh`,
    });
  } else if (verdictAgeMs > horizonMs) {
    blockers.push({
      kind: "verdict_outside_horizon",
      detail: `verdict is ${Math.round(verdictAgeMs / DAY_MS)}d old; horizon is ${horizonDays}d`,
    });
  }

  const shadowN = shadowObservationCount(edgeViability);
  if (shadowN < minShadowObservations) {
    blockers.push({
      kind: "insufficient_shadow_observations",
      detail: `${shadowN}/${minShadowObservations} shadow observations`,
    });
  }

  const lastRevalTs = parseTs(revalidationSnapshot?.lastTickAt);
  const revalAgeMs = lastRevalTs == null ? null : nowMs - lastRevalTs;
  if (revalAgeMs == null) {
    blockers.push({
      kind: "revalidation_never_ran",
      detail: "no revalidation snapshot supplied",
    });
  } else if (revalAgeMs > revalidationMaxAgeMs) {
    blockers.push({
      kind: "revalidation_stale",
      detail: `last revalidation ${Math.round(revalAgeMs / HOUR_MS)}h ago; budget ${Math.round(revalidationMaxAgeMs / HOUR_MS)}h`,
    });
  }

  const consecutiveFailures = Number(revalidationSnapshot?.consecutiveFailures || 0);
  if (consecutiveFailures >= 3) {
    blockers.push({
      kind: "revalidation_failing",
      detail: `revalidation consecutiveFailures=${consecutiveFailures}`,
    });
  } else if (consecutiveFailures > 0) {
    warnings.push({
      kind: "revalidation_partial_failure",
      detail: `revalidation consecutiveFailures=${consecutiveFailures}`,
    });
  }

  const gated = blockers.length > 0;
  const action = gated ? "block_live" : "allow_live";

  return Object.freeze({
    schemaVersion: 1,
    observedAt: now,
    gated,
    action,
    liveTradingHint: gated ? "BLOCKED" : "ALLOWED",
    verdictCode: code,
    verdictAgeMs,
    verdictWithinHorizon,
    horizonDays,
    revalidationAgeMs: revalAgeMs,
    revalidationMaxAgeMs,
    shadowObservationCount: shadowN,
    minShadowObservations,
    consecutiveFailures,
    blockers: Object.freeze(blockers.map((b) => Object.freeze(b))),
    warnings: Object.freeze(warnings.map((w) => Object.freeze(w))),
  });
}
