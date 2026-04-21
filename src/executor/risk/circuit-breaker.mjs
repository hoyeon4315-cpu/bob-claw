// Circuit breaker. Fan-in of all risk-daemon verdicts. If any verdict has
// severity >= HALT_PROTOCOL, trip emergency pause (touch KILL_SWITCH_PATH).
// The touch itself is the caller's responsibility (requires fs); this module
// only *decides* whether to trip. Pure function.

import { SEVERITY, makeVerdict } from "./types.mjs";

const SEVERITY_RANK = Object.freeze({
  [SEVERITY.INFO]: 0,
  [SEVERITY.WARN]: 1,
  [SEVERITY.HALT_STRATEGY]: 2,
  [SEVERITY.HALT_PROTOCOL]: 3,
  [SEVERITY.UNWIND_ALL]: 4,
  [SEVERITY.KILL_SWITCH]: 5,
});

export const CIRCUIT_BREAKER_TRIP_AT = SEVERITY.HALT_PROTOCOL;

export function evaluateCircuitBreaker(verdicts, tripAt = CIRCUIT_BREAKER_TRIP_AT) {
  const arr = Array.isArray(verdicts) ? verdicts : [];
  const tripRank = SEVERITY_RANK[tripAt] ?? SEVERITY_RANK[SEVERITY.HALT_PROTOCOL];

  let worst = SEVERITY.INFO;
  let worstRank = 0;
  const tripping = [];
  for (const v of arr) {
    if (!v || !v.severity) continue;
    const r = SEVERITY_RANK[v.severity] ?? 0;
    if (r > worstRank) {
      worstRank = r;
      worst = v.severity;
    }
    if (r >= tripRank && !v.ok) {
      tripping.push({
        moduleId: v.moduleId,
        severity: v.severity,
        action: v.action,
      });
    }
  }

  const shouldTrip = tripping.length > 0;
  return makeVerdict({
    moduleId: "circuit-breaker",
    ok: !shouldTrip,
    severity: worst,
    action: shouldTrip ? "touch_kill_switch_and_alert" : "none",
    violations: tripping,
    details: {
      evaluatedCount: arr.length,
      trippingCount: tripping.length,
      worstSeverity: worst,
      tripAt,
    },
  });
}
