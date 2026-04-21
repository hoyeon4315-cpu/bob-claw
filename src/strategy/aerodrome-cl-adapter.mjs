// T10 — S3+S4 adapter scaffold: Aerodrome CL (concentrated liquidity)
// position manager + range/IL watcher on Base.
//
// Two pool variants are supported via config.poolVariant:
//   - "cbbtc_lbtc_tight"  (S3) — narrow-range BTC↔BTC pair, fee
//                                 income dominates; IL is small but
//                                 realized when the peg drifts.
//   - "cbbtc_usdc_incentive" (S4) — single-sided BTC vs stable, AERO
//                                    emissions + swap fees; IL is
//                                    structural, must be reserved.
//
// Pure evaluator. No I/O, no LLM, no signing. All numeric outputs
// frozen for byte-stable hashing.
//
// Promotion ladder (shared across variants):
//   blocked  → shadowReady  → live_candidate
//
//   shadowReady  : config valid + market measured + policy gates pass
//                  + projectedNetUsd > 0
//   live_candidate: shadowReady + ≥3 signer-backed passed receipts
//                  + realizedNetUsd > 0
//                  + rebalanceProven (≥1 full range reset on chain)
//                  + outOfRangeTimePct ≤ maxOutOfRangeTimePct
//                  + realizedIlBps ≤ maxRealizedIlBps

const STRATEGY_ID = "aerodrome-cl-base";

const POOL_VARIANTS = Object.freeze([
  "cbbtc_lbtc_tight",
  "cbbtc_usdc_incentive",
]);

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "Aerodrome CL (Base)",
  strategyType: "concentrated_liquidity_lp",
  isLeverage: false,
  chain: "base",
  protocol: "aerodrome",
  poolVariant: "cbbtc_lbtc_tight",
  sourceAsset: "BTC",
  bridgedAsset: "cbBTC",
  pairedAsset: "LBTC",
  perTradeCapUsd: 0, // shadow until receipts
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  // pool / market thresholds
  minPoolTvlUsd: 500_000,
  minPoolFeeAprBps: 400, // 4% fee APR floor
  // IL + range gates
  maxRealizedIlBps: 150, // 1.5% IL ceiling over evaluation window
  maxOutOfRangeTimePct: 30, // 30% out-of-range time blocks live promotion
  rangeHalfWidthBps: 25, // ±0.25% target half-width (tight BTC↔BTC)
  rebalanceCostUsdMax: 5,
  // execution
  maxEntrySlippageBps: 30,
  maxExitSlippageBps: 50,
  maxRoundTripCostBps: 80,
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "protocol",
  "poolVariant",
  "sourceAsset",
  "bridgedAsset",
  "pairedAsset",
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "minPoolTvlUsd",
  "minPoolFeeAprBps",
  "maxRealizedIlBps",
  "maxOutOfRangeTimePct",
  "rangeHalfWidthBps",
  "rebalanceCostUsdMax",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
  "maxRoundTripCostBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "protocol",
  "poolVariant",
  "sourceAsset",
  "bridgedAsset",
  "pairedAsset",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultAerodromeClConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validateAerodromeClConfig(config = {}) {
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
  if (config.chain !== "base") {
    errors.push("chain must be 'base' (Aerodrome venue)");
  }
  if (
    typeof config.poolVariant === "string" &&
    !POOL_VARIANTS.includes(config.poolVariant)
  ) {
    errors.push(
      `poolVariant must be one of: ${POOL_VARIANTS.join(", ")}`,
    );
  }
  if (Number.isFinite(config.maxDailyLossUsd) && config.maxDailyLossUsd <= 0) {
    errors.push("maxDailyLossUsd must be positive");
  }
  if (
    Number.isFinite(config.maxOutOfRangeTimePct) &&
    (config.maxOutOfRangeTimePct < 0 || config.maxOutOfRangeTimePct > 100)
  ) {
    errors.push("maxOutOfRangeTimePct must be between 0 and 100");
  }
  if (
    Number.isFinite(config.rangeHalfWidthBps) &&
    config.rangeHalfWidthBps <= 0
  ) {
    errors.push("rangeHalfWidthBps must be positive");
  }
  if (
    Number.isFinite(config.maxRealizedIlBps) &&
    config.maxRealizedIlBps < 0
  ) {
    errors.push("maxRealizedIlBps must be ≥ 0");
  }
  return Object.freeze({
    ok: missingFields.length === 0 && errors.length === 0,
    missingFields: Object.freeze(missingFields),
    errors: Object.freeze(errors),
  });
}

function assessMarket(market = {}) {
  const blockers = [];
  const poolTvlUsd = finite(market.poolTvlUsd);
  const poolFeeAprBps = finite(market.poolFeeAprBps);
  const incentiveAprBps = finite(market.incentiveAprBps); // may be 0 for tight pool
  const realizedIlBps = finite(market.realizedIlBps);
  const outOfRangeTimePct = finite(market.outOfRangeTimePct);
  const currentTickOffsetBps = finite(market.currentTickOffsetBps);
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const gatewayQuoteFresh = market.gatewayQuoteFresh === true;
  const gatewayRoundTripCostBps = finite(market.gatewayRoundTripCostBps);

  if (poolTvlUsd == null) blockers.push("pool_tvl_unobserved");
  if (poolFeeAprBps == null) blockers.push("pool_fee_apr_unmeasured");
  if (incentiveAprBps == null) blockers.push("incentive_apr_unmeasured");
  if (realizedIlBps == null) blockers.push("realized_il_unmeasured");
  if (outOfRangeTimePct == null) blockers.push("out_of_range_time_unmeasured");
  if (currentTickOffsetBps == null) {
    blockers.push("current_tick_offset_unmeasured");
  }
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (!gatewayQuoteFresh) blockers.push("gateway_quote_stale_or_unknown");
  if (gatewayRoundTripCostBps == null) {
    blockers.push("gateway_round_trip_cost_unmeasured");
  }

  return {
    blockers,
    poolTvlUsd,
    poolFeeAprBps,
    incentiveAprBps,
    realizedIlBps,
    outOfRangeTimePct,
    currentTickOffsetBps,
    entrySlippageBps,
    exitSlippageBps,
    gatewayQuoteFresh,
    gatewayRoundTripCostBps,
  };
}

function policyGates(config, market) {
  const gates = [];
  if (
    market.poolTvlUsd != null &&
    config.minPoolTvlUsd != null &&
    market.poolTvlUsd < config.minPoolTvlUsd
  ) {
    gates.push("pool_tvl_below_minimum");
  }
  if (
    market.poolFeeAprBps != null &&
    config.minPoolFeeAprBps != null &&
    market.poolFeeAprBps < config.minPoolFeeAprBps
  ) {
    gates.push("pool_fee_apr_below_threshold");
  }
  if (
    market.realizedIlBps != null &&
    config.maxRealizedIlBps != null &&
    market.realizedIlBps > config.maxRealizedIlBps
  ) {
    gates.push("realized_il_above_threshold");
  }
  if (
    market.outOfRangeTimePct != null &&
    config.maxOutOfRangeTimePct != null &&
    market.outOfRangeTimePct > config.maxOutOfRangeTimePct
  ) {
    gates.push("out_of_range_time_above_threshold");
  }
  if (
    market.currentTickOffsetBps != null &&
    config.rangeHalfWidthBps != null &&
    Math.abs(market.currentTickOffsetBps) > config.rangeHalfWidthBps
  ) {
    gates.push("current_price_outside_target_range");
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
  return gates;
}

function projectedEconomics(config, market) {
  if (
    market.poolFeeAprBps == null ||
    market.incentiveAprBps == null ||
    market.realizedIlBps == null ||
    market.gatewayRoundTripCostBps == null
  ) {
    return null;
  }
  // Project a 30-day window — long enough for fees+incentives to
  // accumulate and IL to crystallize on a tight pool.
  const principalUsd = config.perTradeCapUsd;
  const horizonDays = 30;
  const feeUsd = principalUsd *
    (market.poolFeeAprBps / 10_000) *
    (horizonDays / 365);
  const incentiveUsd = principalUsd *
    (market.incentiveAprBps / 10_000) *
    (horizonDays / 365);
  const ilUsd = principalUsd * (market.realizedIlBps / 10_000);
  const entrySlippageUsd = principalUsd *
    ((market.entrySlippageBps ?? 0) / 10_000);
  const exitSlippageUsd = principalUsd *
    ((market.exitSlippageBps ?? 0) / 10_000);
  const roundTripCostUsd = principalUsd *
    (market.gatewayRoundTripCostBps / 10_000);
  const netUsd =
    feeUsd + incentiveUsd
    - ilUsd
    - entrySlippageUsd - exitSlippageUsd
    - roundTripCostUsd;
  return Object.freeze({
    horizonDays,
    principalUsd: round(principalUsd),
    feeUsd: round(feeUsd),
    incentiveUsd: round(incentiveUsd),
    impermanentLossUsd: round(ilUsd),
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
  const rebalanceProvenCount = signerBacked.filter(
    (r) => r?.rebalanceProven === true,
  ).length;
  const ilWithinBoundsCount = signerBacked.filter(
    (r) => r?.realizedIlWithinBounds === true,
  ).length;
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 ? round(realized) : null,
    rebalanceProvenCount,
    ilWithinBoundsCount,
  });
}

export function evaluateAerodromeClAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validateAerodromeClConfig(config);
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
  if (
    evidence.signerBackedCount > 0 &&
    evidence.rebalanceProvenCount === 0
  ) {
    blockers.push("rebalance_unproven");
  }
  if (
    evidence.signerBackedCount > 0 &&
    evidence.ilWithinBoundsCount < evidence.signerBackedCount
  ) {
    blockers.push("realized_il_unbounded_in_receipts");
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
    evidence.rebalanceProvenCount > 0 &&
    evidence.ilWithinBoundsCount === evidence.signerBackedCount;

  const intent = shadowReady || liveReady
    ? Object.freeze({
        strategyId: config?.id || STRATEGY_ID,
        chain: config?.chain || "base",
        amountUsd: config?.perTradeCapUsd || 0,
        intentType: "entry",
        executionReason: "strategy_tick",
      })
    : null;

  return Object.freeze({
    strategyId: config?.id || STRATEGY_ID,
    poolVariant: config?.poolVariant || null,
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

export function summarizeAerodromeClAdapter(report) {
  if (!report) return null;
  return Object.freeze({
    strategyId: report.strategyId,
    poolVariant: report.poolVariant,
    mode: report.mode,
    blockerCount: report.blockers.length,
    topBlocker: report.blockers[0] || null,
    projectedNetUsd: report.economics?.projectedNetUsd ?? null,
    signerBackedReceipts: report.evidence.signerBackedCount,
    rebalanceProvenCount: report.evidence.rebalanceProvenCount,
  });
}

export const AERODROME_CL_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
export const AERODROME_CL_POOL_VARIANTS = POOL_VARIANTS;
