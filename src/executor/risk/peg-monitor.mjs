// Peg monitor. LST / wrapped-BTC depeg detector.

import { SEVERITY, makeVerdict, isFiniteNumber } from "./types.mjs";

export const PEG_MONITOR_THRESHOLDS = Object.freeze({
  depegPctMax: 0.005, // 0.5%
  depegSustainedMinutes: 30,
});

export function evaluatePegMonitor(snapshot, thresholds = PEG_MONITOR_THRESHOLDS) {
  const assetId = snapshot?.assetId || "unknown";
  const violations = [];
  const details = {};

  if (isFiniteNumber(snapshot?.pegDeviationPct)) {
    details.pegDeviationPct = snapshot.pegDeviationPct;
    details.pegSustainedMinutes = snapshot.pegSustainedMinutes ?? 0;
    if (
      Math.abs(snapshot.pegDeviationPct) >= thresholds.depegPctMax &&
      (snapshot.pegSustainedMinutes ?? 0) >= thresholds.depegSustainedMinutes
    ) {
      violations.push({
        kind: "sustained_depeg",
        deviation: snapshot.pegDeviationPct,
        sustainedMinutes: snapshot.pegSustainedMinutes,
      });
    }
  }

  const ok = violations.length === 0;
  const severity = ok ? SEVERITY.INFO : SEVERITY.UNWIND_ALL;
  const action = ok ? "none" : "unwind_all_exposure_for_asset";
  return makeVerdict({
    moduleId: `peg-monitor:${assetId}`,
    ok, severity, action, violations, details,
  });
}
