import { buildDefaultRiskPolicy } from "../../risk/policy.mjs";

function recordKey(record = {}) {
  return record.intentId || record.intentHash || `${record.strategyId || "unknown"}:${record.chain || "unknown"}`;
}

function recordTimestamp(record = {}) {
  return new Date(record.timestamp || record.observedAt || 0).getTime();
}

function terminalOutcome(record = {}) {
  const stage = record.lifecycle?.stage || null;
  if (["rejected", "reverted", "error"].includes(stage)) return "failure";
  if (["confirmed"].includes(stage)) return "success";
  if (record.policyVerdict === "rejected" || record.policyVerdict === "errored") return "failure";
  return null;
}

function latestTerminalRecords(auditRecords = [], strategyId = null) {
  const grouped = new Map();
  for (const record of auditRecords.filter((item) => item?.strategyId === strategyId)) {
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
} = {}) {
  const terminalRecords = latestTerminalRecords(auditRecords, strategyId);
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
  };
}

export function evaluateConsecutiveFailures({
  intent = {},
  auditRecords = [],
  maxConsecutiveFailures = buildDefaultRiskPolicy().maxConsecutiveFailures,
  now = new Date().toISOString(),
} = {}) {
  const state = buildConsecutiveFailureState({
    strategyId: intent.strategyId,
    auditRecords,
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
    },
  };
}
