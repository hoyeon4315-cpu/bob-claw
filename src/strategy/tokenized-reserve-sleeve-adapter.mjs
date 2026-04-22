// W4-C — Tokenized reserve sleeve adapter scaffold.
//
// Strategy: hold a tokenized BTC reserve (e.g. PT-SolvBTC.BBN, SolvBTC,
// or other wrapped/locked BTC derivative) as a non-leveraged yield sleeve.
// Income comes from the tokenized instrument's implied yield minus entry,
// exit, and round-trip Gateway costs.
//
// Pure evaluator. No I/O, no LLM, no signing.

const STRATEGY_ID = "tokenized_reserve_sleeve";

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "Tokenized reserve sleeve",
  strategyType: "tokenized_reserve_hold",
  isLeverage: false,
  chain: "bsc",
  reserveProtocol: "pendle", // or "solv", "etherfi", "bedrock"
  sourceAsset: "BTC",
  reserveAsset: "PT-SolvBTC.BBN",
  perTradeCapUsd: 0,
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  maxDaysToMaturity: 180,
  minDaysToMaturity: 7,
  minReserveImpliedAprBps: 500, // 5% APR floor
  maxEntrySlippageBps: 35,
  maxExitSlippageBps: 60,
  minReserveLiquidityUsd: 250_000,
  maxRoundTripCostBps: 80,
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "reserveProtocol",
  "sourceAsset",
  "reserveAsset",
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "maxDaysToMaturity",
  "minDaysToMaturity",
  "minReserveImpliedAprBps",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
  "minReserveLiquidityUsd",
  "maxRoundTripCostBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "reserveProtocol",
  "sourceAsset",
  "reserveAsset",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultTokenizedReserveConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validateTokenizedReserveConfig(config = {}) {
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
  return Object.freeze({
    ok: missingFields.length === 0 && errors.length === 0,
    missingFields: Object.freeze(missingFields),
    errors: Object.freeze(errors),
  });
}

function assessMarket(market = {}) {
  const blockers = [];
  const reserveImpliedAprBps = finite(market.reserveImpliedAprBps);
  const daysToMaturity = finite(market.daysToMaturity);
  const reserveLiquidityUsd = finite(market.reserveLiquidityUsd);
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const gatewayQuoteFresh = market.gatewayQuoteFresh === true;
  const gatewayRoundTripCostBps = finite(market.gatewayRoundTripCostBps);
  const reservePegDeviationBps = finite(market.reservePegDeviationBps);

  if (reserveImpliedAprBps == null) blockers.push("reserve_implied_apr_missing");
  if (daysToMaturity == null) blockers.push("reserve_maturity_missing");
  if (reserveLiquidityUsd == null) blockers.push("reserve_liquidity_unobserved");
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (!gatewayQuoteFresh) blockers.push("gateway_quote_stale_or_unknown");
  if (gatewayRoundTripCostBps == null) {
    blockers.push("gateway_round_trip_cost_unmeasured");
  }
  if (reservePegDeviationBps == null) {
    blockers.push("reserve_peg_deviation_unmeasured");
  }

  return {
    blockers,
    reserveImpliedAprBps,
    daysToMaturity,
    reserveLiquidityUsd,
    entrySlippageBps,
    exitSlippageBps,
    gatewayQuoteFresh,
    gatewayRoundTripCostBps,
    reservePegDeviationBps,
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
    market.reserveImpliedAprBps != null &&
    config.minReserveImpliedAprBps != null &&
    market.reserveImpliedAprBps < config.minReserveImpliedAprBps
  ) {
    gates.push("reserve_implied_apr_below_threshold");
  }
  if (
    market.reserveLiquidityUsd != null &&
    config.minReserveLiquidityUsd != null &&
    market.reserveLiquidityUsd < config.minReserveLiquidityUsd
  ) {
    gates.push("reserve_liquidity_below_minimum");
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
    market.gatewayRoundTripCostBps != null &&
    config.maxRoundTripCostBps != null &&
    market.gatewayRoundTripCostBps > config.maxRoundTripCostBps
  ) {
    gates.push("round_trip_cost_above_threshold");
  }
  if (
    market.reservePegDeviationBps != null &&
    Math.abs(market.reservePegDeviationBps) > 75
  ) {
    gates.push("reserve_peg_deviation_excessive");
  }
  return gates;
}

function projectedEconomics(config, market) {
  if (
    market.reserveImpliedAprBps == null ||
    market.daysToMaturity == null ||
    market.gatewayRoundTripCostBps == null
  ) {
    return null;
  }
  const principalUsd = config.perTradeCapUsd;
  const horizonDays = Math.min(market.daysToMaturity, 90);
  const yieldPct =
    (market.reserveImpliedAprBps / 10_000) * (horizonDays / 365);
  const yieldUsd = principalUsd * yieldPct;
  const entrySlippageUsd =
    principalUsd * ((market.entrySlippageBps ?? 0) / 10_000);
  const exitSlippageUsd =
    principalUsd * ((market.exitSlippageBps ?? 0) / 10_000);
  const roundTripCostUsd =
    principalUsd * (market.gatewayRoundTripCostBps / 10_000);
  const netUsd =
    yieldUsd - entrySlippageUsd - exitSlippageUsd - roundTripCostUsd;
  return Object.freeze({
    horizonDays,
    principalUsd: round(principalUsd),
    yieldUsd: round(yieldUsd),
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
  const hasMaturityRedemptionProof = signerBacked.some(
    (r) => r?.maturityRedemptionProven === true,
  );
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 ? round(realized) : null,
    hasMaturityRedemptionProof,
  });
}

export function evaluateTokenizedReserveAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validateTokenizedReserveConfig(config);
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
    evidence.hasMaturityRedemptionProof;

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
    microCanaryStatus: evidence.signerBackedCount >= 3
      ? "micro_canary_repeatable"
      : evidence.signerBackedCount >= 1
        ? "minimal_live_proof_exists"
        : shadowReady
          ? "micro_canary_ready"
          : "not_started",
  });
}

export function summarizeTokenizedReserveAdapter(report) {
  if (!report) return null;
  return Object.freeze({
    strategyId: report.strategyId,
    mode: report.mode,
    blockerCount: report.blockers.length,
    topBlocker: report.blockers[0] || null,
    projectedNetUsd: report.economics?.projectedNetUsd ?? null,
    signerBackedReceipts: report.evidence.signerBackedCount,
  });
}

export const TOKENIZED_RESERVE_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
