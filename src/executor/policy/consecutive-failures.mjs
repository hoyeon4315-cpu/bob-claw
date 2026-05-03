import { buildDefaultRiskPolicy } from "../../risk/policy.mjs";

const DEFAULT_RECENT_FAILURE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const NON_STRATEGY_FAILURE_POLICY_BLOCKERS = new Set([
  "kill_switch_present",
  "max_consecutive_failures_reached",
  "strategy_per_chain_cap_exceeded",
  "strategy_per_day_cap_exceeded",
  "strategy_per_tx_cap_exceeded",
  "strategy_per_trade_cap_exceeded",
  "portfolio_chain_cap_exceeded",
  "portfolio_protocol_cap_exceeded",
  "protocol_cap_exceeded",
  "asset_family_cap_exceeded",
  "chain_cap_exceeded",
  "micro_test_cap_exceeded",
  "per_tx_cap_exceeded",
  "cap_exceeded",
  "across_per_tx_cap_exceeded",
  "gas_zip_per_job_cap_exceeded",
]);

function recordKey(record = {}) {
  // Use intentHash first (unique per broadcast attempt) so retries of the same
  // sub-step are tracked separately. intentId would collapse retries and hide
  // repeated failures of the same sub-step.
  return record.intentHash || record.intentId || `${record.strategyId || "unknown"}:${record.chain || "unknown"}`;
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

function isPureNonStrategyFailurePolicyRejection(record = {}) {
  const stage = record.lifecycle?.stage || null;
  const blockers = recordBlockers(record);
  return (
    record.policyVerdict === "rejected" &&
    stage === "rejected" &&
    !record.broadcast &&
    blockers.length > 0 &&
    blockers.every((blocker) => NON_STRATEGY_FAILURE_POLICY_BLOCKERS.has(blocker))
  );
}

function terminalOutcome(record = {}) {
  const stage = record.lifecycle?.stage || null;
  if (record.strategyId === "prelive_fork_execution" && stage === "rejected" && !record.broadcast) {
    return null;
  }
  if (isPureNonStrategyFailurePolicyRejection(record)) return null;
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

function countConsecutiveFailures(sortedTerminalRecords) {
  let count = 0;
  for (const item of sortedTerminalRecords) {
    if (item.outcome !== "failure") break;
    count += 1;
  }
  return count;
}

function countRecentFailures(auditRecords, strategyId, windowMs, resumeAfterMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  let count = 0;
  for (const record of auditRecords.filter((item) => item?.strategyId === strategyId)) {
    const timestamp = recordTimestamp(record);
    if (timestamp < cutoff) continue;
    if (resumeAfterMs !== null && timestamp <= resumeAfterMs) continue;
    const outcome = terminalOutcome(record);
    if (outcome === "failure") count += 1;
  }
  return count;
}

export function buildConsecutiveFailureState({
  strategyId,
  auditRecords = [],
  resumeAfter = null,
  intentId = null,
  recentFailureWindowMs = DEFAULT_RECENT_FAILURE_WINDOW_MS,
} = {}) {
  const resumeAfterMs = resumeAfterTimestamp(resumeAfter);

  // Strategy-level: all terminal records for this strategy
  const strategyTerminalRecords = latestTerminalRecords(auditRecords, strategyId, resumeAfter);
  const strategyConsecutiveFailures = countConsecutiveFailures(strategyTerminalRecords);

  // Intent-level: terminal records for this specific intentId only
  // This catches repeated failures of the same sub-step (e.g., mint-initial-collateral
  // reverting 5 times in a row) even when other sub-steps succeed.
  let intentConsecutiveFailures = 0;
  if (intentId) {
    const intentRecords = [];
    for (const record of auditRecords.filter((item) => item?.strategyId === strategyId)) {
      const timestamp = recordTimestamp(record);
      if (resumeAfterMs !== null && timestamp <= resumeAfterMs) continue;
      const outcome = terminalOutcome(record);
      if (!outcome) continue;
      if (record.intentId === intentId || record.intentId?.startsWith(intentId)) {
        intentRecords.push({ outcome, record });
      }
    }
    const sortedIntentRecords = intentRecords
      .sort((left, right) => recordTimestamp(right.record) - recordTimestamp(left.record));
    intentConsecutiveFailures = countConsecutiveFailures(sortedIntentRecords);
  }

  // Recent-failure guard: total failures in the last hour, regardless of
  // intervening successes. Belt-and-suspenders against strategies that fail
  // sporadically across many different sub-steps.
  const recentFailureCount = countRecentFailures(
    auditRecords,
    strategyId,
    recentFailureWindowMs,
    resumeAfterMs,
  );

  const consecutiveFailures = Math.max(
    strategyConsecutiveFailures,
    intentConsecutiveFailures,
    // Cap recent-failure contribution at the same threshold so it doesn't
    // dominate with large counts from long-running history.
    Math.min(recentFailureCount, 5),
  );

  return {
    strategyId,
    intentId,
    consecutiveFailures,
    strategyConsecutiveFailures,
    intentConsecutiveFailures,
    recentFailureCount,
    terminalRecordCount: strategyTerminalRecords.length,
    lastTerminalStatus: strategyTerminalRecords[0]?.outcome || null,
    latestFailureAt:
      strategyTerminalRecords.find((item) => item.outcome === "failure")?.record?.timestamp ||
      strategyTerminalRecords.find((item) => item.outcome === "failure")?.record?.observedAt ||
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
      maxConsecutiveFailures,
      consecutiveFailures: state.consecutiveFailures,
      terminalRecordCount: state.terminalRecordCount,
      lastTerminalStatus: state.lastTerminalStatus,
      latestFailureAt: state.latestFailureAt,
      resumeAfter: state.resumeAfter,
    },
  };
}
