import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { safeJsonStringify } from "../../lib/json-safe.mjs";

export function featureEnabled(profile = {}) {
  return profile.selfHealingRebuild !== false;
}

export async function runSelfHealing({
  absenceState = "present",
  components = {},
  now = Date.now(),
  dryRun = false,
  auditPath = "logs/self-healing-rebuild-audit.jsonl",
  profile,
} = {}) {
  if (profile && !featureEnabled(profile)) {
    return { rebuilt: false, reason: "feature_disabled", steps: [] };
  }

  if (absenceState !== "absent") {
    return { rebuilt: false, reason: "state_not_absent", steps: [] };
  }

  const steps = [];

  if (components.heartbeatStale) {
    steps.push({ step: "restart_signer_daemon", executed: !dryRun, dryRun });
  }

  if (components.receiptIngestorLagMs > 600_000) {
    steps.push({ step: "replay_audit_logs", executed: !dryRun, dryRun });
  }

  if (components.dashboardStaleMs > 1_800_000) {
    steps.push({ step: "rebuild_dashboard_slices", executed: !dryRun, dryRun });
  }

  steps.push({ step: "emit_alert", executed: !dryRun, dryRun, channel: "telegram" });

  const result = {
    rebuilt: steps.length > 0 && !dryRun,
    dryRun,
    steps,
    timestamp: new Date(now).toISOString(),
  };

  if (!dryRun && steps.length > 0) {
    await mkdir(dirname(auditPath), { recursive: true });
    await appendFile(auditPath, `${safeJsonStringify({ schemaVersion: 1, ...result })}\n`, "utf8");
  }

  return result;
}
