// Liquidity watch. DEX/lending pool utilization, withdrawal queue depth.

import { SEVERITY, makeVerdict, isFiniteNumber } from "./types.mjs";

export const LIQUIDITY_WATCH_THRESHOLDS = Object.freeze({
  utilizationMaxPct: 0.95,
  utilizationSustainedMinutes: 60,
  withdrawalQueueMaxBlocks: 500,
});

export function evaluateLiquidityWatch(snapshot, thresholds = LIQUIDITY_WATCH_THRESHOLDS) {
  const poolId = snapshot?.poolId || "unknown";
  const violations = [];
  const details = {};

  if (isFiniteNumber(snapshot?.utilizationPct)) {
    details.utilizationPct = snapshot.utilizationPct;
    details.utilizationSustainedMinutes = snapshot.utilizationSustainedMinutes ?? 0;
    if (
      snapshot.utilizationPct >= thresholds.utilizationMaxPct &&
      (snapshot.utilizationSustainedMinutes ?? 0) >= thresholds.utilizationSustainedMinutes
    ) {
      violations.push({
        kind: "utilization_sustained_over_threshold",
        utilization: snapshot.utilizationPct,
        sustainedMinutes: snapshot.utilizationSustainedMinutes,
      });
    }
  }
  if (isFiniteNumber(snapshot?.withdrawalQueueBlocks) &&
      snapshot.withdrawalQueueBlocks >= thresholds.withdrawalQueueMaxBlocks) {
    violations.push({
      kind: "withdrawal_queue_too_deep",
      blocks: snapshot.withdrawalQueueBlocks,
      max: thresholds.withdrawalQueueMaxBlocks,
    });
  }

  const ok = violations.length === 0;
  const severity = ok ? SEVERITY.INFO : SEVERITY.HALT_STRATEGY;
  const action = ok ? "none" : "block_new_entries_queue_unwind";
  return makeVerdict({
    moduleId: `liquidity-watch:${poolId}`,
    ok, severity, action, violations, details,
  });
}
