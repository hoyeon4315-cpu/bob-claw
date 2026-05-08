import { buildAutoPromotionConfig } from "../config/auto-promotion.mjs";
import { evaluateAutoPromotion } from "../executor/auto-promotion-gate.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REQUIRED_REGIMES = Object.freeze(["bear", "neutral", "bull_peak"]);

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function absFiniteNumber(value) {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.abs(parsed);
}

function timestampMsFor(record = {}) {
  const candidates = [
    record.observedAt,
    record.timestamp,
    record.generatedAt,
    record.receipt?.observedAt,
    record.lifecycle?.observedAt,
    record.metadata?.observedAt,
  ];
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate || "");
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function strategyIdFor(record = {}) {
  return record.strategyId
    || record.receipt?.strategyId
    || record.receiptIngest?.receiptRecord?.strategyId
    || record.execution?.receiptIngest?.receiptRecord?.strategyId
    || record.metadata?.strategyId
    || record.intent?.metadata?.strategyId
    || null;
}

function matchesStrategy(record, strategyId) {
  if (!strategyId) return false;
  return strategyIdFor(record) === strategyId;
}

function pnlUsdFor(record = {}) {
  return finiteNumber(record.realized?.realizedNetPnlUsd)
    ?? finiteNumber(record.receiptIngest?.receiptRecord?.realized?.realizedNetPnlUsd)
    ?? finiteNumber(record.execution?.receiptIngest?.receiptRecord?.realized?.realizedNetPnlUsd)
    ?? finiteNumber(record.realizedNetPnlUsd)
    ?? finiteNumber(record.realizedNetCarryUsd)
    ?? finiteNumber(record.routeContext?.estimatedNetPnlUsd)
    ?? null;
}

function costUsdFor(record = {}) {
  return absFiniteNumber(record.realized?.actualKnownCostUsd)
    ?? absFiniteNumber(record.actualKnownCostUsd)
    ?? absFiniteNumber(record.actualLoopFeesUsd)
    ?? absFiniteNumber(record.actualUnwindCostUsd)
    ?? absFiniteNumber(record.routeContext?.estimatedExecutionGasUsd)
    ?? absFiniteNumber(record.routeContext?.estimatedNativeCostUsd)
    ?? null;
}

function slippagePctFor(record = {}) {
  const realizedBps = finiteNumber(record.realized?.realizedFillVsEstimateBps);
  if (realizedBps !== null) return Math.abs(realizedBps) / 100;
  const directPct = finiteNumber(record.slippagePct)
    ?? finiteNumber(record.execution?.slippagePct)
    ?? finiteNumber(record.metadata?.slippagePct)
    ?? null;
  return directPct === null ? null : Math.abs(directPct);
}

function oracleDivergencePctFor(record = {}) {
  const direct = finiteNumber(record.oracleDivergencePct)
    ?? finiteNumber(record.execution?.oracleDivergencePct)
    ?? finiteNumber(record.metadata?.oracleDivergencePct)
    ?? finiteNumber(record.priceValidation?.oracleDivergencePct)
    ?? finiteNumber(record.priceValidation?.maxDivergencePct)
    ?? null;
  return direct === null ? null : Math.abs(direct);
}

function regimeFor(record = {}) {
  const value = record.regime
    || record.marketRegime
    || record.marketState?.regime
    || record.metadata?.regime
    || record.receiptIngest?.receiptRecord?.regime
    || record.execution?.receiptIngest?.receiptRecord?.regime
    || null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lifecycleStageFor(record = {}) {
  return String(record.lifecycle?.stage || record.stage || record.status || "").toLowerCase();
}

function isAuditQuoteSuccess(record = {}) {
  const verdict = String(record.policyVerdict || record.policy?.verdict || "").toLowerCase();
  const stage = lifecycleStageFor(record);
  if (record.error) return false;
  if (["rejected", "errored", "error", "failed"].includes(stage)) return false;
  return verdict === "approved" || ["dry_run_recorded", "shadow_recorded", "simulated", "signed", "broadcasted", "confirmed"].includes(stage);
}

function quantile(values, pct) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * pct) - 1));
  return clean[index];
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function maxConsecutivePositive(samples) {
  let current = 0;
  let best = 0;
  for (const sample of samples) {
    if (sample.pnlUsd !== null && sample.pnlUsd > 0) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function buildSamples({ strategyId, signerAuditRecords = [], receiptRecords = [] } = {}) {
  const receiptSamples = [];
  for (const record of receiptRecords || []) {
    if (!matchesStrategy(record, strategyId)) continue;
    const timestampMs = timestampMsFor(record);
    receiptSamples.push({
      source: record.source || record.receiptSource || "receipt_store",
      timestampMs,
      observedAt: timestampMs === null ? null : new Date(timestampMs).toISOString(),
      pnlUsd: pnlUsdFor(record),
      costUsd: costUsdFor(record),
      slippagePct: slippagePctFor(record),
      oracleDivergencePct: oracleDivergencePctFor(record),
      regime: regimeFor(record),
    });
  }

  const auditSamples = [];
  for (const record of signerAuditRecords || []) {
    if (!matchesStrategy(record, strategyId)) continue;
    const timestampMs = timestampMsFor(record);
    auditSamples.push({
      source: "signer_audit_log",
      timestampMs,
      observedAt: timestampMs === null ? null : new Date(timestampMs).toISOString(),
      pnlUsd: pnlUsdFor(record),
      costUsd: costUsdFor(record),
      slippagePct: slippagePctFor(record),
      oracleDivergencePct: oracleDivergencePctFor(record),
      regime: regimeFor(record),
      auditQuoteSuccess: isAuditQuoteSuccess(record),
    });
  }

  const combined = [...receiptSamples, ...auditSamples].sort((a, b) => {
    const left = a.timestampMs ?? 0;
    const right = b.timestampMs ?? 0;
    return left - right;
  });

  return { receiptSamples, auditSamples, combined };
}

function buildWalkForward(samples, config) {
  const pnlSamples = samples.filter((sample) => sample.pnlUsd !== null);
  const pnl = pnlSamples.map((sample) => sample.pnlUsd);
  const samplePeriods = pnlSamples.length;
  const mean = pnl.length ? pnl.reduce((sum, value) => sum + value, 0) / pnl.length : null;
  const variance =
    pnl.length > 1 && mean !== null
      ? pnl.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (pnl.length - 1)
      : null;
  const std = variance === null ? null : Math.sqrt(variance);
  const sharpe =
    mean === null || std === null
      ? null
      : std === 0
        ? mean > 0 ? 99 : 0
        : mean / std * Math.sqrt(pnl.length);

  let equity = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  let absPnlTotal = 0;
  for (const value of pnl) {
    equity += value;
    absPnlTotal += Math.abs(value);
    peak = Math.max(peak, equity);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - equity);
  }
  const maxDrawdownPct = pnl.length ? (absPnlTotal > 0 ? maxDrawdownUsd / absPnlTotal * 100 : 0) : null;

  const knownRegimes = samples
    .filter((sample) => sample.regime && sample.regime !== "unknown")
    .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
    .map((sample) => sample.regime);
  let regimeChanges = knownRegimes.length ? 0 : null;
  for (let index = 1; index < knownRegimes.length; index += 1) {
    if (knownRegimes[index] !== knownRegimes[index - 1]) regimeChanges += 1;
  }

  const incomplete = [];
  if (sharpe === null) incomplete.push("walkForward.sharpe");
  if (maxDrawdownPct === null) incomplete.push("walkForward.maxDrawdownPct");
  if (regimeChanges === null) incomplete.push("walkForward.regimeChanges");
  if (samplePeriods < config.walkForward.minSamplePeriods) incomplete.push("walkForward.samplePeriods");

  return {
    value: {
      sharpe: round(sharpe),
      maxDrawdownPct: round(maxDrawdownPct),
      regimeChanges,
      samplePeriods,
    },
    incomplete,
  };
}

function buildOosHoldout(samples, config) {
  const pnlSamples = samples
    .filter((sample) => sample.pnlUsd !== null && sample.timestampMs !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const holdoutCount = Math.max(1, Math.ceil(pnlSamples.length * 0.30));
  const holdout = pnlSamples.slice(-holdoutCount);
  const first = holdout[0]?.timestampMs ?? null;
  const last = holdout.at(-1)?.timestampMs ?? null;
  const holdoutDays = first !== null && last !== null ? (last - first) / DAY_MS : null;
  const netPnlUsd = holdout.reduce((sum, sample) => sum + sample.pnlUsd, 0);
  const incomplete = [];
  if (pnlSamples.length < config.walkForward.minSamplePeriods) incomplete.push("oosHoldout.samplePeriods");
  if (holdoutDays === null || holdoutDays < config.oosHoldout.minHoldoutDays) incomplete.push("oosHoldout.holdoutDays");

  return {
    value: {
      holdoutDays: round(holdoutDays),
      netPositive: holdout.length ? netPnlUsd > 0 : null,
      netPnlUsd: round(holdout.length ? netPnlUsd : null),
      sampleCount: holdout.length,
    },
    incomplete,
  };
}

function buildRegimeBreakdown(samples, config) {
  const requiredRegimes = config.regimeBreakdown.requiredRegimes || DEFAULT_REQUIRED_REGIMES;
  const breakdown = {};
  for (const regime of requiredRegimes) {
    breakdown[regime] = { sampleCount: 0, netPnlUsd: 0 };
  }
  for (const sample of samples) {
    if (sample.pnlUsd === null || !sample.regime || !requiredRegimes.includes(sample.regime)) continue;
    breakdown[sample.regime].sampleCount += 1;
    breakdown[sample.regime].netPnlUsd += sample.pnlUsd;
  }
  const incomplete = [];
  for (const regime of requiredRegimes) {
    breakdown[regime].netPnlUsd = round(breakdown[regime].netPnlUsd);
    if (breakdown[regime].sampleCount < config.regimeBreakdown.minSamplesPerRegime) {
      incomplete.push(`regimeBreakdown.${regime}`);
    }
  }
  return { value: breakdown, incomplete };
}

function buildShadow({ receiptSamples, auditSamples }, config) {
  const pnlSamples = receiptSamples
    .filter((sample) => sample.pnlUsd !== null)
    .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  const totalNetPnlUsd = pnlSamples.reduce((sum, sample) => sum + sample.pnlUsd, 0);
  const quoteRecords = auditSamples.filter((sample) => sample.auditQuoteSuccess !== undefined);
  const quoteSuccessCount = quoteRecords.filter((sample) => sample.auditQuoteSuccess).length;
  const quoteSuccessRate = quoteRecords.length ? quoteSuccessCount / quoteRecords.length : null;
  const consecutivePositivePeriods = pnlSamples.length ? maxConsecutivePositive(pnlSamples) : null;
  const incomplete = [];
  if (consecutivePositivePeriods === null) incomplete.push("shadow.consecutivePositivePeriods");
  if (pnlSamples.length === 0) incomplete.push("shadow.netOfMeasuredCost");
  if (quoteSuccessRate === null) incomplete.push("shadow.quoteSuccessRate");
  if (
    consecutivePositivePeriods !== null &&
    consecutivePositivePeriods < config.shadow.consecutivePositivePeriodsMin
  ) {
    incomplete.push("shadow.consecutivePositivePeriodsBelowPolicy");
  }

  return {
    value: {
      consecutivePositivePeriods,
      netOfMeasuredCost: pnlSamples.length ? totalNetPnlUsd > 0 : null,
      totalNetPnlUsd: round(pnlSamples.length ? totalNetPnlUsd : null),
      quoteSuccessRate: round(quoteSuccessRate),
      quoteSuccessCount,
      quoteAttemptCount: quoteRecords.length,
    },
    incomplete,
  };
}

function buildExecution(samples) {
  const oracleValues = samples.map((sample) => sample.oracleDivergencePct).filter((value) => value !== null);
  const slippageValues = samples.map((sample) => sample.slippagePct).filter((value) => value !== null);
  const pnlValues = samples.map((sample) => sample.pnlUsd).filter((value) => value !== null);
  const costValues = samples.map((sample) => sample.costUsd).filter((value) => value !== null);
  const totalPnlUsd = pnlValues.reduce((sum, value) => sum + value, 0);
  const p90CostUsd = quantile(costValues, 0.90);
  const edgeAboveCostVariance =
    pnlValues.length && p90CostUsd !== null
      ? totalPnlUsd > p90CostUsd
      : null;
  const incomplete = [];
  if (oracleValues.length === 0) incomplete.push("execution.oracleDivergencePct");
  if (slippageValues.length === 0) incomplete.push("execution.slippagePct");
  if (edgeAboveCostVariance === null) incomplete.push("execution.edgeAboveCostVariance");

  return {
    value: {
      oracleDivergencePct: round(oracleValues.length ? Math.max(...oracleValues) : null),
      slippagePct: round(slippageValues.length ? Math.max(...slippageValues) : null),
      edgeAboveCostVariance,
      totalPnlUsd: round(pnlValues.length ? totalPnlUsd : null),
      p90CostUsd: round(p90CostUsd),
      measuredCostSampleCount: costValues.length,
    },
    incomplete,
  };
}

export function buildPhase3Evidence({
  strategyId,
  signerAuditRecords = [],
  receiptRecords = [],
  now = new Date().toISOString(),
  config = buildAutoPromotionConfig(),
} = {}) {
  if (!strategyId || typeof strategyId !== "string") {
    throw new Error("strategyId is required");
  }

  const samples = buildSamples({ strategyId, signerAuditRecords, receiptRecords });
  const walkForward = buildWalkForward(samples.receiptSamples, config);
  const oosHoldout = buildOosHoldout(samples.receiptSamples, config);
  const regimeBreakdown = buildRegimeBreakdown(samples.receiptSamples, config);
  const shadow = buildShadow(samples, config);
  const execution = buildExecution([...samples.receiptSamples, ...samples.auditSamples]);
  const incomplete = [
    ...walkForward.incomplete,
    ...oosHoldout.incomplete,
    ...regimeBreakdown.incomplete,
    ...shadow.incomplete,
    ...execution.incomplete,
  ];
  const evidence = {
    schemaVersion: 1,
    strategyId,
    generatedAt: now,
    source: "signer_audit_and_receipt_store",
    sampleSummary: {
      signerAuditRecordCount: samples.auditSamples.length,
      receiptRecordCount: samples.receiptSamples.length,
      pnlSampleCount: samples.receiptSamples.filter((sample) => sample.pnlUsd !== null).length,
      observedFrom: samples.combined.find((sample) => sample.observedAt)?.observedAt || null,
      observedTo: [...samples.combined].reverse().find((sample) => sample.observedAt)?.observedAt || null,
    },
    walkForward: walkForward.value,
    oosHoldout: oosHoldout.value,
    regimeBreakdown: regimeBreakdown.value,
    shadow: shadow.value,
    execution: execution.value,
    incomplete: [...new Set(incomplete)].sort(),
  };
  const autoPromotion = evaluateAutoPromotion(evidence, config);
  return {
    ...evidence,
    autoPromotion: {
      ...autoPromotion,
      passed: evidence.incomplete.length === 0 && autoPromotion.passed,
      blockers: evidence.incomplete.length
        ? [...new Set(["phase3_evidence_incomplete", ...autoPromotion.blockers])]
        : autoPromotion.blockers,
    },
  };
}
