// Auto-promotion thresholds for the dev-automation lane.
// Commit-only. Runtime overrides are forbidden by AGENTS.md.
//
// Evaluated by `src/executor/auto-promotion-gate.mjs`. Evidence files emitted
// by the auto-validation harness are scored against these thresholds. When a
// candidate strategy passes, the coding-session LLM may flip its `autoExecute`
// flag in a committed config diff using `initialCanaryCaps` (NOT the
// operator's normal caps). Operator-committed cap raises after
// `canaryGraduationPeriods` of clean live periods.

export const AUTO_PROMOTION_DEFAULTS = Object.freeze({
  // Walk-forward purged/embargoed CV gates.
  walkForward: Object.freeze({
    enabled: true,
    sharpeMin: 1.0,
    maxDrawdownPct: 20,
    minRegimeChanges: 1,
    minSamplePeriods: 12,
  }),

  // Out-of-sample holdout gate (last N days, never seen during fit).
  // oosNetPositive is a hard blocker — any candidate failing this is rejected.
  oosHoldout: Object.freeze({
    enabled: true,
    minHoldoutDays: 30,
    requireNetPositive: true,
  }),

  // Regime breakdown gate — evidence must report bear/neutral/bull_peak
  // sample counts and net PnL. Engine doesn't judge "good", only presence.
  regimeBreakdown: Object.freeze({
    enabled: true,
    requiredRegimes: Object.freeze(["bear", "neutral", "bull_peak"]),
    minSamplesPerRegime: 1,
  }),

  // Shadow / replay continuity gates.
  shadow: Object.freeze({
    enabled: true,
    consecutivePositivePeriodsMin: 8,
    netOfMeasuredCostPositive: true,
    minQuoteSuccessRate: 0.9,
  }),

  // Quality-of-execution gates.
  execution: Object.freeze({
    oracleDivergencePctMax: 1.0,
    slippagePctMax: 0.5,
    measuredEdgeAboveCostVarianceFloor: true,
  }),

  // Caps automatically applied at promotion time. The auto-promoted strategy
  // may run with these caps until graduation. Cap raises require a separate
  // operator-committed diff in `src/config/strategy-caps.mjs` (or the
  // strategy's own config module).
  initialCanaryCaps: Object.freeze({
    perTxUsd: 200,
    perDayUsd: 1000,
    perChainUsd: 1000,
    maxDailyLossUsd: 50,
    maxFailedGasCost24hUsd: 25,
  }),

  // Number of clean live periods before the strategy is graduation-eligible.
  // Hitting this only unlocks the operator's review — it does NOT raise caps
  // automatically.
  canaryGraduationPeriods: 30,
});

export function buildAutoPromotionConfig(overrides = {}) {
  return Object.freeze({
    walkForward: Object.freeze({
      ...AUTO_PROMOTION_DEFAULTS.walkForward,
      ...(overrides.walkForward || {}),
    }),
    oosHoldout: Object.freeze({
      ...AUTO_PROMOTION_DEFAULTS.oosHoldout,
      ...(overrides.oosHoldout || {}),
    }),
    regimeBreakdown: Object.freeze({
      ...AUTO_PROMOTION_DEFAULTS.regimeBreakdown,
      ...(overrides.regimeBreakdown || {}),
      requiredRegimes: Object.freeze(
        overrides.regimeBreakdown?.requiredRegimes ?? AUTO_PROMOTION_DEFAULTS.regimeBreakdown.requiredRegimes,
      ),
    }),
    shadow: Object.freeze({
      ...AUTO_PROMOTION_DEFAULTS.shadow,
      ...(overrides.shadow || {}),
    }),
    execution: Object.freeze({
      ...AUTO_PROMOTION_DEFAULTS.execution,
      ...(overrides.execution || {}),
    }),
    initialCanaryCaps: Object.freeze({
      ...AUTO_PROMOTION_DEFAULTS.initialCanaryCaps,
      ...(overrides.initialCanaryCaps || {}),
    }),
    canaryGraduationPeriods:
      overrides.canaryGraduationPeriods ?? AUTO_PROMOTION_DEFAULTS.canaryGraduationPeriods,
  });
}
