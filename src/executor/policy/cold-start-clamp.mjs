export const COLD_START_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateColdStartClamp({
  strategy = {},
  signerAuditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const firstAutoExecuteAt = strategy?.firstAutoExecuteAt ?? null;
  if (!firstAutoExecuteAt) return { clamp: 1.0, reason: null, signerAuditRecordCount: signerAuditRecords.length };
  const ageMs = new Date(now).getTime() - new Date(firstAutoExecuteAt).getTime();
  if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < COLD_START_MS) {
    return { clamp: 0.25, reason: "cold_start_first_24h", signerAuditRecordCount: signerAuditRecords.length };
  }
  return { clamp: 1.0, reason: null, signerAuditRecordCount: signerAuditRecords.length };
}

export function applyColdStartClampToIntent(intent = {}, clampResult = {}) {
  const clamp = finiteNumber(clampResult.clamp);
  const amountUsd = finiteNumber(intent.amountUsd);
  if (clamp === null || clamp >= 1 || amountUsd === null) return intent;
  const clampedAmountUsd = amountUsd * clamp;
  return {
    ...intent,
    amountUsd: clampedAmountUsd,
    metadata: {
      ...(intent.metadata || {}),
      coldStartClamp: {
        clamp,
        reason: clampResult.reason || null,
        originalAmountUsd: amountUsd,
        clampedAmountUsd,
      },
    },
  };
}

export function buildColdStartClampPolicyResult({
  clampResult = {},
  originalIntent = {},
  effectiveIntent = originalIntent,
  now = new Date().toISOString(),
} = {}) {
  return {
    policy: "cold_start_clamp",
    observedAt: now,
    decision: "ALLOW",
    blockers: [],
    clamp: finiteNumber(clampResult.clamp) ?? 1.0,
    reason: clampResult.reason || null,
    metrics: {
      originalAmountUsd: finiteNumber(originalIntent.amountUsd),
      effectiveAmountUsd: finiteNumber(effectiveIntent.amountUsd),
      signerAuditRecordCount: clampResult.signerAuditRecordCount ?? null,
    },
  };
}
