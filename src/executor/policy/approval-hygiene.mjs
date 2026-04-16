function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function evaluateApprovalHygiene({
  intent = {},
  maxApprovalTtlMs = 3_600_000,
  now = new Date().toISOString(),
} = {}) {
  const approval = intent.approval || null;
  const blockers = [];
  const warnings = [];

  if (!approval) {
    return {
      policy: "approval_hygiene",
      observedAt: now,
      decision: "ALLOW",
      blockers,
      warnings,
    };
  }

  if (!approval.token || !approval.spender) {
    blockers.push("approval_target_missing");
  }
  if (approval.isUnlimited === true || approval.amount === "max" || approval.mode === "unlimited") {
    blockers.push("unlimited_approval_forbidden");
  }
  if (approval.mode === "permit2" || approval.mode === "per_tx") {
    if (!(BigInt(approval.amount ?? 0) > 0n)) {
      blockers.push("approval_exact_amount_missing");
    }
  } else if (approval.mode === "time_boxed") {
    const expiresAt = approval.expiresAt ? new Date(approval.expiresAt).getTime() : null;
    const ttlMs = isFiniteNumber(expiresAt) ? expiresAt - new Date(now).getTime() : null;
    if (!isFiniteNumber(ttlMs) || ttlMs <= 0) {
      blockers.push("approval_expiry_missing_or_invalid");
    } else if (ttlMs > maxApprovalTtlMs) {
      blockers.push("approval_ttl_exceeds_policy");
    }
    if (approval.revokeWhenIdle !== true) {
      blockers.push("approval_idle_revoke_missing");
    }
  } else {
    warnings.push("approval_mode_unrecognized");
  }

  return {
    policy: "approval_hygiene",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers: unique(blockers),
    warnings: unique(warnings),
  };
}
