// T12 — S6 adapter scaffold: GMX V2 perp-basis on Avalanche.
//
// Strategy shape: long spot BTC-derivative (e.g. BTC.b) + short equal-
// size BTC perp on GMX V2. Net delta ≈ 0; carry comes from the funding
// rate paid by longs to shorts (when fundingRate > 0) plus any spot
// yield, minus borrow cost on the short side.
//
// This adapter is purely a scoring/promotion module. Funding-rate
// admission is delegated to `src/executor/risk/funding-rate-gate.mjs`
// (T3) and re-checked here at evaluation time. No I/O, no LLM, no
// signing. Frozen output for byte-stable hashing.
//
// Promotion ladder:
//   blocked → shadowReady → live_candidate
//
//   shadowReady   : config valid + market measured + funding gate
//                   action === "allow_entry" + policy gates pass
//                   + projectedNetUsd > 0
//   live_candidate: shadowReady + ≥3 signer-backed passed receipts
//                   + realizedNetUsd > 0
//                   + liquidationBufferProven (HF stayed above
//                     liquidationBufferPct on every receipt)
//                   + autoUnwindProven (≥1 funding-flip auto-exit
//                     completed without manual intervention)

import {
  evaluateFundingRateGate,
  FUNDING_RATE_THRESHOLDS,
} from "../executor/risk/funding-rate-gate.mjs";

const STRATEGY_ID = "gmx-v2-perp-basis-avax";

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "GMX V2 perp-basis (Avalanche)",
  strategyType: "delta_neutral_perp_basis",
  isLeverage: true,
  chain: "avalanche",
  perpProtocol: "gmx_v2",
  spotAsset: "BTC.b",
  perpMarketId: "BTC/USD",
  collateralAsset: "USDC",
  perTradeCapUsd: 0, // shadow until receipts
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  // leverage / liquidation discipline
  shortLeverage: 2.0,
  liquidationBufferPct: 25, // % of margin kept above maintenance
  healthFactorMin: 1.4,
  // basis economics
  minProjectedAnnualNetBps: 800, // 8% APR floor (post-cost)
  maxBorrowAprBps: 600,
  maxOpenInterestImbalancePct: 30,
  // execution
  maxEntrySlippageBps: 25,
  maxExitSlippageBps: 35,
  maxRoundTripCostBps: 90,
  // funding gate
  fundingThresholds: FUNDING_RATE_THRESHOLDS,
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "perpProtocol",
  "spotAsset",
  "perpMarketId",
  "collateralAsset",
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "shortLeverage",
  "liquidationBufferPct",
  "healthFactorMin",
  "minProjectedAnnualNetBps",
  "maxBorrowAprBps",
  "maxOpenInterestImbalancePct",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
  "maxRoundTripCostBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "perpProtocol",
  "spotAsset",
  "perpMarketId",
  "collateralAsset",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultGmxBasisConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validateGmxBasisConfig(config = {}) {
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
  if (config.chain !== "avalanche") {
    errors.push("chain must be 'avalanche' (GMX V2 venue for this adapter)");
  }
  if (Number.isFinite(config.shortLeverage) && config.shortLeverage <= 0) {
    errors.push("shortLeverage must be positive");
  }
  if (Number.isFinite(config.shortLeverage) && config.shortLeverage > 5) {
    errors.push("shortLeverage capped at 5x for delta-neutral basis");
  }
  if (
    Number.isFinite(config.liquidationBufferPct) &&
    (config.liquidationBufferPct <= 0 || config.liquidationBufferPct > 100)
  ) {
    errors.push("liquidationBufferPct must be in (0, 100]");
  }
  if (Number.isFinite(config.healthFactorMin) && config.healthFactorMin < 1) {
    errors.push("healthFactorMin must be ≥ 1");
  }
  if (Number.isFinite(config.maxDailyLossUsd) && config.maxDailyLossUsd <= 0) {
    errors.push("maxDailyLossUsd must be positive");
  }
  return Object.freeze({
    ok: missingFields.length === 0 && errors.length === 0,
    missingFields: Object.freeze(missingFields),
    errors: Object.freeze(errors),
  });
}

function assessMarket(market = {}) {
  const blockers = [];
  const fundingSamples = Array.isArray(market.fundingRateAnnualizedSamples)
    ? market.fundingRateAnnualizedSamples
    : null;
  const recentNegativeDays = finite(market.recentNegativeDays);
  const borrowAprBps = finite(market.borrowAprBps);
  const openInterestImbalancePct = finite(market.openInterestImbalancePct);
  const spotPriceUsd = finite(market.spotPriceUsd);
  const perpMarkPriceUsd = finite(market.perpMarkPriceUsd);
  const perpLiquidityUsd = finite(market.perpLiquidityUsd);
  const projectedHealthFactor = finite(market.projectedHealthFactor);
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const gatewayQuoteFresh = market.gatewayQuoteFresh === true;
  const gatewayRoundTripCostBps = finite(market.gatewayRoundTripCostBps);

  if (!fundingSamples || fundingSamples.length === 0) {
    blockers.push("funding_rate_samples_unobserved");
  }
  if (recentNegativeDays == null) {
    blockers.push("funding_recent_negative_days_unmeasured");
  }
  if (borrowAprBps == null) blockers.push("borrow_apr_unmeasured");
  if (openInterestImbalancePct == null) {
    blockers.push("open_interest_imbalance_unmeasured");
  }
  if (spotPriceUsd == null) blockers.push("spot_price_unobserved");
  if (perpMarkPriceUsd == null) blockers.push("perp_mark_price_unobserved");
  if (perpLiquidityUsd == null) blockers.push("perp_liquidity_unobserved");
  if (projectedHealthFactor == null) {
    blockers.push("projected_health_factor_unmeasured");
  }
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (!gatewayQuoteFresh) blockers.push("gateway_quote_stale_or_unknown");
  if (gatewayRoundTripCostBps == null) {
    blockers.push("gateway_round_trip_cost_unmeasured");
  }

  return {
    blockers,
    fundingSamples,
    recentNegativeDays,
    borrowAprBps,
    openInterestImbalancePct,
    spotPriceUsd,
    perpMarkPriceUsd,
    perpLiquidityUsd,
    projectedHealthFactor,
    entrySlippageBps,
    exitSlippageBps,
    gatewayQuoteFresh,
    gatewayRoundTripCostBps,
  };
}

function policyGates(config, market, fundingVerdict) {
  const gates = [];
  if (
    fundingVerdict?.action &&
    fundingVerdict.action !== "allow_entry"
  ) {
    gates.push(`funding_gate_${fundingVerdict.action}`);
  }
  if (
    market.borrowAprBps != null &&
    config.maxBorrowAprBps != null &&
    market.borrowAprBps > config.maxBorrowAprBps
  ) {
    gates.push("borrow_apr_above_threshold");
  }
  if (
    market.openInterestImbalancePct != null &&
    config.maxOpenInterestImbalancePct != null &&
    Math.abs(market.openInterestImbalancePct) >
      config.maxOpenInterestImbalancePct
  ) {
    gates.push("open_interest_imbalance_excessive");
  }
  if (
    market.projectedHealthFactor != null &&
    config.healthFactorMin != null &&
    market.projectedHealthFactor < config.healthFactorMin
  ) {
    gates.push("projected_health_factor_below_minimum");
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
  // Spot/perp price divergence — large gap means stale or thin markets.
  if (
    market.spotPriceUsd != null &&
    market.perpMarkPriceUsd != null &&
    market.spotPriceUsd > 0
  ) {
    const divergenceBps = Math.abs(
      (market.perpMarkPriceUsd - market.spotPriceUsd) / market.spotPriceUsd,
    ) * 10_000;
    if (divergenceBps > 100) {
      gates.push("spot_perp_price_divergence_excessive");
    }
  }
  return gates;
}

function projectedEconomics(config, market, fundingVerdict) {
  if (
    market.borrowAprBps == null ||
    market.gatewayRoundTripCostBps == null
  ) {
    return null;
  }
  const ewmaRate = fundingVerdict?.details?.ewmaRate;
  if (!Number.isFinite(ewmaRate)) return null;

  const principalUsd = config.perTradeCapUsd;
  const horizonDays = 90;
  // Funding income on the SHORT notional (= principal on delta-neutral
  // basis, since long spot ≈ short perp notional).
  const fundingIncomeUsd =
    principalUsd * ewmaRate * (horizonDays / 365);
  // Borrow cost is paid on the perp leverage notional minus margin.
  const leveragedNotional = principalUsd * config.shortLeverage;
  const borrowCostUsd =
    leveragedNotional * (market.borrowAprBps / 10_000) * (horizonDays / 365);
  const entrySlippageUsd = principalUsd *
    ((market.entrySlippageBps ?? 0) / 10_000);
  const exitSlippageUsd = principalUsd *
    ((market.exitSlippageBps ?? 0) / 10_000);
  const roundTripCostUsd = principalUsd *
    (market.gatewayRoundTripCostBps / 10_000);
  const netUsd =
    fundingIncomeUsd
    - borrowCostUsd
    - entrySlippageUsd - exitSlippageUsd
    - roundTripCostUsd;
  // Annualized net bps from the 30d projection.
  const annualizedNetBps = principalUsd > 0
    ? round((netUsd / principalUsd) * (365 / horizonDays) * 10_000, 2)
    : null;
  return Object.freeze({
    horizonDays,
    principalUsd: round(principalUsd),
    ewmaFundingRateAnnualized: round(ewmaRate, 6),
    fundingIncomeUsd: round(fundingIncomeUsd),
    borrowCostUsd: round(borrowCostUsd),
    entrySlippageUsd: round(entrySlippageUsd),
    exitSlippageUsd: round(exitSlippageUsd),
    gatewayRoundTripCostUsd: round(roundTripCostUsd),
    projectedNetUsd: round(netUsd),
    projectedAnnualizedNetBps: annualizedNetBps,
  });
}

function receiptEvidence(receipts = []) {
  const signerBacked = receipts.filter((r) => r?.signerBacked === true);
  const passed = signerBacked.filter((r) => r?.result === "passed");
  const realized = passed.reduce(
    (sum, r) => sum + (Number(r.realizedNetUsd) || 0),
    0,
  );
  const liquidationBufferProvenCount = signerBacked.filter(
    (r) => r?.liquidationBufferProven === true,
  ).length;
  const autoUnwindProvenCount = signerBacked.filter(
    (r) => r?.autoUnwindProven === true,
  ).length;
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 ? round(realized) : null,
    liquidationBufferProvenCount,
    autoUnwindProvenCount,
  });
}

export function evaluateGmxBasisAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validateGmxBasisConfig(config);
  const marketAssessment = assessMarket(market);

  // Re-check funding gate at evaluation time.
  const fundingVerdict = evaluateFundingRateGate(
    {
      marketId: config?.perpMarketId || "BTC/USD",
      fundingRateAnnualizedSamples:
        marketAssessment.fundingSamples || [],
      recentNegativeDays: marketAssessment.recentNegativeDays ?? 0,
    },
    config?.fundingThresholds || FUNDING_RATE_THRESHOLDS,
  );

  const gates = policyGates(config, marketAssessment, fundingVerdict);
  const economics = projectedEconomics(
    config,
    marketAssessment,
    fundingVerdict,
  );
  const evidence = receiptEvidence(receipts);

  const blockers = [
    ...(validation.ok ? [] : ["config_invalid"]),
    ...marketAssessment.blockers,
    ...gates,
  ];
  if (
    economics != null &&
    economics.projectedAnnualizedNetBps != null &&
    config.minProjectedAnnualNetBps != null &&
    economics.projectedAnnualizedNetBps < config.minProjectedAnnualNetBps
  ) {
    blockers.push("projected_annualized_net_below_threshold");
  }
  if (evidence.signerBackedCount === 0) {
    blockers.push("no_signer_backed_receipts");
  }
  if (
    evidence.signerBackedCount > 0 &&
    evidence.liquidationBufferProvenCount < evidence.signerBackedCount
  ) {
    blockers.push("liquidation_buffer_unproven_in_some_receipts");
  }
  if (
    evidence.signerBackedCount > 0 &&
    evidence.autoUnwindProvenCount === 0
  ) {
    blockers.push("auto_unwind_unproven");
  }

  const shadowReady =
    validation.ok &&
    marketAssessment.blockers.length === 0 &&
    gates.length === 0 &&
    economics != null &&
    economics.projectedNetUsd > 0 &&
    economics.projectedAnnualizedNetBps >= config.minProjectedAnnualNetBps;

  const liveReady =
    shadowReady &&
    evidence.passedCount >= 3 &&
    evidence.realizedNetUsd != null &&
    evidence.realizedNetUsd > 0 &&
    evidence.liquidationBufferProvenCount === evidence.signerBackedCount &&
    evidence.autoUnwindProvenCount >= 1;

  return Object.freeze({
    strategyId: config?.id || STRATEGY_ID,
    generatedAt: typeof now === "string" ? now : null,
    validation,
    market: Object.freeze({
      ...marketAssessment,
      fundingSamples: marketAssessment.fundingSamples
        ? Object.freeze([...marketAssessment.fundingSamples])
        : null,
      blockers: Object.freeze(marketAssessment.blockers),
    }),
    fundingVerdict: Object.freeze({
      action: fundingVerdict?.action || null,
      ewmaRate: fundingVerdict?.details?.ewmaRate ?? null,
      recentNegativeDays:
        fundingVerdict?.details?.recentNegativeDays ?? null,
      sampleCount: fundingVerdict?.details?.sampleCount ?? 0,
    }),
    gates: Object.freeze(gates),
    economics,
    evidence,
    blockers: Object.freeze(blockers),
    shadowReady,
    liveReady,
    promotion: liveReady
      ? "live_candidate"
      : shadowReady
      ? "shadow_ready"
      : "blocked",
  });
}

export function summarizeGmxBasisAdapter(report) {
  if (!report) return null;
  return Object.freeze({
    strategyId: report.strategyId,
    promotion: report.promotion,
    blockerCount: report.blockers.length,
    topBlocker: report.blockers[0] || null,
    fundingAction: report.fundingVerdict?.action || null,
    projectedAnnualizedNetBps:
      report.economics?.projectedAnnualizedNetBps ?? null,
    projectedNetUsd: report.economics?.projectedNetUsd ?? null,
    signerBackedReceipts: report.evidence.signerBackedCount,
  });
}

export const GMX_BASIS_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
