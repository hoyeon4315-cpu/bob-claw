// DefiLlama Yield Adapter — generic yield-pool evaluator.
//
// Consumes DefiLlama /pools snapshot data, evaluates opportunity
// pools across Gateway destination chains, and emits shadow-ready
// candidates for stablecoin and wrapped-BTC sleeves.
//
// Pure evaluator. No I/O. Frozen output.
//
// Promotion ladder:
//   blocked → shadow_ready → live_candidate
//
//   shadow_ready : config valid + pool measured + projectedNetUsd > 0
//   live_candidate: shadowReady + ≥1 receipt-backed entry/exit proof

import { getDefiLlamaSupportedReceiptProjects } from "../protocol-readers/registry.mjs";

const STRATEGY_ID = "defillama-yield-portfolio";

const SUPPORTED_CHAINS = new Set([
  "ethereum",
  "bob",
  "base",
  "bsc",
  "avalanche",
  "unichain",
  "berachain",
  "optimism",
  "soneium",
  "sei",
  "sonic",
]);

const SUPPORTED_FAMILIES = new Set(["stablecoin", "wrapped_btc"]);

// DefiLlama receipt-bound classification is now driven by the canonical list in
// protocol-readers/registry (owned by Protocol Reader & On-chain Data Engineer).
// This ensures evidenceClass is reliable and exactly matches projects that have
// registered ProtocolReader impls for on-chain NormalizedPosition reads + receipt
// delta proofs. No more over-classification of pools (e.g. compound-v3) that lack
// readers and thus cannot yet support receipt generation for YCE-002/003.
// Phase 1 receipt-bound projects (sourced from protocol-readers for reader-backed evidence)
// This is the narrow starting set for DefiLlama yield revival (YCE-001). Only projects
// with actual on-chain readers count as "protocol_receipt_bound" so snapshot output
// and policyGates produce usable candidates for receipt test / E2E validation.
const RECEIPT_BOUND_PROJECTS = new Set(getDefiLlamaSupportedReceiptProjects());

export function getDefiLlamaPoolEvidenceClass(project, chain, family) {
  const p = String(project || "").toLowerCase();
  if (RECEIPT_BOUND_PROJECTS.has(p)) {
    return "protocol_receipt_bound";
  }
  return "protocol_not_receipt_bound";
}

const DEFAULT_CONFIG = Object.freeze({
  id: STRATEGY_ID,
  label: "DefiLlama yield portfolio (campaign-aware)",
  strategyType: "yield_portfolio_rotation",
  isLeverage: false,
  sourceAsset: "BTC",
  perTradeCapUsd: 0, // shadow until receipts
  perDayCapUsd: 0,
  maxDailyLossUsd: 50,
  // pool gates
  minPoolTvlUsd: 500_000,
  maxPoolSharePct: 5, // our position ≤5% of pool TVL
  minNetApyBps: 150, // 1.5% APY floor
  // cost gates
  maxEntrySlippageBps: 30,
  maxExitSlippageBps: 50,
  maxRoundTripCostBps: 100,
  maxOfframpCostBps: 70,
  // diversification
  maxSameProtocolSharePct: 30,
  maxSameChainSharePct: 50,
  autoExecute: false,
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "perTradeCapUsd",
  "perDayCapUsd",
  "maxDailyLossUsd",
  "minPoolTvlUsd",
  "maxPoolSharePct",
  "minNetApyBps",
  "maxEntrySlippageBps",
  "maxExitSlippageBps",
  "maxRoundTripCostBps",
  "maxOfframpCostBps",
]);

const STRING_CONFIG_FIELDS = Object.freeze(["id", "label", "strategyType", "sourceAsset"]);

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function buildDefaultDefiLlamaYieldConfig() {
  return { ...DEFAULT_CONFIG };
}

export function validateDefiLlamaYieldConfig(config = {}) {
  const missingFields = [];
  const errors = [];
  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (!Number.isFinite(config[field])) missingFields.push(field);
  }
  for (const field of STRING_CONFIG_FIELDS) {
    if (typeof config[field] !== "string" || config[field].length === 0) missingFields.push(field);
  }
  if (Number.isFinite(config.maxDailyLossUsd) && config.maxDailyLossUsd <= 0) {
    errors.push("maxDailyLossUsd must be positive");
  }
  if (Number.isFinite(config.maxPoolSharePct) && (config.maxPoolSharePct <= 0 || config.maxPoolSharePct > 100)) {
    errors.push("maxPoolSharePct must be in (0, 100]");
  }
  if (Number.isFinite(config.minNetApyBps) && (config.minNetApyBps < 0 || config.minNetApyBps > 50_000)) {
    errors.push("minNetApyBps must be in [0, 50000]");
  }
  return Object.freeze({
    ok: missingFields.length === 0 && errors.length === 0,
    missingFields: Object.freeze(missingFields),
    errors: Object.freeze(errors),
  });
}

function bpsFromPct(value) {
  const numeric = numberOrNull(value);
  return Number.isFinite(numeric) ? round(numeric * 100, 4) : null;
}

export function normalizeDefiLlamaYieldPool(pool = {}, defaults = {}) {
  const chain = String(pool.chain || defaults.chain || "").toLowerCase();
  return Object.freeze({
    chain,
    family: defaults.family || pool.family || null,
    protocol: pool.project || pool.protocol || defaults.protocol || null,
    poolId: pool.pool || pool.poolId || defaults.poolId || null,
    symbol: pool.symbol || defaults.symbol || null,
    tvlUsd: numberOrNull(pool.tvlUsd) ?? finite(defaults.tvlUsd),
    apyBps: bpsFromPct(pool.apy) ?? finite(defaults.apyBps),
    apyBaseBps: bpsFromPct(pool.apyBase),
    apyRewardBps: bpsFromPct(pool.apyReward),
    apyPct1D: numberOrNull(pool.apyPct1D),
    apyPct7D: numberOrNull(pool.apyPct7D),
    apyPct30D: numberOrNull(pool.apyPct30D),
    apyMean30d: numberOrNull(pool.apyMean30d),
    mu: numberOrNull(pool.mu),
    sigma: numberOrNull(pool.sigma),
    count: numberOrNull(pool.count),
    ilRisk: pool.ilRisk || null,
    exposure: pool.exposure || null,
    rewardTokens: Array.isArray(pool.rewardTokens) ? Object.freeze([...pool.rewardTokens]) : null,
    predictions: pool.predictions || null,
    outlier: pool.outlier === true,
    underlyingTokens: Array.isArray(pool.underlyingTokens) ? Object.freeze([...pool.underlyingTokens]) : null,
    poolMeta: pool.poolMeta || null,
    entrySlippageBps: finite(defaults.entrySlippageBps),
    exitSlippageBps: finite(defaults.exitSlippageBps),
    gatewayRoundTripCostBps: finite(defaults.gatewayRoundTripCostBps),
    offrampCostBps: finite(defaults.offrampCostBps),
    paused: defaults.paused === true || pool.paused === true,
    evidenceClass: getDefiLlamaPoolEvidenceClass(
      pool.project || pool.protocol || defaults.protocol,
      chain,
      defaults.family || pool.family,
    ),
  });
}

function assessPool(pool = {}) {
  const blockers = [];
  const chain = String(pool.chain || "").toLowerCase();
  if (!SUPPORTED_CHAINS.has(chain)) blockers.push("chain_not_supported");

  const family = String(pool.family || "").toLowerCase();
  if (!SUPPORTED_FAMILIES.has(family)) blockers.push("asset_family_not_supported");
  const protocol = pool.protocol || null;
  const evidenceClass = pool.evidenceClass || getDefiLlamaPoolEvidenceClass(protocol, chain, family);

  const tvlUsd = finite(pool.tvlUsd);
  const apyBps = finite(pool.apyBps);
  const entrySlippageBps = finite(pool.entrySlippageBps);
  const exitSlippageBps = finite(pool.exitSlippageBps);
  const gatewayRoundTripCostBps = finite(pool.gatewayRoundTripCostBps);
  const offrampCostBps = finite(pool.offrampCostBps);
  const poolPaused = pool.paused === true;

  if (tvlUsd == null) blockers.push("pool_tvl_unobserved");
  if (apyBps == null) blockers.push("pool_apy_unmeasured");
  if (entrySlippageBps == null) blockers.push("entry_slippage_unmeasured");
  if (exitSlippageBps == null) blockers.push("exit_slippage_unmeasured");
  if (gatewayRoundTripCostBps == null) blockers.push("gateway_round_trip_cost_unmeasured");
  if (offrampCostBps == null) blockers.push("offramp_cost_unmeasured");

  return {
    blockers,
    chain,
    family,
    tvlUsd,
    apyBps,
    entrySlippageBps,
    exitSlippageBps,
    gatewayRoundTripCostBps,
    offrampCostBps,
    poolPaused,
    protocol,
    poolId: pool.poolId || null,
    symbol: pool.symbol || null,
    evidenceClass,
  };
}

function policyGates(config, pool) {
  const gates = [];
  if (pool.poolPaused) gates.push("pool_paused");
  if (pool.tvlUsd != null && config.minPoolTvlUsd != null && pool.tvlUsd < config.minPoolTvlUsd) {
    gates.push("pool_tvl_below_minimum");
  }
  if (
    pool.tvlUsd != null &&
    config.perTradeCapUsd != null &&
    config.maxPoolSharePct != null &&
    pool.tvlUsd > 0 &&
    (config.perTradeCapUsd / pool.tvlUsd) * 100 > config.maxPoolSharePct
  ) {
    gates.push("position_share_of_pool_excessive");
  }
  if (pool.apyBps != null && config.minNetApyBps != null && pool.apyBps < config.minNetApyBps) {
    gates.push("pool_apy_below_threshold");
  }
  if (
    pool.entrySlippageBps != null &&
    config.maxEntrySlippageBps != null &&
    pool.entrySlippageBps > config.maxEntrySlippageBps
  ) {
    gates.push("entry_slippage_above_threshold");
  }
  if (
    pool.exitSlippageBps != null &&
    config.maxExitSlippageBps != null &&
    pool.exitSlippageBps > config.maxExitSlippageBps
  ) {
    gates.push("exit_slippage_above_threshold");
  }
  if (
    pool.gatewayRoundTripCostBps != null &&
    config.maxRoundTripCostBps != null &&
    pool.gatewayRoundTripCostBps > config.maxRoundTripCostBps
  ) {
    gates.push("round_trip_cost_above_threshold");
  }
  if (
    pool.offrampCostBps != null &&
    config.maxOfframpCostBps != null &&
    pool.offrampCostBps > config.maxOfframpCostBps
  ) {
    gates.push("offramp_cost_above_threshold");
  }
  // YCE-001: deepen evidenceClass application in policyGates for candidate selection
  // Only protocol_receipt_bound pools (those with existing canary/receipt bindings) are allowed
  // through to shadow_ready / live_candidate. Others remain analysis surfaces only.
  if (pool.evidenceClass && pool.evidenceClass !== "protocol_receipt_bound") {
    gates.push("protocol_not_receipt_bound");
  }
  return gates;
}

function projectedEconomics(config, pool) {
  if (pool.apyBps == null || pool.gatewayRoundTripCostBps == null) return null;
  const principalUsd = config.perTradeCapUsd;
  const horizonDays = 30;
  const yieldUsd = principalUsd * (pool.apyBps / 10_000) * (horizonDays / 365);
  const entrySlippageUsd = principalUsd * ((pool.entrySlippageBps ?? 0) / 10_000);
  const exitSlippageUsd = principalUsd * ((pool.exitSlippageBps ?? 0) / 10_000);
  const roundTripCostUsd = principalUsd * (pool.gatewayRoundTripCostBps / 10_000);
  const offrampCostUsd = principalUsd * ((pool.offrampCostBps ?? 0) / 10_000);
  const netUsd = yieldUsd - entrySlippageUsd - exitSlippageUsd - roundTripCostUsd - offrampCostUsd;
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
  // Input receipts shape (from loadYieldReceiptEvidence): each item is
  // { signerBacked, result, realizedNetUsd, entryExitProven, yieldProof? }
  // The optional yieldProof (post schema enhancement) carries the rich per-pool yield evidence:
  //   entryApy, entryTvlUsd, exitApy, exitTvlUsd, holdingPeriodHours, entryNewPool, ...
  // This enables future smarter allocation & risk logic in evaluate() / policyGates without breaking
  // the current aggregate counts used for shadowReady / liveReady gating.
  // All new fields are additive / backward-compatible; existing receiptEvidence consumers unaffected.
  const signerBacked = receipts.filter((r) => r?.signerBacked === true);
  const passed = signerBacked.filter((r) => r?.result === "passed");
  const realized = passed.reduce(
    (sum, r) => sum + (Number.isFinite(Number(r.realizedNetUsd)) ? Number(r.realizedNetUsd) : 0),
    0,
  );
  const entryExitProvenCount = signerBacked.filter((r) => r?.entryExitProven === true).length;
  return Object.freeze({
    signerBackedCount: signerBacked.length,
    passedCount: passed.length,
    realizedNetUsd: passed.length > 0 && Number.isFinite(realized) ? round(realized) : null,
    entryExitProvenCount,
    // shape note: richer per-receipt yieldProof data (if present in input) is intentionally left for direct
    // inspection by callers (e.g. policy) or future extension of this aggregator.
  });
}

export function evaluateDefiLlamaYieldAdapter({
  config = DEFAULT_CONFIG,
  market = {},
  receipts = [],
  now = null,
} = {}) {
  const validation = validateDefiLlamaYieldConfig(config);
  const pools = Array.isArray(market.pools) ? market.pools : [];

  // Evaluate each pool independently and pick the best net candidate
  const poolReports = pools.map((poolRaw) => {
    const pool = assessPool(poolRaw);
    const gates = policyGates(config, pool);
    const economics = projectedEconomics(config, pool);
    const blockers = [...pool.blockers, ...gates];

    const shadowReady =
      validation.ok &&
      pool.blockers.length === 0 &&
      gates.length === 0 &&
      economics != null &&
      economics.projectedNetUsd > 0;

    return {
      pool,
      blockers: Object.freeze(blockers),
      gates: Object.freeze(gates),
      economics,
      shadowReady,
      netUsd: economics?.projectedNetUsd ?? null,
    };
  });

  const best =
    poolReports.filter((r) => r.shadowReady).sort((a, b) => (b.netUsd ?? -Infinity) - (a.netUsd ?? -Infinity))[0] ||
    null;

  const evidence = receiptEvidence(receipts);

  const blockers = best
    ? best.blockers
    : [
        ...(validation.ok ? [] : ["config_invalid"]),
        ...(poolReports.length === 0 ? ["no_pools_measured"] : ["no_pool_passes_policy"]),
      ];

  const shadowReady = best != null;

  const bestEvidenceClass = best?.pool?.evidenceClass || null;

  // YCE-001: deepen evidenceClass in evaluate + candidate selection:
  // liveReady now explicitly requires the selected best pool to be receipt_bound
  // (in addition to having real signer-backed entry/exit receipts). This ensures
  // only pools with proven bindings + actual execution proof promote to live_candidate.
  const liveReady =
    shadowReady &&
    bestEvidenceClass === "protocol_receipt_bound" &&
    evidence.passedCount >= 1 &&
    evidence.realizedNetUsd != null &&
    evidence.realizedNetUsd > 0 &&
    evidence.entryExitProvenCount >= 1;

  const intent =
    shadowReady || liveReady
      ? Object.freeze({
          strategyId: config?.id || STRATEGY_ID,
          chain: best?.pool?.chain || null,
          amountUsd: config?.perTradeCapUsd || 0,
          intentType: "entry",
          executionReason: "strategy_tick",
          protocol: best?.pool?.protocol || null,
          poolId: best?.pool?.poolId || null,
        })
      : null;

  return Object.freeze({
    strategyId: config?.id || STRATEGY_ID,
    generatedAt: typeof now === "string" ? now : null,
    validation,
    market: Object.freeze({
      poolCount: pools.length,
      evaluatedCount: poolReports.length,
      passCount: poolReports.filter((r) => r.shadowReady).length,
      bestPool: best
        ? Object.freeze({
            chain: best.pool.chain,
            protocol: best.pool.protocol,
            poolId: best.pool.poolId,
            symbol: best.pool.symbol,
            tvlUsd: best.pool.tvlUsd,
            apyBps: best.pool.apyBps,
            // YCE-001: evidenceClass now surfaced in bestPool for candidate selection / dashboard
            evidenceClass: best.pool.evidenceClass || null,
          })
        : null,
    }),
    gates: best ? best.gates : Object.freeze([]),
    economics: best ? best.economics : null,
    evidence,
    blockers: Object.freeze(blockers),
    shadowReady,
    liveReady,
    promotion: liveReady ? "live_candidate" : shadowReady ? "shadow_ready" : "blocked",
    mode: liveReady ? "live_candidate" : shadowReady ? "shadow_ready" : "blocked",
    evidenceClass: bestEvidenceClass,
    intent,
    microCanaryStatus:
      evidence.signerBackedCount >= 3
        ? "micro_canary_repeatable"
        : evidence.signerBackedCount >= 1
          ? "minimal_live_proof_exists"
          : shadowReady
            ? "micro_canary_ready"
            : "not_started",
  });
}

export function summarizeDefiLlamaYieldAdapter(report) {
  if (!report) return null;
  return Object.freeze({
    strategyId: report.strategyId,
    promotion: report.promotion,
    blockerCount: report.blockers.length,
    topBlocker: report.blockers[0] || null,
    projectedNetUsd: report.economics?.projectedNetUsd ?? null,
    signerBackedReceipts: report.evidence.signerBackedCount,
    entryExitProvenCount: report.evidence.entryExitProvenCount,
    bestPoolChain: report.market?.bestPool?.chain || null,
    bestPoolProtocol: report.market?.bestPool?.protocol || null,
    // YCE-001: evidenceClass in summary for quick candidate filtering
    bestPoolEvidenceClass: report.evidenceClass || report.market?.bestPool?.evidenceClass || null,
  });
}

export const DEFILLAMA_YIELD_REQUIRED_CONFIG_FIELDS = REQUIRED_CONFIG_FIELDS;
