import { buildDefaultRiskPolicy } from "../../risk/policy.mjs";

function recordKey(record = {}) {
  return record.intentId || record.intentHash || `${record.strategyId || "unknown"}:${record.chain || "unknown"}`;
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

function terminalOutcome(record = {}) {
  const stage = record.lifecycle?.stage || null;
  if (record.strategyId === "prelive_fork_execution" && stage === "rejected" && !record.broadcast) {
    return null;
  }
  if (["rejected", "reverted", "error"].includes(stage)) return "failure";
  if (["confirmed"].includes(stage)) return "success";
  if (record.policyVerdict === "rejected" || record.policyVerdict === "errored") return "failure";
  return null;
}

function latestTerminalRecords(auditRecords = [], strategyId = null, resumeAfter = null) {
  const resumeAfterMs = resumeAfterTimestamp(resumeAfter);
  const grouped = new Map();
  for (const record of auditRecords.filter((item) => item?.strategyId === strategyId)) {
    const timestamp = recordTimestamp(record);
    if (resumeAfterMs !== null && timestamp <= resumeAfterMs) continue;
    const outcome = terminalOutcome(record);
    if (!outcome) continue;
    const key = recordKey(record);
    const existing = grouped.get(key);
    if (!existing || recordTimestamp(record) >= recordTimestamp(existing.record)) {
      grouped.set(key, { outcome, record });
    }
  }
  return [...grouped.values()]
    .sort((left, right) => recordTimestamp(right.record) - recordTimestamp(left.record))
    .map((item) => ({
      outcome: item.outcome,
      record: item.record,
    }));
}

export function buildConsecutiveFailureState({
  strategyId,
  auditRecords = [],
  resumeAfter = null,
} = {}) {
  const terminalRecords = latestTerminalRecords(auditRecords, strategyId, resumeAfter);
  let consecutiveFailures = 0;
  for (const item of terminalRecords) {
    if (item.outcome !== "failure") break;
    consecutiveFailures += 1;
  }
  return {
    strategyId,
    consecutiveFailures,
    terminalRecordCount: terminalRecords.length,
    lastTerminalStatus: terminalRecords[0]?.outcome || null,
    latestFailureAt:
      terminalRecords.find((item) => item.outcome === "failure")?.record?.timestamp ||
      terminalRecords.find((item) => item.outcome === "failure")?.record?.observedAt ||
      null,
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
    auditRecords,
    resumeAfter,
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
      maxConsecutiveFailures,
      consecutiveFailures: state.consecutiveFailures,
      terminalRecordCount: state.terminalRecordCount,
      lastTerminalStatus: state.lastTerminalStatus,
      latestFailureAt: state.latestFailureAt,
      resumeAfter: state.resumeAfter,
    },
  };
}
