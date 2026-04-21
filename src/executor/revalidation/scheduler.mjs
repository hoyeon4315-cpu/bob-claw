// Revalidation scheduler: periodically re-runs the edge-viability /
// overfit-audit evaluation and publishes a dated snapshot.
//
// Addresses Kimi-identified automation gap: revalidation artifacts were only
// produced ad-hoc via CLI. This loop makes the audit run on a fixed cadence
// (cron-like minute match) so that T6 (liveTrading dynamic gate) and the
// dashboard can always read the latest snapshot without a human invoking a
// CLI.
//
// Pure policy-adjacent code. No LLM. No signer. No keys. Writes only to a
// dedicated snapshot path; never mutates audit log.

import { setTimeout as delay } from "node:timers/promises";
import { matchesCronExpression } from "../payback/scheduler.mjs";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_CRON_EXPRESSION = "0 */6 * * *"; // every 6 hours, minute 0

export const REVALIDATION_SCHEDULER_DEFAULTS = Object.freeze({
  cronExpression: DEFAULT_CRON_EXPRESSION,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  maxConsecutiveFailures: 3,
});

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

function minuteKey(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 16); // YYYY-MM-DDTHH:MM
}

function sameMinute(a, b) {
  return minuteKey(a) && minuteKey(a) === minuteKey(b);
}

export async function runRevalidationSchedulerTick({
  now,
  buildAuditImpl,
  writeSnapshotImpl = async () => {},
  onError = async () => {},
} = {}) {
  const observedAt = toIso(now || new Date());
  if (typeof buildAuditImpl !== "function") {
    return {
      schemaVersion: 1,
      observedAt,
      status: "error",
      reason: "build_audit_not_provided",
    };
  }
  try {
    const audit = await buildAuditImpl({ observedAt });
    await writeSnapshotImpl({ observedAt, audit });
    return {
      schemaVersion: 1,
      observedAt,
      status: "ok",
      decision: audit?.audit?.decision ?? audit?.decision ?? null,
      blockers: audit?.audit?.blockers ?? audit?.blockers ?? [],
    };
  } catch (err) {
    await onError({ observedAt, error: err });
    return {
      schemaVersion: 1,
      observedAt,
      status: "error",
      reason: "tick_threw",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runRevalidationSchedulerLoop({
  cronExpression = DEFAULT_CRON_EXPRESSION,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxConsecutiveFailures = REVALIDATION_SCHEDULER_DEFAULTS.maxConsecutiveFailures,
  nowFactory = () => new Date().toISOString(),
  onIteration = async () => {},
  tickImpl = runRevalidationSchedulerTick,
  delayImpl = delay,
  buildAuditImpl,
  writeSnapshotImpl,
  onError = async () => {},
  once = false,
} = {}) {
  let lastTriggeredAt = null;
  let consecutiveFailures = 0;
  while (true) {
    const now = nowFactory();
    const cronMatched = matchesCronExpression(cronExpression, new Date(now));
    let result = {
      schemaVersion: 1,
      observedAt: now,
      status: "idle",
      reason: "cron_not_matched",
      cronExpression,
      cronMatched,
      lastTriggeredAt,
      consecutiveFailures,
    };
    if (cronMatched && !sameMinute(lastTriggeredAt, now)) {
      result = await tickImpl({
        now,
        buildAuditImpl,
        writeSnapshotImpl,
        onError,
      });
      result.cronExpression = cronExpression;
      result.cronMatched = cronMatched;
      lastTriggeredAt = now;
      if (result.status === "ok") {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures += 1;
      }
      result.consecutiveFailures = consecutiveFailures;
      result.lastTriggeredAt = lastTriggeredAt;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        result.reason = "max_consecutive_failures";
        result.status = "halted";
        await onIteration({ ...result, nextCheckInMs: 0 });
        return result;
      }
    }
    await onIteration({
      ...result,
      nextCheckInMs: once ? 0 : pollIntervalMs,
    });
    if (once) return result;
    await delayImpl(pollIntervalMs);
  }
}
