const DEFAULT_MIN_RETURNS = 30;
const DEFAULT_MIN_PERIODS = 4;
const DEFAULT_MIN_VARIANTS = 2;
const DEFAULT_MIN_FOLDS = 2;

function finiteNumbers(values = []) {
  return (values || []).map(Number).filter(Number.isFinite);
}

function mean(values = []) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values = []) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function sampleMoment(values = [], order = 3) {
  if (values.length < 2) return null;
  const average = mean(values);
  const sigma = sampleStdDev(values);
  if (!sigma) return null;
  return values.reduce((sum, value) => sum + ((value - average) / sigma) ** order, 0) / values.length;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const value = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * value);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-value * value);
  return sign * y;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function computeDeflatedSharpeProxy({
  returns = [],
  observedSharpe = null,
  benchmarkSharpe = 0,
  trials = 1,
  skewness = null,
  kurtosis = null,
  minReturns = DEFAULT_MIN_RETURNS,
} = {}) {
  const cleanReturns = finiteNumbers(returns);
  const blockers = [];
  if (cleanReturns.length < minReturns && !Number.isFinite(observedSharpe)) blockers.push(`min_${minReturns}_returns_required`);
  if (Number.isFinite(trials) && trials < 1) blockers.push("trials_must_be_positive");

  if (blockers.length > 0) {
    return {
      status: "insufficient_evidence",
      blockers,
      observations: cleanReturns.length,
      trials: Number.isFinite(trials) ? trials : null,
      sharpe: null,
      benchmarkSharpe: Number.isFinite(benchmarkSharpe) ? benchmarkSharpe : null,
      deflatedSharpeProxy: null,
      pValueProxy: null,
    };
  }

  const average = mean(cleanReturns);
  const sigma = sampleStdDev(cleanReturns);
  const sharpe = Number.isFinite(observedSharpe) ? observedSharpe : sigma > 0 ? average / sigma : 0;
  const effectiveTrials = Math.max(1, Math.floor(Number.isFinite(trials) ? trials : 1));
  const trialPenalty = Math.sqrt(2 * Math.log(effectiveTrials)) / Math.sqrt(Math.max(1, cleanReturns.length - 1));
  const adjustedBenchmark = (Number.isFinite(benchmarkSharpe) ? benchmarkSharpe : 0) + trialPenalty;
  const skew = Number.isFinite(skewness) ? skewness : sampleMoment(cleanReturns, 3) ?? 0;
  const kurt = Number.isFinite(kurtosis) ? kurtosis : sampleMoment(cleanReturns, 4) ?? 3;
  // Proxy for Bailey/Lopez de Prado DSR: keeps skew/kurtosis correction and trial deflation,
  // but uses a normal CDF approximation and an expected-max Sharpe penalty for reporting only.
  const denominator = Math.sqrt(Math.max(1e-12, 1 - skew * adjustedBenchmark + ((kurt - 1) / 4) * adjustedBenchmark ** 2));
  const statistic = ((sharpe - adjustedBenchmark) * Math.sqrt(Math.max(1, cleanReturns.length - 1))) / denominator;
  const probability = normalCdf(statistic);

  return {
    status: "reported",
    blockers: [],
    observations: cleanReturns.length,
    trials: effectiveTrials,
    sharpe: round(sharpe),
    benchmarkSharpe: round(adjustedBenchmark),
    skewness: round(skew),
    kurtosis: round(kurt),
    deflatedSharpeProxy: round(probability),
    pValueProxy: round(1 - probability),
  };
}

function combinations(indices, choose) {
  const out = [];
  function visit(start, selected) {
    if (selected.length === choose) {
      out.push([...selected]);
      return;
    }
    for (let index = start; index <= indices.length - (choose - selected.length); index += 1) {
      selected.push(indices[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  }
  visit(0, []);
  return out;
}

function columnMeans(matrix, rows) {
  const width = matrix[0]?.length || 0;
  return Array.from({ length: width }, (_, column) => {
    const values = rows.map((row) => matrix[row]?.[column]).filter(Number.isFinite);
    return values.length ? mean(values) : -Infinity;
  });
}

function bestIndex(values = []) {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[best]) best = index;
  }
  return best;
}

export function computeCscvPbo({ performanceMatrix = [], minPeriods = DEFAULT_MIN_PERIODS, minVariants = DEFAULT_MIN_VARIANTS } = {}) {
  const matrix = (performanceMatrix || []).map((row) => finiteNumbers(row));
  const variantCount = matrix[0]?.length || 0;
  const blockers = [];
  if (matrix.length < minPeriods) blockers.push(`min_${minPeriods}_periods_required`);
  if (variantCount < minVariants) blockers.push(`min_${minVariants}_strategy_variants_required`);
  if (matrix.some((row) => row.length !== variantCount)) blockers.push("rectangular_performance_matrix_required");
  if (matrix.length % 2 !== 0) blockers.push("even_period_count_required");

  if (blockers.length > 0) {
    return {
      status: "insufficient_evidence",
      blockers,
      periodCount: matrix.length,
      variantCount,
      combinationCount: 0,
      pbo: null,
      logitMean: null,
    };
  }

  const allRows = matrix.map((_, index) => index);
  const splits = combinations(allRows, matrix.length / 2);
  let overfitCount = 0;
  const logits = [];

  for (const inSampleRows of splits) {
    const inSet = new Set(inSampleRows);
    const outSampleRows = allRows.filter((index) => !inSet.has(index));
    const winner = bestIndex(columnMeans(matrix, inSampleRows));
    const oosScores = columnMeans(matrix, outSampleRows);
    const betterOrEqual = oosScores.filter((score) => score >= oosScores[winner]).length;
    const rankPercentile = (variantCount - betterOrEqual + 1) / variantCount;
    const clamped = Math.min(1 - 1e-12, Math.max(1e-12, rankPercentile));
    const logit = Math.log(clamped / (1 - clamped));
    logits.push(logit);
    if (rankPercentile <= 0.5) overfitCount += 1;
  }

  // CSCV/PBO proxy: exhaustive half-sample splits, IS winner, then OOS rank logit.
  // It assumes input cells are already comparable net returns/scores.
  return {
    status: "reported",
    blockers: [],
    periodCount: matrix.length,
    variantCount,
    combinationCount: splits.length,
    pbo: round(overfitCount / splits.length),
    logitMean: round(mean(logits)),
  };
}

export function computeWalkForwardEfficiency({ folds = [], minFolds = DEFAULT_MIN_FOLDS } = {}) {
  const cleanFolds = (folds || [])
    .map((fold) => ({
      inSample: Number(fold?.inSample ?? fold?.inSampleReturn ?? fold?.is),
      outOfSample: Number(fold?.outOfSample ?? fold?.outOfSampleReturn ?? fold?.oos),
    }))
    .filter((fold) => Number.isFinite(fold.inSample) && Number.isFinite(fold.outOfSample));
  const blockers = [];
  if (cleanFolds.length < minFolds) blockers.push(`min_${minFolds}_folds_required`);
  if (cleanFolds.some((fold) => fold.inSample <= 0)) blockers.push("positive_in_sample_required");

  if (blockers.length > 0) {
    return {
      status: "insufficient_evidence",
      blockers,
      foldCount: cleanFolds.length,
      wfe: null,
      positiveFoldRate: null,
    };
  }

  const ratios = cleanFolds.map((fold) => fold.outOfSample / fold.inSample);
  // Conservative WFE: negative OOS folds remain negative in the average instead of being clipped.
  return {
    status: "reported",
    blockers: [],
    foldCount: cleanFolds.length,
    wfe: round(mean(ratios)),
    positiveFoldRate: round(cleanFolds.filter((fold) => fold.outOfSample > 0).length / cleanFolds.length),
  };
}

export function buildAdvancedOverfitStatistics(input = {}) {
  const deflatedSharpe = computeDeflatedSharpeProxy(input.deflatedSharpe || input.dsr || {});
  const cscvPbo = computeCscvPbo(input.cscvPbo || input.pbo || {});
  const walkForwardEfficiency = computeWalkForwardEfficiency(input.walkForwardEfficiency || input.wfe || {});
  const sections = { deflatedSharpe, cscvPbo, walkForwardEfficiency };
  const blockers = Object.entries(sections).flatMap(([key, section]) =>
    (section.blockers || []).map((blocker) => `${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}:${blocker}`),
  );

  return {
    status: blockers.length > 0 ? "insufficient_evidence" : "reported",
    enforcement: "reporting_only",
    blockers,
    metrics: {
      deflatedSharpeProxy: deflatedSharpe.deflatedSharpeProxy,
      pbo: cscvPbo.pbo,
      wfe: walkForwardEfficiency.wfe,
    },
    sections,
  };
}
