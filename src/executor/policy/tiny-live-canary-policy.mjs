function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function hoursAgo(timestamp, now) {
  return (new Date(now).getTime() - new Date(timestamp).getTime()) / 3_600_000;
}

const VALID_MICRO_CANARY_STAGES = new Set([
  "minimal_live_proof_exists",
  "micro_canary_repeatable",
]);

export function evaluateTinyLiveCanaryPolicy({
  intent = {},
  strategyCaps = null,
  microCanaryStatus = null,
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const blockers = [];

  if (intent.intentType !== "tiny_live_canary") {
    return {
      policy: "tiny_live_canary",
      observedAt: now,
      decision: "ALLOW",
      blockers,
      requiresTinyLive: false,
    };
  }

  if (!VALID_MICRO_CANARY_STAGES.has(microCanaryStatus)) {
    blockers.push("tiny_live_micro_canary_stage_insufficient");
  }

  const emergencyUnwindPath = strategyCaps?.leverage?.emergencyUnwindPath || null;
  if (!Array.isArray(emergencyUnwindPath) || emergencyUnwindPath.length === 0) {
    blockers.push("tiny_live_emergency_unwind_path_missing");
  }

  const provenEmergencyUnwind = auditRecords.some(
    (record) =>
      record.strategyId === intent.strategyId &&
      record.intent?.intentType === "emergency_unwind" &&
      record.lifecycle?.stage === "confirmed" &&
      hoursAgo(record.timestamp || record.observedAt || now, now) <= 24,
  );

  if (!provenEmergencyUnwind) {
    blockers.push("tiny_live_emergency_unwind_not_proven");
  }

  return {
    policy: "tiny_live_canary",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    requiresTinyLive: blockers.length === 0,
  };
}
