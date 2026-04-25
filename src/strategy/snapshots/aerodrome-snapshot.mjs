// Aerodrome Snapshot Normalizer.
//
// Pure function. Takes DefiLlama yields /pools response and normalizes
// into the partial `market` shape evaluateAerodromeClAdapter() consumes.
//
// DefiLlama yields endpoint:
//   GET https://yields.llama.fi/pools
//   → { status, data: Pool[] }
//
// Pool fields we read:
//   chain, project, symbol, tvlUsd, apyBase, apyReward
//
// Missing (expected — filled by gateway-round-trip snapshot):
//   realizedIlBps, outOfRangeTimePct, currentTickOffsetBps,
//   entrySlippageBps, exitSlippageBps, gatewayQuoteFresh,
//   gatewayRoundTripCostBps

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function decimalToBps(decimal) {
  if (typeof decimal !== "number" || !Number.isFinite(decimal)) return null;
  return Math.round(decimal * 10_000);
}

function pickPool(pools, { symbolIncludes, poolAddress }) {
  if (!Array.isArray(pools)) return null;
  if (poolAddress) {
    const a = String(poolAddress).toLowerCase();
    return pools.find((p) => p && String(p.pool).toLowerCase() === a) || null;
  }
  if (symbolIncludes) {
    const s = symbolIncludes.toLowerCase();
    return pools.find((p) => {
      if (!p) return false;
      const sym = String(p.symbol || "").toLowerCase();
      return sym.includes(s);
    }) || null;
  }
  return null;
}

const AERODROME_PROJECTS = new Set(["aerodrome-slipstream", "aerodrome-v1"]);

export function normalizeAerodromeSnapshot({ response, symbolIncludes, poolAddress, chainId = 8453 }) {
  const pools = response?.data || response || [];
  const chainName = chainId === 8453 ? "Base" : String(chainId);

  const candidates = pools.filter((p) =>
    p &&
    String(p.chain || "").toLowerCase() === chainName.toLowerCase() &&
    AERODROME_PROJECTS.has(String(p.project || "").toLowerCase()),
  );

  const pool = pickPool(candidates, { symbolIncludes, poolAddress });

  const poolTvlUsd = num(pool?.tvlUsd);
  const poolFeeAprBps = decimalToBps(pool?.apyBase);
  const incentiveAprBps = decimalToBps(pool?.apyReward);

  const market = {
    poolTvlUsd,
    poolFeeAprBps,
    incentiveAprBps,
    // The following are not available from DefiLlama; downstream
    // gateway-round-trip snapshot + on-chain tick observation fills them.
    realizedIlBps: null,
    outOfRangeTimePct: null,
    currentTickOffsetBps: null,
    entrySlippageBps: null,
    exitSlippageBps: null,
    gatewayQuoteFresh: null,
    gatewayRoundTripCostBps: null,
  };

  const missing = [];
  if (!pool) missing.push("pool_metadata");
  if (poolTvlUsd == null) missing.push("pool_tvl");
  if (poolFeeAprBps == null) missing.push("pool_fee_apr");
  if (incentiveAprBps == null) missing.push("incentive_apr");
  missing.push("realized_il", "out_of_range_time", "current_tick_offset",
    "entry_slippage", "exit_slippage", "gateway_quote_fresh",
    "gateway_round_trip_cost");

  return Object.freeze({
    schemaVersion: 1,
    poolAddress: pool?.pool || poolAddress || null,
    poolSymbol: pool?.symbol || null,
    chainId,
    market: Object.freeze(market),
    partial: true,
    missing: Object.freeze(missing),
  });
}
