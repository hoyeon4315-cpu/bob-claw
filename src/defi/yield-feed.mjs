import { simulateTransactionCall } from "../evm/transaction-read.mjs";

const MOONWELL_BASE_MARKETS = Object.freeze({
  USDC: Object.freeze({
    asset: "USDC",
    marketId: "base:usdc",
    mTokenAddress: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
    sourceLabel: "Moonwell USDC",
    llamaPoolId: "moonwell-base-usdc",
  }),
  cbBTC: Object.freeze({
    asset: "cbBTC",
    marketId: "base:cbbtc",
    mTokenAddress: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
    sourceLabel: "Moonwell cbBTC",
    llamaPoolId: "moonwell-base-cbbtc",
  }),
});

const SUPPLY_RATE_PER_BLOCK_SELECTOR = "0xae5b4862";
const BASE_BLOCK_TIME_SECONDS = 2;
const BLOCKS_PER_YEAR = Math.round((365 * 24 * 3600) / BASE_BLOCK_TIME_SECONDS);
const MANTISSA = 1e18;

const LLAMA_YIELDS_URL = "https://yields.llama.fi/pools";

function ratePerBlockToAprBps(ratePerBlock) {
  if (!Number.isFinite(ratePerBlock) || ratePerBlock < 0) return null;
  const aprFraction = ratePerBlock * BLOCKS_PER_YEAR / MANTISSA;
  return Math.round(aprFraction * 10_000 * 100) / 100;
}

function decodeUint256(hex) {
  if (!hex || hex === "0x" || hex === "0x0") return 0;
  const value = BigInt(hex);
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function fetchLlamaYields() {
  try {
    const response = await fetch(LLAMA_YIELDS_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const data = await response.json();
    return (data?.data || []).filter((pool) =>
      pool.project?.toLowerCase().startsWith("moonwell") && pool.chain?.toLowerCase() === "base"
    );
  } catch {
    return null;
  }
}

function matchLlamaPool(market, llamaPools) {
  if (!llamaPools || !llamaPools.length) return null;
  return llamaPools.find((pool) => {
    const project = (pool.project || "").toLowerCase();
    const symbol = (pool.symbol || "").toLowerCase();
    if (project !== "moonwell-lending") return false;
    if (market.asset === "USDC" && symbol === "usdc") return true;
    if (market.asset === "cbBTC" && (symbol === "cbbtc" || symbol === "cbtc")) return true;
    return false;
  });
}

export async function readMoonwellSupplyRates({
  chain = "base",
  markets = MOONWELL_BASE_MARKETS,
  simulateImpl = simulateTransactionCall,
} = {}) {
  const observedAt = new Date().toISOString();
  const llamaPools = await fetchLlamaYields();

  const results = [];
  for (const [asset, market] of Object.entries(markets || {})) {
    const mTokenAddress = market?.mTokenAddress;
    if (!mTokenAddress) continue;

    const llamaMatch = matchLlamaPool(market, llamaPools);
    let supplyAprBps = llamaMatch?.apy != null ? Math.round(llamaMatch.apy * 100) / 100 : null;
    let tvlUsd = llamaMatch?.tvlUsd != null ? Math.round(llamaMatch.tvlUsd) : null;

    let supplyRatePerBlock = null;
    let error = null;
    try {
      const supplyResult = await simulateImpl(chain, {
        to: mTokenAddress,
        data: SUPPLY_RATE_PER_BLOCK_SELECTOR,
      });
      supplyRatePerBlock = decodeUint256(supplyResult);
      if (supplyRatePerBlock !== null && supplyRatePerBlock > 0 && supplyAprBps === null) {
        supplyAprBps = ratePerBlockToAprBps(supplyRatePerBlock);
      }
    } catch (e) {
      error = e.message;
    }

    results.push({
      chain,
      asset,
      marketId: market.marketId || null,
      mTokenAddress,
      sourceLabel: market.sourceLabel || null,
      supplyRatePerBlock,
      supplyAprBps,
      tvlUsd,
      llamaSource: llamaMatch ? "defillama" : null,
      blocksPerYear: BLOCKS_PER_YEAR,
      blockTimeSeconds: BASE_BLOCK_TIME_SECONDS,
      observedAt,
      error,
    });
  }

  return {
    schemaVersion: 1,
    source: "moonwell_base_onchain",
    observedAt,
    chain,
    marketCount: results.length,
    rates: results,
  };
}

export function latestYieldFeedRecord(records = []) {
  return [...(records || [])]
    .filter((r) => r?.schemaVersion === 1 && Array.isArray(r?.rates))
    .sort((a, b) => new Date(b.observedAt || 0) - new Date(a.observedAt || 0))[0] || null;
}

export function yieldFeedIntegrated(feedRecord = null) {
  if (!feedRecord?.rates?.length) return false;
  return feedRecord.rates.some((r) => Number.isFinite(r.supplyAprBps) && r.supplyAprBps > 0);
}