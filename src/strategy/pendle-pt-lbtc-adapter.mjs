// T8 — S1 adapter scaffold: USDC ↔ Pendle PT-LBTC on Base.
//
// Composite strategy: cbBTC collateral → Moonwell → USDC borrow →
// Pendle swap → PT-LBTC until maturity. This module is a pure
// evaluator: it takes a config + market snapshot + receipt ledger
// and returns a frozen viability report with explicit blockers
// listing any missing live data. No I/O. No LLM. No signing.
//
// Runtime promotion rules (Plan §T18):
//   - This adapter stays cap=0 (shadow mode, T17) until
//     signer-backed receipts show positive net carry after
//     round-trip cost over at least one maturity rollover.
//   - autoExecute can only be flipped by a committed config diff
//     that cites the receipt evidence and the T21 canary result.

const STRATEGY_ID = "pendle-pt-lbtc-base";

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "Pendle PT-LBTC (Base)",
  strategyType: "fixed_yield_pt",
  isLeverage: true,
  chain: "base",
  lendingProtocol: "moonwell",
  ytProtocol: "pendle",
  collateralAsset: "cbBTC",
  borrowAsset: "USDC",
  targetAsset: "PT-LBTC",
  marketAsset: "LBTC",
  perTradeCapUsd: 0, // shadow mode until receipts exist
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  targetHealthFactor: 1.8,
  healthFactorMin: 1.45,
  liquidationBufferPct: 15,
  unwindTriggerHealthFactor: 1.4,
  maxLtvPct: 55,
  maxDaysToMaturity: 180,
  minDaysToMaturity: 7,
  minPtDiscountBps: 400, // minimum implied APR (4%) before entry
  maxEntrySlippageBps: 30,
  maxExitSlippageBps: 50,
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "lendingProtocol",
  "ytProtocol",
  "collateralAsset",
  "borrowAsset",
  "targetAsset",
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "targetHealthFactor",
  "healthFactorMin",
  "liquidationBufferPct",
  "unwindTriggerHealthFactor",
  "maxLtvPct",
  "maxDaysToMaturity",
  "minDaysToMaturity",
  "minPtDiscountBps",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "lendingProtocol",
  "ytProtocol",
  "collateralAsset",
  "borrowAsset",
  "targetAsset",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 2) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultPendlePtLbtcConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validatePendlePtLbtcConfig(config = {}) {
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
    Number.isFinite(config.unwindTriggerHealthFactor) &&
    Number.isFinite(config.healthFactorMin) &&
    config.unwindTriggerHealthFactor > config.healthFactorMin
  ) {
    errors.push("unwindTriggerHealthFactor must be ≤ healthFactorMin");
  }
  if (
    Number.isFinite(config.healthFactorMin) &&
    Number.isFinite(config.targetHealthFactor) &&
    config.healthFactorMin > config.targetHealthFactor
  ) {
    errors.push("healthFactorMin must be ≤ targetHealthFactor");
  }
  if (
    Number.isFinite(config.maxLtvPct) &&
    (config.maxLtvPct <= 0 || config.maxLtvPct >= 100)
  ) {
    errors.push("maxLtvPct must be in (0, 100)");
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
  const cbbtcSupplyAprBps = finite(market.cbbtcSupplyAprBps);
  const usdcBorrowAprBps = finite(market.usdcBorrowAprBps);
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const lbtcPegDeviationBps = finite(market.lbtcPegDeviationBps);
  const oracleFresh = market.oracleFresh === true;

  if (ptImpliedAprBps == null) blockers.push("pt_implied_apr_missing");
  if (daysToMaturity == null) blockers.push("pt_maturity_missing");
  if (ptLiquidityUsd == null) blockers.push("pt_liquidity_unobserved");
  if (cbbtcSupplyAprBps == null) blockers.push("cbbtc_supply_apr_missing");
  if (usdcBorrowAprBps == null) blockers.push("usdc_borrow_apr_missing");
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (lbtcPegDeviationBps == null) blockers.push("lbtc_peg_unmeasured");
  if (!oracleFresh) blockers.push("oracle_stale_or_unknown");

  return {
    blockers,
    ptImpliedAprBps,
    daysToMaturity,
    ptLiquidityUsd,
    cbbtcSupplyAprBps,
    usdcBorrowAprBps,
    entrySlippageBps,
    exitSlippageBps,
    lbtcPegDeviationBps,
    oracleFresh,
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
    config.minPtDiscountBps != null &&
    market.ptImpliedAprBps < config.minPtDiscountBps
  ) {
    gates.push("pt_implied_apr_below_threshold");
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
    market.lbtcPegDeviationBps != null &&
    Math.abs(market.lbtcPegDeviationBps) > 50
  ) {
    gates.push("lbtc_peg_deviation_excessive");
  }
  return gates;
}

function projectedEconomics(config, market) {
  if (
    market.ptImpliedAprBps == null ||
    market.daysToMaturity == null ||
    market.cbbtcSupplyAprBps == null ||
    market.usdcBorrowAprBps == null
  ) {
    return null;
  }
  const ptYieldPct = (market.ptImpliedAprBps / 10_000) *
    (market.daysToMaturity / 365);
  const collateralCarryPct = (market.cbbtcSupplyAprBps / 10_000) *
    (market.daysToMaturity / 365);
  // Assume borrow amount ≈ maxLtvPct of perTradeCapUsd, routed into PT.
  const borrowUsd = config.perTradeCapUsd * (config.maxLtvPct / 100);
  const borrowCostUsd = borrowUsd *
    (market.usdcBorrowAprBps / 10_000) *
    (market.daysToMaturity / 365);
  const ptReturnUsd = borrowUsd * ptYieldPct;
  const collateralCarryUsd = config.perTradeCapUsd * collateralCarryPct;
  const entrySlippageUsd = borrowUsd *
    ((market.entrySlippageBps ?? 0) / 10_000);
  const exitSlippageUsd = borrowUsd *
    ((market.exitSlippageBps ?? 0) / 10_000);
  const netUsd = collateralCarryUsd +
    ptReturnUsd -
    borrowCostUsd -
    entrySlippageUsd -
    exitSlippageUsd;
  return Object.freeze({
    borrowUsd: round(borrowUsd, 4),
    ptReturnUsd: round(ptReturnUsd, 4),
    collateralCarryUsd: round(collateralCarryUsd, 4),
    borrowCostUsd: round(borrowCostUsd, 4),
    entrySlippageUsd: round(entrySlippageUsd, 4),
    exitSlippageUsd: round(exitSlippageUsd, 4),
    projectedNetUsd: round(netUsd, 4),
  });
}

function receiptEvidence(receipts = []) {
  const signerBacked = receipts.filter((r) => r?.signerBacked === true);
  const passed = signerBacked.filter((r) => r?.result === "passed");
  const realized = passed.reduce(
    (sum, r) => sum + (Number(r.realizedNetUsd) || 0),
    0,
  );
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 ? round(realized, 4) : null,
    hasMaturityRolloverProof: signerBacked.some(
      (r) => r?.maturityRolloverProven === true,
    ),
  });
}

export function evaluatePendlePtLbtcAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validatePendlePtLbtcConfig(config);
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
  if (!evidence.hasMaturityRolloverProof) {
    blockers.push("maturity_rollover_unproven");
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
    evidence.hasMaturityRolloverProof;

  return Object.freeze({
    strategyId: config?.id || STRATEGY_ID,
    generatedAt: typeof now === "string" ? now : null,
    validation,
    market: Object.freeze({ ...marketAssessment, blockers: Object.freeze(marketAssessment.blockers) }),
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
  });
}

export function summarizePendlePtLbtcAdapter(report) {
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

export const PENDLE_PT_LBTC_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
