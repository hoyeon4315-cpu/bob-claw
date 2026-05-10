import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { safeJsonStringify } from "../../lib/json-safe.mjs";

export function featureEnabled(profile = {}) {
  return profile.operatorAbsenceEngine !== false;
}

export function evaluateOperatorAbsence({
  metrics = {},
  policy = {},
  now = Date.now(),
  profile,
} = {}) {
  if (profile && !featureEnabled(profile)) {
    return { state: "present", reason: "feature_disabled", details: {} };
  }

  const thresholds = {
    heartbeatStaleMs: 300_000,
    harvestStaleMs: 86_400_000,
    paybackStaleMs: 604_800_000,
    ...policy,
  };

  const ages = {
    heartbeatAgeMs: typeof metrics.heartbeatAt === "number" ? now - metrics.heartbeatAt : Infinity,
    harvestAgeMs: typeof metrics.lastHarvestAt === "number" ? now - metrics.lastHarvestAt : Infinity,
    paybackAgeMs: typeof metrics.lastPaybackAt === "number" ? now - metrics.lastPaybackAt : Infinity,
    signerAuditAgeMs: typeof metrics.lastSignerAuditAt === "number" ? now - metrics.lastSignerAuditAt : Infinity,
  };

  const stale = {
    heartbeat: ages.heartbeatAgeMs > thresholds.heartbeatStaleMs,
    harvest: ages.harvestAgeMs > thresholds.harvestStaleMs,
    payback: ages.paybackAgeMs > thresholds.paybackStaleMs,
    signerAudit: ages.signerAuditAgeMs > thresholds.heartbeatStaleMs,
  };

  let state = "present";
  if (stale.heartbeat && stale.harvest && stale.payback && stale.signerAudit) {
    state = "absent";
  } else if (Object.values(stale).some(Boolean)) {
    state = "degraded";
  }

  return {
    state,
    thresholds,
    ages,
    stale,
    now: new Date(now).toISOString(),
  };
}

export async function logAbsenceTransition({
  previousState = null,
  currentState,
  details = {},
  auditPath = "logs/operator-absence-audit.jsonl",
  now = new Date().toISOString(),
} = {}) {
  const record = {
    schemaVersion: 1,
    timestamp: now,
    previousState,
    currentState,
    details,
  };
  await mkdir(dirname(auditPath), { recursive: true });
  await appendFile(auditPath, `${safeJsonStringify(record)}\n`, "utf8");
  return record;
}
