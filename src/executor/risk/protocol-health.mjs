// Protocol health monitor. TVL drop / oracle deviation / admin-key risk.
// Pure: data sources (DefiLlama, Chainlink, on-chain readers) are injected
// by the caller as precomputed snapshot fields.

import { SEVERITY, makeVerdict, isFiniteNumber } from "./types.mjs";

export const PROTOCOL_HEALTH_THRESHOLDS = Object.freeze({
  tvlDrop24hMaxPct: 0.30,
  oracleDeviationMaxPct: 0.03,
  windowMinutesMin: 60,
});

export function evaluateProtocolHealth(snapshot, thresholds = PROTOCOL_HEALTH_THRESHOLDS) {
  const protocolId = snapshot?.protocolId || "unknown";
  const violations = [];
  const details = {};

  if (isFiniteNumber(snapshot?.tvlDrop24hPct)) {
    details.tvlDrop24hPct = snapshot.tvlDrop24hPct;
    if (snapshot.tvlDrop24hPct >= thresholds.tvlDrop24hMaxPct) {
      violations.push({ kind: "tvl_drop_24h_exceeded", observed: snapshot.tvlDrop24hPct, max: thresholds.tvlDrop24hMaxPct });
    }
  }
  if (isFiniteNumber(snapshot?.oracleDeviationPct)) {
    details.oracleDeviationPct = snapshot.oracleDeviationPct;
    if (Math.abs(snapshot.oracleDeviationPct) >= thresholds.oracleDeviationMaxPct) {
      violations.push({ kind: "oracle_deviation_exceeded", observed: snapshot.oracleDeviationPct, max: thresholds.oracleDeviationMaxPct });
    }
  }
  if (snapshot?.adminKeyChangedRecently === true) {
    violations.push({ kind: "admin_key_change_detected" });
  }
  if (snapshot?.exploitAdvisoryActive === true) {
    violations.push({ kind: "exploit_advisory_active", sourceId: snapshot.exploitAdvisorySourceId || null });
  }

  const ok = violations.length === 0;
  const severity = ok ? SEVERITY.INFO : SEVERITY.HALT_PROTOCOL;
  const action = ok ? "none" : "halt_protocol_and_unwind";
  return makeVerdict({
    moduleId: `protocol-health:${protocolId}`,
    ok, severity, action, violations, details,
  });
}
