// T13 — S7 adapter scaffold: Beefy folding vault.
//
// Strategy shape: deposit BTC-derivative (e.g. cbBTC on Base) into a
// Beefy auto-compounding vault that internally folds (recursive
// supply/borrow loop on a money market). Beefy handles the fold
// rebalancing; we treat the vault as a black box but require:
//   - measured net APY after Beefy's performance fee
//   - vault TVL above floor (concentration risk)
//   - underlying-protocol HF buffer is healthy
//   - withdrawal proven
//
// Low priority — passive parking sleeve. Pure evaluator. No I/O,
// no LLM, no signing. Frozen output.
//
// Promotion ladder:
//   blocked → shadowReady → live_candidate
//
//   shadowReady   : config valid + market measured + policy gates
//                   pass + projectedNetUsd > 0
//   live_candidate: shadowReady + ≥3 signer-backed passed receipts
//                   + realizedNetUsd > 0
//                   + vaultWithdrawalProven (≥1 full vault exit
//                     proven on chain — proves redemption path
//                     is not blocked by withdrawal queue / pause)

const STRATEGY_ID = "beefy-folding-vault";

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "Beefy folding vault (passive parking)",
  strategyType: "auto_compounding_folded_lending",
  isLeverage: true, // underlying protocol uses leverage; vault abstracts it
  chain: "base",
  vaultProtocol: "beefy",
  vaultId: "morpho-seamless-cbbtc",
  underlyingProtocol: "morpho",
  sourceAsset: "BTC",
  bridgedAsset: "cbBTC",
  perTradeCapUsd: 0, // shadow until receipts
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  // vault gates
  minVaultTvlUsd: 1_000_000,
  maxVaultShareOfTvlPct: 5, // our position ≤5% of vault TVL
  minNetApyBps: 200, // 2% APY floor after Beefy fee
  maxBeefyPerformanceFeeBps: 1000, // 10% perf fee ceiling
  // underlying protocol HF
  underlyingHealthFactorMin: 1.5,
  underlyingLiquidationBufferPct: 25,
  // execution
  maxEntrySlippageBps: 30,
  maxExitSlippageBps: 50,
  maxRoundTripCostBps: 90,
  // bridging back
  maxOfframpCostBps: 70,
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "vaultProtocol",
  "vaultId",
  "underlyingProtocol",
  "sourceAsset",
  "bridgedAsset",
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "minVaultTvlUsd",
  "maxVaultShareOfTvlPct",
  "minNetApyBps",
  "maxBeefyPerformanceFeeBps",
  "underlyingHealthFactorMin",
  "underlyingLiquidationBufferPct",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
  "maxRoundTripCostBps",
  "maxOfframpCostBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "vaultProtocol",
  "vaultId",
  "underlyingProtocol",
  "sourceAsset",
  "bridgedAsset",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultBeefyFoldingConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validateBeefyFoldingConfig(config = {}) {
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
  if (Number.isFinite(config.maxDailyLossUsd) && config.maxDailyLossUsd <= 0) {
    errors.push("maxDailyLossUsd must be positive");
  }
  if (
    Number.isFinite(config.maxVaultShareOfTvlPct) &&
    (config.maxVaultShareOfTvlPct <= 0 ||
      config.maxVaultShareOfTvlPct > 100)
  ) {
    errors.push("maxVaultShareOfTvlPct must be in (0, 100]");
  }
  if (
    Number.isFinite(config.maxBeefyPerformanceFeeBps) &&
    (config.maxBeefyPerformanceFeeBps < 0 ||
      config.maxBeefyPerformanceFeeBps > 10_000)
  ) {
    errors.push("maxBeefyPerformanceFeeBps must be in [0, 10000]");
  }
  if (
    Number.isFinite(config.underlyingHealthFactorMin) &&
    config.underlyingHealthFactorMin < 1
  ) {
    errors.push("underlyingHealthFactorMin must be ≥ 1");
  }
  return Object.freeze({
    ok: missingFields.length === 0 && errors.length === 0,
    missingFields: Object.freeze(missingFields),
    errors: Object.freeze(errors),
  });
}

function assessMarket(market = {}) {
  const blockers = [];
  const vaultTvlUsd = finite(market.vaultTvlUsd);
  const reportedNetApyBps = finite(market.reportedNetApyBps);
  const beefyPerformanceFeeBps = finite(market.beefyPerformanceFeeBps);
  const underlyingHealthFactor = finite(market.underlyingHealthFactor);
  const underlyingUtilizationPct = finite(market.underlyingUtilizationPct);
  const vaultPausedFlag = market.vaultPaused === true; // boolean signal
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const gatewayQuoteFresh = market.gatewayQuoteFresh === true;
  const gatewayRoundTripCostBps = finite(market.gatewayRoundTripCostBps);
  const offrampCostBps = finite(market.offrampCostBps);

  if (vaultTvlUsd == null) blockers.push("vault_tvl_unobserved");
  if (reportedNetApyBps == null) blockers.push("vault_net_apy_unmeasured");
  if (beefyPerformanceFeeBps == null) {
    blockers.push("beefy_performance_fee_unobserved");
  }
  if (underlyingHealthFactor == null) {
    blockers.push("underlying_health_factor_unmeasured");
  }
  if (underlyingUtilizationPct == null) {
    blockers.push("underlying_utilization_unmeasured");
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
    vaultTvlUsd,
    reportedNetApyBps,
    beefyPerformanceFeeBps,
    underlyingHealthFactor,
    underlyingUtilizationPct,
    vaultPaused: vaultPausedFlag,
    entrySlippageBps,
    exitSlippageBps,
    gatewayQuoteFresh,
    gatewayRoundTripCostBps,
    offrampCostBps,
  };
}

function policyGates(config, market) {
  const gates = [];
  if (market.vaultPaused === true) {
    gates.push("vault_paused");
  }
  if (
    market.vaultTvlUsd != null &&
    config.minVaultTvlUsd != null &&
    market.vaultTvlUsd < config.minVaultTvlUsd
  ) {
    gates.push("vault_tvl_below_minimum");
  }
  if (
    market.vaultTvlUsd != null &&
    config.perTradeCapUsd != null &&
    config.maxVaultShareOfTvlPct != null &&
    market.vaultTvlUsd > 0 &&
    (config.perTradeCapUsd / market.vaultTvlUsd) * 100 >
      config.maxVaultShareOfTvlPct
  ) {
    gates.push("position_share_of_vault_excessive");
  }
  if (
    market.reportedNetApyBps != null &&
    config.minNetApyBps != null &&
    market.reportedNetApyBps < config.minNetApyBps
  ) {
    gates.push("vault_net_apy_below_threshold");
  }
  if (
    market.beefyPerformanceFeeBps != null &&
    config.maxBeefyPerformanceFeeBps != null &&
    market.beefyPerformanceFeeBps > config.maxBeefyPerformanceFeeBps
  ) {
    gates.push("beefy_performance_fee_above_threshold");
  }
  if (
    market.underlyingHealthFactor != null &&
    config.underlyingHealthFactorMin != null &&
    market.underlyingHealthFactor < config.underlyingHealthFactorMin
  ) {
    gates.push("underlying_health_factor_below_minimum");
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
    market.reportedNetApyBps == null ||
    market.gatewayRoundTripCostBps == null
  ) {
    return null;
  }
  const principalUsd = config.perTradeCapUsd;
  const horizonDays = 90;
  const yieldUsd = principalUsd *
    (market.reportedNetApyBps / 10_000) *
    (horizonDays / 365);
  const entrySlippageUsd = principalUsd *
    ((market.entrySlippageBps ?? 0) / 10_000);
  const exitSlippageUsd = principalUsd *
    ((market.exitSlippageBps ?? 0) / 10_000);
  const roundTripCostUsd = principalUsd *
    (market.gatewayRoundTripCostBps / 10_000);
  const offrampCostUsd = principalUsd *
    ((market.offrampCostBps ?? 0) / 10_000);
  const netUsd =
    yieldUsd
    - entrySlippageUsd - exitSlippageUsd
    - roundTripCostUsd - offrampCostUsd;
  return Object.freeze({
    horizonDays,
    principalUsd: round(principalUsd),
    yieldUsd: round(yieldUsd),
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
  const vaultWithdrawalProvenCount = signerBacked.filter(
    (r) => r?.vaultWithdrawalProven === true,
  ).length;
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 ? round(realized) : null,
    vaultWithdrawalProvenCount,
  });
}

export function evaluateBeefyFoldingAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validateBeefyFoldingConfig(config);
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
    evidence.vaultWithdrawalProvenCount === 0
  ) {
    blockers.push("vault_withdrawal_unproven");
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
    evidence.vaultWithdrawalProvenCount >= 1;

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

export function summarizeBeefyFoldingAdapter(report) {
  if (!report) return null;
  return Object.freeze({
    strategyId: report.strategyId,
    promotion: report.promotion,
    blockerCount: report.blockers.length,
    topBlocker: report.blockers[0] || null,
    projectedNetUsd: report.economics?.projectedNetUsd ?? null,
    signerBackedReceipts: report.evidence.signerBackedCount,
    vaultWithdrawalProvenCount: report.evidence.vaultWithdrawalProvenCount,
  });
}

export const BEEFY_FOLDING_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
