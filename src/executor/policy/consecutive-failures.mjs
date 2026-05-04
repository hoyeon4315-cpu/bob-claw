import { buildDefaultRiskPolicy } from "../../risk/policy.mjs";

const DEFAULT_RECENT_FAILURE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const CONSECUTIVE_FAILURE_RESET_INTENT_TYPE = "operator_reset_consecutive_failures";
export const CONSECUTIVE_FAILURE_RESET_STAGE = "consecutive_failures_reset";

function normalizeChain(chain = null) {
  return typeof chain === "string" && chain.length > 0 ? chain : null;
}

function recordChain(record = {}) {
  return normalizeChain(record.chain || record.intent?.chain || null);
}

function isResetRecord(record = {}) {
  return (
    record.intent?.intentType === CONSECUTIVE_FAILURE_RESET_INTENT_TYPE ||
    record.lifecycle?.stage === CONSECUTIVE_FAILURE_RESET_STAGE
  );
}

function recordKey(record = {}) {
  if (isResetRecord(record)) {
    return `reset:${record.strategyId || "unknown"}:${recordChain(record) || "*"}:${record.timestamp || record.observedAt || "0"}`;
  }
  // Use intentHash first (unique per broadcast attempt) so retries of the same
  // sub-step are tracked separately. intentId would collapse retries and hide
  // repeated failures of the same sub-step.
  return record.intentHash || record.intentId || `${record.strategyId || "unknown"}:${recordChain(record) || "unknown"}`;
}

function recordTimestamp(record = {}) {
  return new Date(record.timestamp || record.observedAt || 0).getTime();
}

function resumeAfterTimestamp(resumeAfter = null) {
  if (!resumeAfter) return null;
  const timestamp = new Date(resumeAfter).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isApprovalRevocationIntent(intent = {}) {
  if (intent.intentType !== "approve_exact") return false;
  if (!intent.approval) return false;
  try {
    return BigInt(intent.approval.amount ?? -1) === 0n;
  } catch {
    return false;
  }
}

function recordBlockers(record = {}) {
  const candidates = [
    record.blockers,
    record.policyBlockers,
    record.lifecycle?.blockers,
    record.policy?.blockers,
  ];
  return [
    ...new Set(
      candidates
        .filter(Array.isArray)
        .flat()
        .filter((item) => typeof item === "string" && item.length > 0),
    ),
  ];
}

function matchesStrategyChain(record = {}, strategyId = null, chain = null) {
  if (!strategyId || record?.strategyId !== strategyId) return false;
  const normalizedChain = normalizeChain(chain);
  if (normalizedChain === null) return true;
  const candidateChain = recordChain(record);
  return candidateChain === normalizedChain || (isResetRecord(record) && candidateChain === null);
}

function hasBroadcastEvidence(record = {}) {
  return (
    Boolean(record.broadcast) ||
    ["broadcasted", "confirmed", "reverted"].includes(record.lifecycle?.stage || null)
  );
}

export function classifyConsecutiveFailureRecord(record = {}) {
  const stage = record.lifecycle?.stage || null;
  const broadcasted = hasBroadcastEvidence(record);

  if (isResetRecord(record)) return "reset";
  if (record.strategyId === "prelive_fork_execution" && stage === "rejected" && !broadcasted) {
    return null;
  }

  if (stage === "broadcasted" || stage === "confirmed") return "broadcastSucceeded";
  if (stage === "reverted") return "broadcastFailed";
  if (stage === "rejected") return broadcasted ? "broadcastFailed" : "policyRejected";
  if (stage === "error") return broadcasted ? "broadcastFailed" : "noTxFailure";

  if (record.policyVerdict === "approved" && broadcasted) return "broadcastSucceeded";
  if (record.policyVerdict === "rejected") return broadcasted ? "broadcastFailed" : "policyRejected";
  if (record.policyVerdict === "errored") return broadcasted ? "broadcastFailed" : "noTxFailure";
  return null;
}

export function latestClassifiedRecords(auditRecords = [], { strategyId = null, chain = null, resumeAfter = null } = {}) {
  const resumeAfterMs = resumeAfterTimestamp(resumeAfter);
  const grouped = new Map();
  for (const record of auditRecords.filter((item) => matchesStrategyChain(item, strategyId, chain))) {
    const timestamp = recordTimestamp(record);
    if (resumeAfterMs !== null && timestamp <= resumeAfterMs) continue;
    const classification = classifyConsecutiveFailureRecord(record);
    if (!classification) continue;
    const key = recordKey(record);
    const existing = grouped.get(key);
    if (!existing || recordTimestamp(record) >= recordTimestamp(existing.record)) {
      grouped.set(key, { classification, record });
    }
  }
  return [...grouped.values()]
    .sort((left, right) => recordTimestamp(right.record) - recordTimestamp(left.record))
    .map((item) => ({
      classification: item.classification,
      record: item.record,
    }));
}

export function countConsecutiveBroadcastFailures(sortedClassifiedRecords = []) {
  let count = 0;
  let latestFailureAt = null;
  let boundaryStatus = null;
  let boundaryObservedAt = null;
  for (const item of sortedClassifiedRecords) {
    if (item.classification === "policyRejected" || item.classification === "noTxFailure") continue;
    if (item.classification === "broadcastFailed") {
      count += 1;
      latestFailureAt ||= item.record.timestamp || item.record.observedAt || null;
      continue;
    }
    boundaryStatus = item.classification;
    boundaryObservedAt = item.record.timestamp || item.record.observedAt || null;
    break;
  }
  return {
    count,
    latestFailureAt,
    boundaryStatus,
    boundaryObservedAt,
  };
}

function countRecentBroadcastFailures(auditRecords, strategyId, chain, windowMs, resumeAfterMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  let count = 0;
  for (const record of auditRecords.filter((item) => matchesStrategyChain(item, strategyId, chain))) {
    const timestamp = recordTimestamp(record);
    if (timestamp < cutoff) continue;
    if (resumeAfterMs !== null && timestamp <= resumeAfterMs) continue;
    if (classifyConsecutiveFailureRecord(record) === "broadcastFailed") count += 1;
  }
  return count;
}

export function buildConsecutiveFailureState({
  strategyId,
  chain = null,
  auditRecords = [],
  resumeAfter = null,
  intentId = null,
  recentFailureWindowMs = DEFAULT_RECENT_FAILURE_WINDOW_MS,
} = {}) {
  const resumeAfterMs = resumeAfterTimestamp(resumeAfter);

  // Strategy/chain-level: only broadcast failures count, and any successful
  // broadcast (or explicit operator reset event) clears the streak.
  const strategyClassifiedRecords = latestClassifiedRecords(auditRecords, {
    strategyId,
    chain,
    resumeAfter,
  });
  const strategyFailureWindow = countConsecutiveBroadcastFailures(strategyClassifiedRecords);
  const strategyConsecutiveFailures = strategyFailureWindow.count;

  // Intent-level is retained as a diagnostic metric, but the strategy/chain
  // streak is the only auto-pause counter.
  let intentConsecutiveFailures = 0;
  if (intentId) {
    const intentRecords = [];
    for (const record of auditRecords.filter((item) => matchesStrategyChain(item, strategyId, chain))) {
      const timestamp = recordTimestamp(record);
      if (resumeAfterMs !== null && timestamp <= resumeAfterMs) continue;
      const classification = classifyConsecutiveFailureRecord(record);
      if (!classification) continue;
      if (record.intentId === intentId || record.intentId?.startsWith(intentId)) {
        intentRecords.push({ classification, record });
      }
    }
    const sortedIntentRecords = intentRecords
      .sort((left, right) => recordTimestamp(right.record) - recordTimestamp(left.record));
    intentConsecutiveFailures = countConsecutiveBroadcastFailures(sortedIntentRecords).count;
  }

  const recentFailureCount = countRecentBroadcastFailures(
    auditRecords,
    strategyId,
    chain,
    recentFailureWindowMs,
    resumeAfterMs,
  );

  const classifiedCounts = strategyClassifiedRecords.reduce(
    (counts, item) => {
      counts[item.classification] = (counts[item.classification] || 0) + 1;
      return counts;
    },
    {
      broadcastFailed: 0,
      broadcastSucceeded: 0,
      policyRejected: 0,
      noTxFailure: 0,
      reset: 0,
    },
  );

  return {
    strategyId,
    chain: normalizeChain(chain),
    intentId,
    consecutiveFailures: strategyConsecutiveFailures,
    strategyConsecutiveFailures,
    intentConsecutiveFailures,
    recentFailureCount,
    terminalRecordCount: strategyClassifiedRecords.filter((item) =>
      ["broadcastFailed", "broadcastSucceeded", "reset"].includes(item.classification)
    ).length,
    lastTerminalStatus: strategyClassifiedRecords[0]?.classification || null,
    latestFailureAt: strategyFailureWindow.latestFailureAt,
    lastResetAt:
      strategyClassifiedRecords.find((item) => item.classification === "reset")?.record?.timestamp ||
      strategyClassifiedRecords.find((item) => item.classification === "reset")?.record?.observedAt ||
      null,
    broadcastFailureCount: classifiedCounts.broadcastFailed,
    successfulBroadcastCount: classifiedCounts.broadcastSucceeded,
    policyRejectedCount: classifiedCounts.policyRejected,
    noTxFailureCount: classifiedCounts.noTxFailure,
    resetCount: classifiedCounts.reset,
    resumeAfter,
  };
}

export function evaluateConsecutiveFailures({
  intent = {},
  auditRecords = [],
  maxConsecutiveFailures = buildDefaultRiskPolicy().maxConsecutiveFailures,
  resumeAfter = null,
  now = new Date().toISOString(),
} = {}) {
  if (isApprovalRevocationIntent(intent)) {
    return {
      policy: "consecutive_failures",
      observedAt: now,
      decision: "ALLOW",
      blockers: [],
      metrics: {
        maxConsecutiveFailures,
        consecutiveFailures: 0,
        terminalRecordCount: 0,
        lastTerminalStatus: null,
        latestFailureAt: null,
        resumeAfter,
        bypassReason: "approval_revocation",
      },
    };
  }
  const state = buildConsecutiveFailureState({
    strategyId: intent.strategyId,
    chain: intent.chain || null,
    auditRecords,
    resumeAfter,
    intentId: intent.intentId || null,
  });
  const blockers =
    Number.isFinite(maxConsecutiveFailures) && state.consecutiveFailures >= maxConsecutiveFailures
      ? ["max_consecutive_failures_reached"]
      : [];
  return {
    policy: "consecutive_failures",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    metrics: {
      chain: state.chain,
      maxConsecutiveFailures,
      consecutiveFailures: state.consecutiveFailures,
      strategyConsecutiveFailures: state.strategyConsecutiveFailures,
      intentConsecutiveFailures: state.intentConsecutiveFailures,
      recentFailureCount: state.recentFailureCount,
      terminalRecordCount: state.terminalRecordCount,
      lastTerminalStatus: state.lastTerminalStatus,
      latestFailureAt: state.latestFailureAt,
      lastResetAt: state.lastResetAt,
      broadcastFailureCount: state.broadcastFailureCount,
      successfulBroadcastCount: state.successfulBroadcastCount,
      policyRejectedCount: state.policyRejectedCount,
      noTxFailureCount: state.noTxFailureCount,
      resetCount: state.resetCount,
      resumeAfter: state.resumeAfter,
    },
  };
}
