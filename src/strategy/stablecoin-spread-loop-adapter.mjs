// W4-A — Stablecoin spread loop adapter scaffold.
//
// Strategy: supply USDC, borrow USDT, swap or re-supply, loop.
// Pure evaluator. No I/O, no LLM, no signing.

const STRATEGY_ID = "stablecoin_spread_loop";

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "Stablecoin spread loop",
  strategyType: "stable_supply_borrow_loop",
  isLeverage: true,
  chain: "base",
  collateralAsset: "USDC",
  borrowAsset: "USDT",
  perTradeCapUsd: 0,
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  healthFactorMin: 1.45,
  liquidationBufferPct: 12,
  maxLoopIterations: 3,
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
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "healthFactorMin",
  "liquidationBufferPct",
  "maxLoopIterations",
  "pegDriftTriggerPct",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultStablecoinSpreadConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validateStablecoinSpreadConfig(config = {}) {
  const missingFields = [];
  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (!Number.isFinite(config[field]) && typeof config[field] !== "string") {
      missingFields.push(field);
    } else if (typeof config[field] === "string" && config[field].length === 0) {
      missingFields.push(field);
    }
  }
  return Object.freeze({
    ok: missingFields.length === 0,
    missingFields: Object.freeze(missingFields),
  });
}

function assessMarket(market = {}) {
  const blockers = [];
  const supplyAprBps = finite(market.supplyAprBps);
  const borrowAprBps = finite(market.borrowAprBps);
  const entrySlippageBps = finite(market.entrySlippageBps);
  const exitSlippageBps = finite(market.exitSlippageBps);
  const pegDriftBps = finite(market.pegDriftBps);

  if (supplyAprBps == null) blockers.push("supply_apr_missing");
  if (borrowAprBps == null) blockers.push("borrow_apr_missing");
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (pegDriftBps == null) blockers.push("peg_drift_unmeasured");

  return { blockers, supplyAprBps, borrowAprBps, entrySlippageBps, exitSlippageBps, pegDriftBps };
}

function policyGates(config, market) {
  const gates = [];
  if (market.pegDriftBps != null && market.pegDriftBps > config.pegDriftTriggerPct * 100) {
    gates.push("peg_drift_above_trigger");
  }
  if (market.entrySlippageBps != null && market.entrySlippageBps > config.maxEntrySlippageBps) {
    gates.push("entry_slippage_above_threshold");
  }
  if (market.exitSlippageBps != null && market.exitSlippageBps > config.maxExitSlippageBps) {
    gates.push("exit_slippage_above_threshold");
  }
  return gates;
}

function projectedEconomics(config, market) {
  if (market.supplyAprBps == null || market.borrowAprBps == null) return null;
  const spreadBps = market.supplyAprBps - market.borrowAprBps;
  const netUsd = config.perTradeCapUsd * (spreadBps / 10_000);
  return Object.freeze({
    spreadBps,
    projectedNetUsd: round(netUsd, 4),
  });
}

function receiptEvidence(receipts = []) {
  const signerBacked = receipts.filter((r) => r?.signerBacked === true);
  const passed = signerBacked.filter((r) => r?.result === "passed");
  const realized = passed.reduce((sum, r) => sum + (Number(r.realizedNetUsd) || 0), 0);
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 ? round(realized, 4) : null,
  });
}

export function evaluateStablecoinSpreadAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validateStablecoinSpreadConfig(config);
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
    market: Object.freeze({ ...marketAssessment, blockers: Object.freeze(marketAssessment.blockers) }),
    gates: Object.freeze(gates),
    economics,
    evidence,
    blockers: Object.freeze(blockers),
    shadowReady,
    liveReady,
    mode: liveReady ? "live_candidate" : shadowReady ? "shadow_ready" : "blocked",
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

export function summarizeStablecoinSpreadAdapter(report) {
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
