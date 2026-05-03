// Pure function that evaluates a strategy's evidence file against the
// thresholds in `src/config/auto-promotion.mjs`. Returns a deterministic
// pass/fail with human-readable reasons. NEVER reads model output. NEVER
// makes a judgment call. Threshold changes require a committed config diff.
//
// Inputs:
//   evidence: {
//     strategyId: string,
//     walkForward: { sharpe, maxDrawdownPct, regimeChanges, samplePeriods },
//     shadow:      { consecutivePositivePeriods, netOfMeasuredCost, quoteSuccessRate },
//     execution:   { oracleDivergencePct, slippagePct, edgeAboveCostVariance },
//   }
//   config: from buildAutoPromotionConfig
//
// Output:
//   { passed: boolean, blockers: string[], evaluated: {...}, initialCanaryCaps }

import { buildAutoPromotionConfig } from "../config/auto-promotion.mjs";

function checkWalkForward(evidence, gate) {
  const blockers = [];
  if (!gate.enabled) return blockers;
  const wf = evidence.walkForward || {};
  if (!(typeof wf.sharpe === "number") || wf.sharpe < gate.sharpeMin) {
    blockers.push(`walk_forward_sharpe_below_min(${wf.sharpe ?? "missing"} < ${gate.sharpeMin})`);
  }
  if (!(typeof wf.maxDrawdownPct === "number") || wf.maxDrawdownPct > gate.maxDrawdownPct) {
    blockers.push(
      `walk_forward_drawdown_exceeded(${wf.maxDrawdownPct ?? "missing"} > ${gate.maxDrawdownPct})`,
    );
  }
  if (!(typeof wf.regimeChanges === "number") || wf.regimeChanges < gate.minRegimeChanges) {
    blockers.push(
      `walk_forward_regime_changes_insufficient(${wf.regimeChanges ?? "missing"} < ${gate.minRegimeChanges})`,
    );
  }
  if (!(typeof wf.samplePeriods === "number") || wf.samplePeriods < gate.minSamplePeriods) {
    blockers.push(
      `walk_forward_sample_periods_insufficient(${wf.samplePeriods ?? "missing"} < ${gate.minSamplePeriods})`,
    );
  }
  return blockers;
}

function checkShadow(evidence, gate) {
  const blockers = [];
  if (!gate.enabled) return blockers;
  const sh = evidence.shadow || {};
  if (
    !(typeof sh.consecutivePositivePeriods === "number") ||
    sh.consecutivePositivePeriods < gate.consecutivePositivePeriodsMin
  ) {
    blockers.push(
      `shadow_consecutive_positive_below_min(${sh.consecutivePositivePeriods ?? "missing"} < ${gate.consecutivePositivePeriodsMin})`,
    );
  }
  if (gate.netOfMeasuredCostPositive && sh.netOfMeasuredCost !== true) {
    blockers.push("shadow_not_positive_net_of_measured_cost");
  }
  if (
    !(typeof sh.quoteSuccessRate === "number") ||
    sh.quoteSuccessRate < gate.minQuoteSuccessRate
  ) {
    blockers.push(
      `shadow_quote_success_rate_low(${sh.quoteSuccessRate ?? "missing"} < ${gate.minQuoteSuccessRate})`,
    );
  }
  return blockers;
}

function checkExecution(evidence, gate) {
  const blockers = [];
  const ex = evidence.execution || {};
  if (
    !(typeof ex.oracleDivergencePct === "number") ||
    ex.oracleDivergencePct > gate.oracleDivergencePctMax
  ) {
    blockers.push(
      `execution_oracle_divergence_exceeded(${ex.oracleDivergencePct ?? "missing"} > ${gate.oracleDivergencePctMax})`,
    );
  }
  if (!(typeof ex.slippagePct === "number") || ex.slippagePct > gate.slippagePctMax) {
    blockers.push(
      `execution_slippage_exceeded(${ex.slippagePct ?? "missing"} > ${gate.slippagePctMax})`,
    );
  }
  if (gate.measuredEdgeAboveCostVarianceFloor && ex.edgeAboveCostVariance !== true) {
    blockers.push("execution_edge_below_cost_variance_floor");
  }
  return blockers;
}

function checkOosHoldout(evidence, gate) {
  const blockers = [];
  if (!gate || !gate.enabled) return blockers;
  const oos = evidence.oosHoldout || null;
  if (!oos || typeof oos !== "object") {
    blockers.push("oos_holdout_missing");
    return blockers;
  }
  if (!(typeof oos.holdoutDays === "number") || oos.holdoutDays < gate.minHoldoutDays) {
    blockers.push(`oos_holdout_window_too_small(${oos.holdoutDays ?? "missing"} < ${gate.minHoldoutDays})`);
  }
  if (gate.requireNetPositive && oos.netPositive !== true) {
    blockers.push("oos_holdout_not_net_positive");
  }
  return blockers;
}

function checkRegimeBreakdown(evidence, gate) {
  const blockers = [];
  if (!gate || !gate.enabled) return blockers;
  const rb = evidence.regimeBreakdown || null;
  if (!rb || typeof rb !== "object") {
    blockers.push("regime_breakdown_missing");
    return blockers;
  }
  for (const regime of gate.requiredRegimes) {
    const entry = rb[regime];
    if (!entry || typeof entry !== "object") {
      blockers.push(`regime_breakdown_missing_${regime}`);
      continue;
    }
    if (!(typeof entry.sampleCount === "number") || entry.sampleCount < gate.minSamplesPerRegime) {
      blockers.push(`regime_breakdown_${regime}_samples_insufficient(${entry.sampleCount ?? "missing"} < ${gate.minSamplesPerRegime})`);
    }
    if (!(typeof entry.netPnlUsd === "number")) {
      blockers.push(`regime_breakdown_${regime}_net_pnl_missing`);
    }
  }
  return blockers;
}

export function evaluateAutoPromotion(evidence, config = buildAutoPromotionConfig()) {
  if (!evidence || typeof evidence !== "object") {
    return {
      passed: false,
      blockers: ["evidence_missing"],
      evaluated: null,
      initialCanaryCaps: config.initialCanaryCaps,
    };
  }
  if (!evidence.strategyId || typeof evidence.strategyId !== "string") {
    return {
      passed: false,
      blockers: ["evidence_missing_strategy_id"],
      evaluated: null,
      initialCanaryCaps: config.initialCanaryCaps,
    };
  }
  const blockers = [
    ...checkWalkForward(evidence, config.walkForward),
    ...checkOosHoldout(evidence, config.oosHoldout),
    ...checkRegimeBreakdown(evidence, config.regimeBreakdown),
    ...checkShadow(evidence, config.shadow),
    ...checkExecution(evidence, config.execution),
  ];
  return {
    passed: blockers.length === 0,
    blockers,
    evaluated: {
      strategyId: evidence.strategyId,
      walkForward: evidence.walkForward || null,
      oosHoldout: evidence.oosHoldout || null,
      regimeBreakdown: evidence.regimeBreakdown || null,
      shadow: evidence.shadow || null,
      execution: evidence.execution || null,
    },
    initialCanaryCaps: config.initialCanaryCaps,
  };
}
