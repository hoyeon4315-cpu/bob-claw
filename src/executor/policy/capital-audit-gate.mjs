export function featureEnabled(profile) {
  if (profile === "dev") return false;
  return true;
}

export function evaluateCapitalAuditGate({
  intent = {},
  capitalAuditState = null,
  now = new Date().toISOString(),
} = {}) {
  if (!capitalAuditState || !Array.isArray(capitalAuditState.flaggedStrategies)) {
    return {
      policy: "capital_audit",
      observedAt: now,
      decision: "ALLOW",
      blockers: [],
      metrics: { bypassReason: "feature_disabled_or_no_state" },
    };
  }

  const strategyFlag = capitalAuditState.flaggedStrategies.find(
    (item) => item.strategyId === intent.strategyId,
  );

  if (strategyFlag) {
    return {
      policy: "capital_audit",
      observedAt: now,
      decision: "BLOCK",
      blockers: ["capital_audit_pair_unmatched"],
      metrics: {
        unmatchedCount: strategyFlag.unmatchedCount,
        latestUnmatchedAt: strategyFlag.latestUnmatchedAt,
      },
    };
  }

  return {
    policy: "capital_audit",
    observedAt: now,
    decision: "ALLOW",
    blockers: [],
    metrics: { unmatchedCount: 0 },
  };
}
