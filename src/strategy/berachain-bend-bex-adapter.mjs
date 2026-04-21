// T11 — S5 adapter scaffold: Berachain Bend (lending) + BEX (DEX) +
// BGT (governance reward) tracking.
//
// Strategy shape: deposit BTC-derivative (e.g. wBTC.OFT bridged from
// Base via Gateway) into Bend as collateral, optionally borrow a
// stable to pair into BEX LP for fee + BGT emissions. The adapter
// scores both the collateral-only sleeve and the LP-with-BGT sleeve
// via config.mode.
//
// Pure evaluator. No I/O, no LLM, no signing. Frozen output.
//
// Promotion ladder (shared):
//   blocked → shadowReady → live_candidate
//
//   shadowReady  : config valid + market measured + policy gates pass
//                  + projectedNetUsd > 0
//   live_candidate: shadowReady + ≥3 signer-backed passed receipts
//                  + realizedNetUsd > 0
//                  + bgtClaimProven (≥1 BGT claim + valuation proof)
//                  + (mode === "lp_bgt" ⇒ rebalanceProven)

const STRATEGY_ID = "berachain-bend-bex-bgt";

const MODES = Object.freeze(["collateral_only", "lp_bgt"]);

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "Berachain Bend + BEX + BGT",
  strategyType: "lending_plus_lp_with_governance_reward",
  isLeverage: false,
  chain: "berachain",
  lendingProtocol: "bend",
  dexProtocol: "bex",
  rewardToken: "BGT",
  sourceAsset: "BTC",
  bridgedAsset: "wBTC.OFT",
  pairedAsset: "HONEY",
  mode: "collateral_only",
  perTradeCapUsd: 0, // shadow until receipts
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  // lending gates
  minLendingTvlUsd: 1_000_000,
  minLendingSupplyAprBps: 200, // 2% supply APR floor
  // LP gates (mode === "lp_bgt")
  minLpTvlUsd: 500_000,
  minLpFeeAprBps: 300,
  maxLpRealizedIlBps: 200,
  // BGT reward modeling
  bgtUsdValueOracleConfidenceBps: 500, // ≤5% drift between oracles
  minBgtAprBps: 500, // 5% BGT APR floor (only enforced in lp_bgt mode)
  bgtIlliquidityHaircutBps: 2000, // 20% haircut when valuing BGT
  // execution
  maxEntrySlippageBps: 40,
  maxExitSlippageBps: 60,
  maxRoundTripCostBps: 100,
  // bridging — Berachain is a Gateway destination but new; demand
  // measured offramp cost back to Base/BTC L1.
  maxOfframpCostBps: 70,
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "lendingProtocol",
  "dexProtocol",
  "rewardToken",
  "sourceAsset",
  "bridgedAsset",
  "pairedAsset",
  "mode",
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "minLendingTvlUsd",
  "minLendingSupplyAprBps",
  "minLpTvlUsd",
  "minLpFeeAprBps",
  "maxLpRealizedIlBps",
  "bgtUsdValueOracleConfidenceBps",
  "minBgtAprBps",
  "bgtIlliquidityHaircutBps",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
  "maxRoundTripCostBps",
  "maxOfframpCostBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "lendingProtocol",
  "dexProtocol",
  "rewardToken",
  "sourceAsset",
  "bridgedAsset",
  "pairedAsset",
  "mode",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultBerachainConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validateBerachainConfig(config = {}) {
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
  if (config.chain !== "berachain") {
    errors.push("chain must be 'berachain' (Bend/BEX venue)");
  }
  if (typeof config.mode === "string" && !MODES.includes(config.mode)) {
    errors.push(`mode must be one of: ${MODES.join(", ")}`);
  }
  if (Number.isFinite(config.maxDailyLossUsd) && config.maxDailyLossUsd <= 0) {
    errors.push("maxDailyLossUsd must be positive");
  }
  if (
    Number.isFinite(config.bgtIlliquidityHaircutBps) &&
    (config.bgtIlliquidityHaircutBps < 0 ||
      config.bgtIlliquidityHaircutBps > 10_000)
  ) {
    errors.push("bgtIlliquidityHaircutBps must be in [0, 10000]");
  }
  if (
    Number.isFinite(config.bgtUsdValueOracleConfidenceBps) &&
    config.bgtUsdValueOracleConfidenceBps < 0
  ) {
    errors.push("bgtUsdValueOracleConfidenceBps must be ≥ 0");
  }
  return Object.freeze({
    ok: missingFields.length === 0 && errors.length === 0,
    missingFields: Object.freeze(missingFields),
    errors: Object.freeze(errors),
  });
}

function assessMarket(market = {}, mode) {
  const blockers = [];
  const lendingTvlUsd = finite(market.lendingTvlUsd);
  const lendingSupplyAprBps = finite(market.lendingSupplyAprBps);
  const lpTvlUsd = finite(market.lpTvlUsd);
  const lpFeeAprBps = finite(market.lpFeeAprBps);
  const lpRealizedIlBps = finite(market.lpRealizedIlBps);
  const bgtAprBps = finite(market.bgtAprBps);
  const bgtOracleDriftBps = finite(market.bgtOracleDriftBps);
  const bgtSpotLiquidityUsd = finite(market.bgtSpotLiquidityUsd);
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const gatewayQuoteFresh = market.gatewayQuoteFresh === true;
  const gatewayRoundTripCostBps = finite(market.gatewayRoundTripCostBps);
  const offrampCostBps = finite(market.offrampCostBps);

  if (lendingTvlUsd == null) blockers.push("lending_tvl_unobserved");
  if (lendingSupplyAprBps == null) blockers.push("lending_supply_apr_unmeasured");
  if (mode === "lp_bgt") {
    if (lpTvlUsd == null) blockers.push("lp_tvl_unobserved");
    if (lpFeeAprBps == null) blockers.push("lp_fee_apr_unmeasured");
    if (lpRealizedIlBps == null) blockers.push("lp_realized_il_unmeasured");
    if (bgtAprBps == null) blockers.push("bgt_apr_unmeasured");
    if (bgtOracleDriftBps == null) blockers.push("bgt_oracle_drift_unmeasured");
    if (bgtSpotLiquidityUsd == null) {
      blockers.push("bgt_spot_liquidity_unobserved");
    }
  }
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (!gatewayQuoteFresh) blockers.push("gateway_quote_stale_or_unknown");
  if (gatewayRoundTripCostBps == null) {
    blockers.push("gateway_round_trip_cost_unmeasured");
  }
  if (offrampCostBps == null) blockers.push("offramp_cost_unmeasured");

  return {
    blockers,
    lendingTvlUsd,
    lendingSupplyAprBps,
    lpTvlUsd,
    lpFeeAprBps,
    lpRealizedIlBps,
    bgtAprBps,
    bgtOracleDriftBps,
    bgtSpotLiquidityUsd,
    entrySlippageBps,
    exitSlippageBps,
    gatewayQuoteFresh,
    gatewayRoundTripCostBps,
    offrampCostBps,
  };
}

function policyGates(config, market) {
  const gates = [];
  const mode = config.mode;
  if (
    market.lendingTvlUsd != null &&
    config.minLendingTvlUsd != null &&
    market.lendingTvlUsd < config.minLendingTvlUsd
  ) {
    gates.push("lending_tvl_below_minimum");
  }
  if (
    market.lendingSupplyAprBps != null &&
    config.minLendingSupplyAprBps != null &&
    market.lendingSupplyAprBps < config.minLendingSupplyAprBps
  ) {
    gates.push("lending_supply_apr_below_threshold");
  }
  if (mode === "lp_bgt") {
    if (
      market.lpTvlUsd != null &&
      config.minLpTvlUsd != null &&
      market.lpTvlUsd < config.minLpTvlUsd
    ) {
      gates.push("lp_tvl_below_minimum");
    }
    if (
      market.lpFeeAprBps != null &&
      config.minLpFeeAprBps != null &&
      market.lpFeeAprBps < config.minLpFeeAprBps
    ) {
      gates.push("lp_fee_apr_below_threshold");
    }
    if (
      market.lpRealizedIlBps != null &&
      config.maxLpRealizedIlBps != null &&
      market.lpRealizedIlBps > config.maxLpRealizedIlBps
    ) {
      gates.push("lp_realized_il_above_threshold");
    }
    if (
      market.bgtAprBps != null &&
      config.minBgtAprBps != null &&
      market.bgtAprBps < config.minBgtAprBps
    ) {
      gates.push("bgt_apr_below_threshold");
    }
    if (
      market.bgtOracleDriftBps != null &&
      config.bgtUsdValueOracleConfidenceBps != null &&
      market.bgtOracleDriftBps > config.bgtUsdValueOracleConfidenceBps
    ) {
      gates.push("bgt_oracle_drift_above_threshold");
    }
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
    market.offrampCostBps != null &&
    config.maxOfframpCostBps != null &&
    market.offrampCostBps > config.maxOfframpCostBps
  ) {
    gates.push("offramp_cost_above_threshold");
  }
  return gates;
}

function projectedEconomics(config, market) {
  if (
    market.lendingSupplyAprBps == null ||
    market.gatewayRoundTripCostBps == null
  ) {
    return null;
  }
  const principalUsd = config.perTradeCapUsd;
  const horizonDays = 30;
  const lendingUsd = principalUsd *
    (market.lendingSupplyAprBps / 10_000) *
    (horizonDays / 365);
  let lpFeeUsd = 0;
  let bgtUsd = 0;
  let ilUsd = 0;
  if (config.mode === "lp_bgt") {
    if (
      market.lpFeeAprBps == null ||
      market.bgtAprBps == null ||
      market.lpRealizedIlBps == null
    ) {
      return null;
    }
    lpFeeUsd = principalUsd *
      (market.lpFeeAprBps / 10_000) *
      (horizonDays / 365);
    // Apply illiquidity haircut to BGT — its USD value is uncertain
    // until claimed and routed through a measurable swap path.
    const haircut = 1 - (config.bgtIlliquidityHaircutBps / 10_000);
    bgtUsd = principalUsd *
      (market.bgtAprBps / 10_000) *
      (horizonDays / 365) *
      Math.max(0, haircut);
    ilUsd = principalUsd * (market.lpRealizedIlBps / 10_000);
  }
  const entrySlippageUsd = principalUsd *
    ((market.entrySlippageBps ?? 0) / 10_000);
  const exitSlippageUsd = principalUsd *
    ((market.exitSlippageBps ?? 0) / 10_000);
  const roundTripCostUsd = principalUsd *
    (market.gatewayRoundTripCostBps / 10_000);
  const offrampCostUsd = principalUsd *
    ((market.offrampCostBps ?? 0) / 10_000);
  const netUsd =
    lendingUsd + lpFeeUsd + bgtUsd
    - ilUsd
    - entrySlippageUsd - exitSlippageUsd
    - roundTripCostUsd - offrampCostUsd;
  return Object.freeze({
    horizonDays,
    principalUsd: round(principalUsd),
    lendingUsd: round(lendingUsd),
    lpFeeUsd: round(lpFeeUsd),
    bgtUsdHaircut: round(bgtUsd),
    impermanentLossUsd: round(ilUsd),
    entrySlippageUsd: round(entrySlippageUsd),
    exitSlippageUsd: round(exitSlippageUsd),
    gatewayRoundTripCostUsd: round(roundTripCostUsd),
    offrampCostUsd: round(offrampCostUsd),
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
  const bgtClaimProvenCount = signerBacked.filter(
    (r) => r?.bgtClaimProven === true,
  ).length;
  const rebalanceProvenCount = signerBacked.filter(
    (r) => r?.rebalanceProven === true,
  ).length;
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 ? round(realized) : null,
    bgtClaimProvenCount,
    rebalanceProvenCount,
  });
}

export function evaluateBerachainAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validateBerachainConfig(config);
  const marketAssessment = assessMarket(market, config?.mode);
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
    config?.mode === "lp_bgt" &&
    evidence.signerBackedCount > 0 &&
    evidence.bgtClaimProvenCount === 0
  ) {
    blockers.push("bgt_claim_unproven");
  }
  if (
    config?.mode === "lp_bgt" &&
    evidence.signerBackedCount > 0 &&
    evidence.rebalanceProvenCount === 0
  ) {
    blockers.push("rebalance_unproven");
  }

  const shadowReady =
    validation.ok &&
    marketAssessment.blockers.length === 0 &&
    gates.length === 0 &&
    economics != null &&
    economics.projectedNetUsd > 0;

  let liveReady =
    shadowReady &&
    evidence.passedCount >= 3 &&
    evidence.realizedNetUsd != null &&
    evidence.realizedNetUsd > 0;
  if (config?.mode === "lp_bgt") {
    liveReady = liveReady &&
      evidence.bgtClaimProvenCount >= 1 &&
      evidence.rebalanceProvenCount >= 1;
  }

  const intent = shadowReady || liveReady
    ? Object.freeze({
        strategyId: config?.id || STRATEGY_ID,
        chain: config?.chain || "bera",
        amountUsd: config?.perTradeCapUsd || 0,
        intentType: "entry",
        executionReason: "strategy_tick",
      })
    : null;

  return Object.freeze({
    strategyId: config?.id || STRATEGY_ID,
    mode: config?.mode || null,
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
    promotion: liveReady
      ? "live_candidate"
      : shadowReady
      ? "shadow_ready"
      : "blocked",
    intent,
    microCanaryStatus: evidence.signerBackedCount >= 3 ? "micro_canary_repeatable" : evidence.signerBackedCount > 0 ? "micro_canary_ready" : "not_started",
  });
}

export function summarizeBerachainAdapter(report) {
  if (!report) return null;
  return Object.freeze({
    strategyId: report.strategyId,
    mode: report.mode,
    promotion: report.promotion,
    blockerCount: report.blockers.length,
    topBlocker: report.blockers[0] || null,
    projectedNetUsd: report.economics?.projectedNetUsd ?? null,
    signerBackedReceipts: report.evidence.signerBackedCount,
    bgtClaimProvenCount: report.evidence.bgtClaimProvenCount,
  });
}

export const BERACHAIN_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
export const BERACHAIN_MODES = MODES;
