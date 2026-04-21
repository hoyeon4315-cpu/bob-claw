// W4-B — Proxy spread expansion adapter scaffold.
//
// Strategy: supply USDC (or proxy-wrapped stable), borrow USDT via a
// proxy/lending-loop expansion leg (e.g. eMode, Morpho, or recursive
// collateral re-supply).  Net shape is a leveraged stablecoin spread.
//
// Pure evaluator. No I/O, no LLM, no signing.

const STRATEGY_ID = "proxy_spread_expansion";

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "Proxy spread expansion",
  strategyType: "proxy_leveraged_stable_spread",
  isLeverage: true,
  chain: "base",
  collateralAsset: "USDC",
  borrowAsset: "USDT",
  proxyProtocol: "morpho", // or "aave_v3_emode", "compound_v3"
  perTradeCapUsd: 0,
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  healthFactorMin: 1.45,
  liquidationBufferPct: 12,
  maxLoopIterations: 5,
  proxyLeverage: 3.0,
  pegDriftTriggerPct: 0.5,
  maxEntrySlippageBps: 20,
  maxExitSlippageBps: 30,
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "collateralAsset",
  "borrowAsset",
  "proxyProtocol",
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "healthFactorMin",
  "liquidationBufferPct",
  "maxLoopIterations",
  "proxyLeverage",
  "pegDriftTriggerPct",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze([
  "id",
  "chain",
  "collateralAsset",
  "borrowAsset",
  "proxyProtocol",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultProxySpreadConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validateProxySpreadConfig(config = {}) {
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
  if (Number.isFinite(config.proxyLeverage) && config.proxyLeverage <= 0) {
    errors.push("proxyLeverage must be positive");
  }
  if (Number.isFinite(config.proxyLeverage) && config.proxyLeverage > 10) {
    errors.push("proxyLeverage capped at 10x");
  }
  if (Number.isFinite(config.healthFactorMin) && config.healthFactorMin < 1) {
    errors.push("healthFactorMin must be >= 1");
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
  const supplyAprBps = finite(market.supplyAprBps);
  const borrowAprBps = finite(market.borrowAprBps);
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const pegDriftBps = finite(market.pegDriftBps);
  const proxyTvlUsd = finite(market.proxyTvlUsd);

  if (supplyAprBps == null) blockers.push("supply_apr_missing");
  if (borrowAprBps == null) blockers.push("borrow_apr_missing");
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (pegDriftBps == null) blockers.push("peg_drift_unmeasured");
  if (proxyTvlUsd == null) blockers.push("proxy_tvl_unobserved");

  return {
    blockers,
    supplyAprBps,
    borrowAprBps,
    entrySlippageBps,
    exitSlippageBps,
    pegDriftBps,
    proxyTvlUsd,
  };
}

function policyGates(config, market) {
  const gates = [];
  if (
    market.pegDriftBps != null &&
    market.pegDriftBps > config.pegDriftTriggerPct * 100
  ) {
    gates.push("peg_drift_above_trigger");
  }
  if (
    market.entrySlippageBps != null &&
    market.entrySlippageBps > config.maxEntrySlippageBps
  ) {
    gates.push("entry_slippage_above_threshold");
  }
  if (
    market.exitSlippageBps != null &&
    market.exitSlippageBps > config.maxExitSlippageBps
  ) {
    gates.push("exit_slippage_above_threshold");
  }
  if (
    market.proxyTvlUsd != null &&
    market.proxyTvlUsd < 500_000
  ) {
    gates.push("proxy_tvl_below_minimum");
  }
  return gates;
}

function projectedEconomics(config, market) {
  if (market.supplyAprBps == null || market.borrowAprBps == null) return null;
  const spreadBps = market.supplyAprBps - market.borrowAprBps;
  const leveragedSpreadBps = spreadBps * (config.proxyLeverage || 1);
  const netUsd = config.perTradeCapUsd * (leveragedSpreadBps / 10_000);
  return Object.freeze({
    spreadBps,
    leveragedSpreadBps,
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
  });
}

export function evaluateProxySpreadAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validateProxySpreadConfig(config);
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
    evidence.realizedNetUsd > 0;

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
    mode: liveReady
      ? "live_candidate"
      : shadowReady
      ? "shadow_ready"
      : "blocked",
    intent,
    microCanaryStatus: evidence.signerBackedCount >= 3
      ? "micro_canary_repeatable"
      : evidence.signerBackedCount > 0
      ? "micro_canary_ready"
      : "not_started",
  });
}

export function summarizeProxySpreadAdapter(report) {
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

export const PROXY_SPREAD_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
