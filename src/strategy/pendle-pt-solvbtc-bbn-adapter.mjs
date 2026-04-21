// T9 — S2 adapter scaffold: PT-SolvBTC.BBN direct entry on BSC via
// BOB Gateway Custom Action.
//
// Single-tx atomic flow: native BTC (L1) → Gateway createOrder with
// destination = PT-SolvBTC.BBN on BSC, executed via a Pendle-aware
// Custom Action. No separate lending loop. Pure evaluator. No I/O,
// no LLM, no signing.
//
// Key differences from S1 (Pendle PT-LBTC):
//   - No collateral + borrow legs; PT is purchased directly from BTC.
//   - Custom Action atomicity is the policy hinge: a partial fill or
//     failed inner step must revert the outer order.
//   - Withdrawal path is offramp-only (PT redeem at maturity → Solv
//     redeem → wBTC.OFT → Gateway offramp → native BTC).

const STRATEGY_ID = "pendle-pt-solvbtc-bbn-bsc";

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "Pendle PT-SolvBTC.BBN direct (BSC, Gateway Custom Action)",
  strategyType: "fixed_yield_pt_direct",
  isLeverage: false,
  chain: "bsc",
  ytProtocol: "pendle",
  underlyingProtocol: "solv",
  sourceAsset: "BTC",
  intermediateAsset: "SolvBTC.BBN",
  targetAsset: "PT-SolvBTC.BBN",
  perTradeCapUsd: 0, // shadow until receipts
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  maxDaysToMaturity: 180,
  minDaysToMaturity: 7,
  minPtImpliedAprBps: 500, // 5% implied APR floor
  maxEntrySlippageBps: 35,
  maxExitSlippageBps: 60,
  maxCustomActionFailureRateBps: 200, // 2%
  minPtLiquidityUsd: 250_000,
  maxRoundTripCostBps: 80, // gateway + redeem + offramp
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "ytProtocol",
  "underlyingProtocol",
  "sourceAsset",
  "intermediateAsset",
  "targetAsset",
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "maxDaysToMaturity",
  "minDaysToMaturity",
  "minPtImpliedAprBps",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
  "maxCustomActionFailureRateBps",
  "minPtLiquidityUsd",
  "maxRoundTripCostBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "ytProtocol",
  "underlyingProtocol",
  "sourceAsset",
  "intermediateAsset",
  "targetAsset",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultPendlePtSolvBtcConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validatePendlePtSolvBtcConfig(config = {}) {
  const missingFields = [];
  const errors = [];
  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (STRING_CONFIG_FIELDS.includes(field)) {
      if (typeof config[field] !== "string" || config[field].length === 0) {
        missingFields.push(field);
      }
    } else if (!Number.isFinite(config[field])) {
      missingFields.push(field);
    }
  }
  if (
    Number.isFinite(config.minDaysToMaturity) &&
    Number.isFinite(config.maxDaysToMaturity) &&
    config.minDaysToMaturity >= config.maxDaysToMaturity
  ) {
    errors.push("minDaysToMaturity must be < maxDaysToMaturity");
  }
  if (Number.isFinite(config.maxDailyLossUsd) && config.maxDailyLossUsd <= 0) {
    errors.push("maxDailyLossUsd must be positive");
  }
  if (
    Number.isFinite(config.maxRoundTripCostBps) &&
    config.maxRoundTripCostBps <= 0
  ) {
    errors.push("maxRoundTripCostBps must be positive");
  }
  if (
    Number.isFinite(config.maxCustomActionFailureRateBps) &&
    config.maxCustomActionFailureRateBps < 0
  ) {
    errors.push("maxCustomActionFailureRateBps must be ≥ 0");
  }
  if (config.chain !== "bsc") {
    errors.push("chain must be 'bsc' (Gateway Custom Action target)");
  }
  return Object.freeze({
    ok: missingFields.length === 0 && errors.length === 0,
    missingFields: Object.freeze(missingFields),
    errors: Object.freeze(errors),
  });
}

function assessMarket(market = {}) {
  const blockers = [];
  const ptImpliedAprBps = finite(market.ptImpliedAprBps);
  const daysToMaturity = finite(market.daysToMaturity);
  const ptLiquidityUsd = finite(market.ptLiquidityUsd);
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const solvBtcPegDeviationBps = finite(market.solvBtcPegDeviationBps);
  const customActionFailureRateBps = finite(market.customActionFailureRateBps);
  const gatewayQuoteFresh = market.gatewayQuoteFresh === true;
  const gatewayCustomActionAvailable = market.gatewayCustomActionAvailable === true;
  const gatewayRoundTripCostBps = finite(market.gatewayRoundTripCostBps);

  if (ptImpliedAprBps == null) blockers.push("pt_implied_apr_missing");
  if (daysToMaturity == null) blockers.push("pt_maturity_missing");
  if (ptLiquidityUsd == null) blockers.push("pt_liquidity_unobserved");
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (solvBtcPegDeviationBps == null) blockers.push("solvbtc_peg_unmeasured");
  if (customActionFailureRateBps == null) {
    blockers.push("custom_action_failure_rate_unmeasured");
  }
  if (!gatewayQuoteFresh) blockers.push("gateway_quote_stale_or_unknown");
  if (!gatewayCustomActionAvailable) {
    blockers.push("gateway_custom_action_unavailable");
  }
  if (gatewayRoundTripCostBps == null) {
    blockers.push("gateway_round_trip_cost_unmeasured");
  }

  return {
    blockers,
    ptImpliedAprBps,
    daysToMaturity,
    ptLiquidityUsd,
    entrySlippageBps,
    exitSlippageBps,
    solvBtcPegDeviationBps,
    customActionFailureRateBps,
    gatewayQuoteFresh,
    gatewayCustomActionAvailable,
    gatewayRoundTripCostBps,
  };
}

function policyGates(config, market) {
  const gates = [];
  if (
    market.daysToMaturity != null &&
    config.minDaysToMaturity != null &&
    market.daysToMaturity < config.minDaysToMaturity
  ) {
    gates.push("maturity_too_near");
  }
  if (
    market.daysToMaturity != null &&
    config.maxDaysToMaturity != null &&
    market.daysToMaturity > config.maxDaysToMaturity
  ) {
    gates.push("maturity_too_far");
  }
  if (
    market.ptImpliedAprBps != null &&
    config.minPtImpliedAprBps != null &&
    market.ptImpliedAprBps < config.minPtImpliedAprBps
  ) {
    gates.push("pt_implied_apr_below_threshold");
  }
  if (
    market.ptLiquidityUsd != null &&
    config.minPtLiquidityUsd != null &&
    market.ptLiquidityUsd < config.minPtLiquidityUsd
  ) {
    gates.push("pt_liquidity_below_minimum");
  }
  if (
    market.entrySlippageBps != null &&
    config.maxEntrySlippageBps != null &&
    market.entrySlippageBps > config.maxEntrySlippageBps
  ) {
    gates.push("entry_slippage_above_threshold");
  }
  if (
    market.exitSlippageBps != null &&
    config.maxExitSlippageBps != null &&
    market.exitSlippageBps > config.maxExitSlippageBps
  ) {
    gates.push("exit_slippage_above_threshold");
  }
  if (
    market.customActionFailureRateBps != null &&
    config.maxCustomActionFailureRateBps != null &&
    market.customActionFailureRateBps > config.maxCustomActionFailureRateBps
  ) {
    gates.push("custom_action_failure_rate_above_threshold");
  }
  if (
    market.gatewayRoundTripCostBps != null &&
    config.maxRoundTripCostBps != null &&
    market.gatewayRoundTripCostBps > config.maxRoundTripCostBps
  ) {
    gates.push("round_trip_cost_above_threshold");
  }
  if (
    market.solvBtcPegDeviationBps != null &&
    Math.abs(market.solvBtcPegDeviationBps) > 75
  ) {
    gates.push("solvbtc_peg_deviation_excessive");
  }
  return gates;
}

function projectedEconomics(config, market) {
  if (
    market.ptImpliedAprBps == null ||
    market.daysToMaturity == null ||
    market.gatewayRoundTripCostBps == null
  ) {
    return null;
  }
  const principalUsd = config.perTradeCapUsd;
  const ptYieldPct = (market.ptImpliedAprBps / 10_000) *
    (market.daysToMaturity / 365);
  const ptReturnUsd = principalUsd * ptYieldPct;
  const entrySlippageUsd = principalUsd *
    ((market.entrySlippageBps ?? 0) / 10_000);
  const exitSlippageUsd = principalUsd *
    ((market.exitSlippageBps ?? 0) / 10_000);
  const roundTripCostUsd = principalUsd *
    (market.gatewayRoundTripCostBps / 10_000);
  const netUsd =
    ptReturnUsd - entrySlippageUsd - exitSlippageUsd - roundTripCostUsd;
  return Object.freeze({
    principalUsd: round(principalUsd),
    ptReturnUsd: round(ptReturnUsd),
    entrySlippageUsd: round(entrySlippageUsd),
    exitSlippageUsd: round(exitSlippageUsd),
    gatewayRoundTripCostUsd: round(roundTripCostUsd),
    projectedNetUsd: round(netUsd),
  });
}

function receiptEvidence(receipts = []) {
  const signerBacked = receipts.filter((r) => r?.signerBacked === true);
  const passed = signerBacked.filter((r) => r?.result === "passed");
  const realized = passed.reduce(
    (sum, r) => sum + (Number(r.realizedNetUsd) || 0),
    0,
  );
  const customActionAtomic = signerBacked.filter(
    (r) => r?.customActionAtomic === true,
  );
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 ? round(realized) : null,
    hasMaturityRedemptionProof: signerBacked.some(
      (r) => r?.maturityRedemptionProven === true,
    ),
    customActionAtomicCount: customActionAtomic.length,
  });
}

export function evaluatePendlePtSolvBtcAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validatePendlePtSolvBtcConfig(config);
  const marketAssessment = assessMarket(market);
  const gates = policyGates(config, marketAssessment);
  const economics = projectedEconomics(config, marketAssessment);
  const evidence = receiptEvidence(receipts);

  const blockers = [
    ...(validation.ok ? [] : ["config_invalid"]),
    ...marketAssessment.blockers,
    ...gates,
  ];
  if (evidence.signerBackedCount === 0) {
    blockers.push("no_signer_backed_receipts");
  }
  if (!evidence.hasMaturityRedemptionProof) {
    blockers.push("maturity_redemption_unproven");
  }
  if (
    evidence.signerBackedCount > 0 &&
    evidence.customActionAtomicCount < evidence.signerBackedCount
  ) {
    blockers.push("custom_action_atomicity_unproven");
  }

  const shadowReady =
    validation.ok &&
    marketAssessment.blockers.length === 0 &&
    gates.length === 0 &&
    economics != null &&
    economics.projectedNetUsd > 0;

  const liveReady =
    shadowReady &&
    evidence.passedCount >= 3 &&
    evidence.realizedNetUsd != null &&
    evidence.realizedNetUsd > 0 &&
    evidence.hasMaturityRedemptionProof &&
    evidence.customActionAtomicCount === evidence.signerBackedCount;

  const intent = shadowReady || liveReady
    ? Object.freeze({
        strategyId: config?.id || STRATEGY_ID,
        chain: config?.chain || "bsc",
        amountUsd: config?.perTradeCapUsd || 0,
        intentType: "entry",
        executionReason: "strategy_tick",
      })
    : null;

  return Object.freeze({
    strategyId: config?.id || STRATEGY_ID,
    generatedAt: typeof now === "string" ? now : null,
    validation,
    market: Object.freeze({
      ...marketAssessment,
      blockers: Object.freeze(marketAssessment.blockers),
    }),
    gates: Object.freeze(gates),
    economics,
    evidence,
    blockers: Object.freeze(blockers),
    shadowReady,
    liveReady,
    mode: liveReady
      ? "live_candidate"
      : shadowReady
      ? "shadow_ready"
      : "blocked",
    intent,
    microCanaryStatus: evidence.signerBackedCount >= 3 ? "micro_canary_repeatable" : evidence.signerBackedCount > 0 ? "micro_canary_ready" : "not_started",
  });
}

export function summarizePendlePtSolvBtcAdapter(report) {
  if (!report) return null;
  return Object.freeze({
    strategyId: report.strategyId,
    mode: report.mode,
    blockerCount: report.blockers.length,
    topBlocker: report.blockers[0] || null,
    projectedNetUsd: report.economics?.projectedNetUsd ?? null,
    signerBackedReceipts: report.evidence.signerBackedCount,
    customActionAtomicCount: report.evidence.customActionAtomicCount,
  });
}

export const PENDLE_PT_SOLVBTC_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
