// Berachain Snapshot Normalizer.
//
// Pure function. Takes DefiLlama yields /pools response and normalizes
// into the partial `market` shape evaluateBerachainAdapter() consumes.
//
// DefiLlama yields endpoint:
//   GET https://yields.llama.fi/pools
//   → { status, data: Pool[] }
//
// Pool fields we read:
//   chain, project, symbol, tvlUsd, apyBase, apyReward
//
// We search Bend (lending) and BEX (DEX) pools on Berachain by
// project name and symbol.  BGT-specific fields are not available
// from DefiLlama and remain null — the adapter will block until
// a BGT oracle snapshot is merged in downstream.

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function decimalToBps(decimal) {
  if (typeof decimal !== "number" || !Number.isFinite(decimal)) return null;
  return Math.round(decimal * 10_000);
}

function pickPool(pools, { project, symbolIncludes }) {
  if (!Array.isArray(pools)) return null;
  const proj = String(project || "").toLowerCase();
  const sym = String(symbolIncludes || "").toLowerCase();
  return pools.find((p) => {
    if (!p) return false;
    if (proj && String(p.project || "").toLowerCase() !== proj) return false;
    if (sym && !String(p.symbol || "").toLowerCase().includes(sym)) return false;
    return true;
  }) || null;
}

export function normalizeBerachainSnapshot({
  response,
  lendingSymbolIncludes = "WBTC",
  lendingProject = "bend",
  lpSymbolIncludes = "WBTC",
  lpProject = "bex",
  chainId = 80094,
} = {}) {
  const pools = response?.data || response || [];
  const chainName = chainId === 80094 ? "Berachain" : String(chainId);

  const candidates = pools.filter((p) =>
    p &&
    String(p.chain || "").toLowerCase() === chainName.toLowerCase(),
  );

  const lendingPool = pickPool(candidates, {
    project: lendingProject,
    symbolIncludes: lendingSymbolIncludes,
  });

  const lpPool = pickPool(candidates, {
    project: lpProject,
    symbolIncludes: lpSymbolIncludes,
  });

  const lendingTvlUsd = num(lendingPool?.tvlUsd);
  const lendingSupplyAprBps = decimalToBps(lendingPool?.apyBase);
  const lpTvlUsd = num(lpPool?.tvlUsd);
  const lpFeeAprBps = decimalToBps(lpPool?.apyBase);
  // DefiLlama apyReward is total reward APR (includes BGT if indexed)
  const bgtAprBps = decimalToBps(lpPool?.apyReward);

  const market = {
    lendingTvlUsd,
    lendingSupplyAprBps,
    lpTvlUsd,
    lpFeeAprBps,
    lpRealizedIlBps: null,
    bgtAprBps,
    bgtOracleDriftBps: null,
    bgtSpotLiquidityUsd: null,
    entrySlippageBps: null,
    exitSlippageBps: null,
    gatewayQuoteFresh: null,
    gatewayRoundTripCostBps: null,
    offrampCostBps: null,
  };

  const missing = [];
  if (!lendingPool) missing.push("lending_pool_metadata");
  if (lendingTvlUsd == null) missing.push("lending_tvl");
  if (lendingSupplyAprBps == null) missing.push("lending_supply_apr");
  if (!lpPool) missing.push("lp_pool_metadata");
  if (lpTvlUsd == null) missing.push("lp_tvl");
  if (lpFeeAprBps == null) missing.push("lp_fee_apr");
  if (bgtAprBps == null) missing.push("bgt_apr");
  missing.push("lp_realized_il", "bgt_oracle_drift", "bgt_spot_liquidity",
    "entry_slippage", "exit_slippage", "gateway_quote_fresh",
    "gateway_round_trip_cost", "offramp_cost");

  return Object.freeze({
    schemaVersion: 1,
    lendingPoolAddress: lendingPool?.pool || null,
    lpPoolAddress: lpPool?.pool || null,
    lendingSymbol: lendingPool?.symbol || null,
    lpSymbol: lpPool?.symbol || null,
    chainId,
    market: Object.freeze(market),
    partial: true,
    missing: Object.freeze(missing),
  });
}
