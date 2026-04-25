/**
 * Walk-forward purged/embargoed cross-validation evaluator.
 *
 * AGENTS.md requires: "no strategy goes live solely on a single-period or
 * single-pair backtest. At minimum, Walk-Forward purged/embargoed CV + at
 * least one regime change in the sample window."
 *
 * This module is the first half (walk-forward purged CV). Regime-change
 * detection is a separate module.
 *
 * Purpose
 * -------
 * Given a chronologically-ordered sample of strategy outcomes (shadow
 * observations, dry-run results, or live receipts), split into sequential
 * train/test folds with an embargo gap between them, and report metric
 * degradation from train to test. If degradation exceeds a threshold in
 * too many folds, the strategy is flagged as overfit.
 *
 * Algorithm
 * ---------
 * For K folds:
 *   for i in 0..K-1:
 *     trainWindow = [t_start + i*step, t_start + i*step + trainMs)
 *     (purge)      [train end, train end + purgeMs)    -- dropped
 *     testWindow  = [train end + purgeMs, train end + purgeMs + testMs)
 *     (embargo)    samples within embargoMs of test end are not used in
 *                  the *next* fold's train window
 *
 * Zero I/O. Deterministic. Output frozen.
 *
 * Input shape
 * -----------
 * samples: array of { tsMs: number, profitSats: number, costSats: number,
 *                     success: boolean } sorted by tsMs ascending
 *
 * Output shape
 * ------------
 * {
 *   folds: Array<{
 *     index,
 *     trainStartMs, trainEndMs, testStartMs, testEndMs,
 *     trainCount, testCount,
 *     trainMetrics, testMetrics,
 *     degradation: { successRateDelta, netProfitRatio, roundTripEffDelta },
 *     passed: boolean,
 *     blockers: string[]
 *   }>,
 *   aggregate: { foldsPassed, foldsFailed, totalFolds },
 *   passes: boolean,
 *   blockers: string[]
 * }
 */

export const WALK_FORWARD_DEFAULTS = Object.freeze({
  folds: 5,
  trainMs: 14 * 24 * 60 * 60 * 1000,
  testMs: 3 * 24 * 60 * 60 * 1000,
  purgeMs: 24 * 60 * 60 * 1000,
  embargoMs: 24 * 60 * 60 * 1000,
  minSamplesPerFold: 3,
  // Per-fold pass criteria
  maxSuccessRateDrop: 0.20,       // test successRate >= train - 0.20
  minTestNetProfitRatio: 0.5,     // test net/sample >= 0.5 × train net/sample
  maxRoundTripEffDrop: 0.10,      // test eff >= train eff - 0.10
  // Aggregate: require at least this fraction of folds to pass
  minFoldsPassedFraction: 0.6,
});

function metricsFor(samples) {
  if (samples.length === 0) {
    return Object.freeze({
      count: 0,
      successRate: 0,
      grossProfitSats: 0,
      totalCostSats: 0,
      netProfitSats: 0,
      roundTripEfficiency: 0,
    });
  }
  let successes = 0;
  let grossProfit = 0;
  let totalCost = 0;
  for (const s of samples) {
    if (s.success) successes += 1;
    grossProfit += Number(s.profitSats || 0);
    totalCost += Number(s.costSats || 0);
  }
  const net = grossProfit - totalCost;
  const eff = grossProfit > 0 ? net / grossProfit : 0;
  return Object.freeze({
    count: samples.length,
    successRate: successes / samples.length,
    grossProfitSats: grossProfit,
    totalCostSats: totalCost,
    netProfitSats: net,
    roundTripEfficiency: Number(eff.toFixed(4)),
  });
}

function sliceBetween(samples, startMs, endMs) {
  const out = [];
  for (const s of samples) {
    if (s.tsMs >= startMs && s.tsMs < endMs) out.push(s);
  }
  return out;
}

function evaluateFold({
  index,
  trainStartMs,
  trainEndMs,
  testStartMs,
  testEndMs,
  samples,
  minSamplesPerFold,
  maxSuccessRateDrop,
  minTestNetProfitRatio,
  maxRoundTripEffDrop,
}) {
  const trainSet = sliceBetween(samples, trainStartMs, trainEndMs);
  const testSet = sliceBetween(samples, testStartMs, testEndMs);
  const trainMetrics = metricsFor(trainSet);
  const testMetrics = metricsFor(testSet);
  const blockers = [];

  if (trainMetrics.count < minSamplesPerFold) {
    blockers.push("insufficient_train_samples");
  }
  if (testMetrics.count < minSamplesPerFold) {
    blockers.push("insufficient_test_samples");
  }

  const successRateDelta = Number(
    (testMetrics.successRate - trainMetrics.successRate).toFixed(4),
  );
  // Normalize to per-sample net profit so the ratio reflects strategy
  // quality, not window-size differences between train and test.
  const trainNetPerSample =
    trainMetrics.count > 0 ? trainMetrics.netProfitSats / trainMetrics.count : 0;
  const testNetPerSample =
    testMetrics.count > 0 ? testMetrics.netProfitSats / testMetrics.count : 0;
  const netProfitRatio =
    trainNetPerSample > 0
      ? Number((testNetPerSample / trainNetPerSample).toFixed(4))
      : testNetPerSample > 0
        ? Infinity
        : 0;
  const roundTripEffDelta = Number(
    (testMetrics.roundTripEfficiency - trainMetrics.roundTripEfficiency).toFixed(4),
  );

  if (successRateDelta < -maxSuccessRateDrop) {
    blockers.push("success_rate_degradation_exceeds_threshold");
  }
  if (
    trainNetPerSample > 0 &&
    netProfitRatio < minTestNetProfitRatio
  ) {
    blockers.push("net_profit_ratio_below_threshold");
  }
  if (roundTripEffDelta < -maxRoundTripEffDrop) {
    blockers.push("round_trip_efficiency_degradation_exceeds_threshold");
  }

  return Object.freeze({
    index,
    trainStartMs,
    trainEndMs,
    testStartMs,
    testEndMs,
    trainCount: trainMetrics.count,
    testCount: testMetrics.count,
    trainMetrics,
    testMetrics,
    degradation: Object.freeze({
      successRateDelta,
      netProfitRatio: Number.isFinite(netProfitRatio) ? netProfitRatio : null,
      roundTripEffDelta,
    }),
    passed: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

export function evaluateWalkForwardCv({
  samples,
  folds = WALK_FORWARD_DEFAULTS.folds,
  trainMs = WALK_FORWARD_DEFAULTS.trainMs,
  testMs = WALK_FORWARD_DEFAULTS.testMs,
  purgeMs = WALK_FORWARD_DEFAULTS.purgeMs,
  embargoMs = WALK_FORWARD_DEFAULTS.embargoMs,
  minSamplesPerFold = WALK_FORWARD_DEFAULTS.minSamplesPerFold,
  maxSuccessRateDrop = WALK_FORWARD_DEFAULTS.maxSuccessRateDrop,
  minTestNetProfitRatio = WALK_FORWARD_DEFAULTS.minTestNetProfitRatio,
  maxRoundTripEffDrop = WALK_FORWARD_DEFAULTS.maxRoundTripEffDrop,
  minFoldsPassedFraction = WALK_FORWARD_DEFAULTS.minFoldsPassedFraction,
} = {}) {
  if (!Array.isArray(samples)) {
    throw new TypeError("samples must be an array");
  }
  if (!Number.isInteger(folds) || folds < 1) {
    throw new TypeError("folds must be a positive integer");
  }
  if (trainMs <= 0 || testMs <= 0) {
    throw new TypeError("trainMs and testMs must be positive");
  }

  const sorted = samples
    .filter((s) => s && Number.isFinite(s.tsMs))
    .slice()
    .sort((a, b) => a.tsMs - b.tsMs);

  const topLevelBlockers = [];
  if (sorted.length === 0) {
    const empty = Object.freeze({
      folds: Object.freeze([]),
      aggregate: Object.freeze({
        foldsPassed: 0,
        foldsFailed: 0,
        totalFolds: 0,
      }),
      passes: false,
      blockers: Object.freeze(["no_samples"]),
    });
    return empty;
  }

  const windowMs = trainMs + purgeMs + testMs;
  const spanMs = sorted[sorted.length - 1].tsMs - sorted[0].tsMs;
  if (spanMs < windowMs) {
    topLevelBlockers.push("sample_span_shorter_than_one_fold_window");
  }

  // Anchor the first fold to the first sample, and slide forward by
  // (testMs + embargoMs) on each step so embargo naturally gaps adjacent
  // training windows.
  const step = testMs + embargoMs;
  const foldResults = [];
  for (let i = 0; i < folds; i += 1) {
    const trainStartMs = sorted[0].tsMs + i * step;
    const trainEndMs = trainStartMs + trainMs;
    const testStartMs = trainEndMs + purgeMs;
    const testEndMs = testStartMs + testMs;
    if (testEndMs > sorted[sorted.length - 1].tsMs + 1) {
      // Window extends beyond available samples; stop adding folds.
      break;
    }
    foldResults.push(
      evaluateFold({
        index: i,
        trainStartMs,
        trainEndMs,
        testStartMs,
        testEndMs,
        samples: sorted,
        minSamplesPerFold,
        maxSuccessRateDrop,
        minTestNetProfitRatio,
        maxRoundTripEffDrop,
      }),
    );
  }

  const foldsPassed = foldResults.filter((f) => f.passed).length;
  const foldsFailed = foldResults.length - foldsPassed;
  const passFraction =
    foldResults.length > 0 ? foldsPassed / foldResults.length : 0;

  if (foldResults.length === 0) {
    topLevelBlockers.push("no_complete_folds_in_sample_span");
  }
  if (
    foldResults.length > 0 &&
    passFraction < minFoldsPassedFraction
  ) {
    topLevelBlockers.push("insufficient_folds_passed");
  }

  return Object.freeze({
    folds: Object.freeze(foldResults),
    aggregate: Object.freeze({
      foldsPassed,
      foldsFailed,
      totalFolds: foldResults.length,
    }),
    passes: topLevelBlockers.length === 0,
    blockers: Object.freeze(topLevelBlockers),
  });
}
