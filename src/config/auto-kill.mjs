// Auto kill-switch trigger thresholds.
// Commit-only. Runtime overrides are forbidden by AGENTS.md.
// All thresholds are evaluated by `src/risk/auto-kill-triggers.mjs`.
// When any trigger fires, the daemon writes the kill-switch file and halts.
// Manual removal of the kill-switch file is the only resume path.

export const AUTO_KILL_DEFAULTS = Object.freeze({
  // Cumulative realized loss in the trailing window (USD).
  // Sized for ×40 cap mode. Tighten if operating capital shrinks.
  cumulativeLoss: Object.freeze({
    enabled: true,
    windowMs: 24 * 60 * 60 * 1000,
    thresholdUsd: 1000,
    operatingCapitalFractionFloor: 0.05,
  }),

  // Failure burst across all strategies in a short window.
  failureBurst: Object.freeze({
    enabled: true,
    windowMs: 5 * 60 * 1000,
    failureCount: 8,
    perStrategyFailureCount: 5,
  }),

  // Oracle divergence between independent price sources.
  oracleDivergence: Object.freeze({
    enabled: true,
    maxDivergencePct: 0.05,
    minSourceCount: 2,
  }),

  // Watchdog heartbeat freshness check (passthrough — daemon already enforces).
  heartbeat: Object.freeze({
    enabled: true,
    maxAgeMs: 60_000,
  }),
});

export function buildAutoKillConfig(overrides = {}) {
  return Object.freeze({
    cumulativeLoss: Object.freeze({
      ...AUTO_KILL_DEFAULTS.cumulativeLoss,
      ...(overrides.cumulativeLoss || {}),
    }),
    failureBurst: Object.freeze({
      ...AUTO_KILL_DEFAULTS.failureBurst,
      ...(overrides.failureBurst || {}),
    }),
    oracleDivergence: Object.freeze({
      ...AUTO_KILL_DEFAULTS.oracleDivergence,
      ...(overrides.oracleDivergence || {}),
    }),
    heartbeat: Object.freeze({
      ...AUTO_KILL_DEFAULTS.heartbeat,
      ...(overrides.heartbeat || {}),
    }),
  });
}
