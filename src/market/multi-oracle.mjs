import { getCoinGeckoPricesUsd } from "./prices.mjs";

export function featureEnabled(profile = {}) {
  if (typeof profile === "string") return true;
  return profile.multiOracle !== false;
}

async function fetchCoinGeckoPrice(token) {
  const prices = await getCoinGeckoPricesUsd();
  return prices?.tokenByKey?.[token] ?? prices?.nativeByChain?.[token] ?? null;
}

export async function aggregatePrice({ token, sources = ["coingecko", "uniswap_v3_twap"], fetchers = {} } = {}) {
  const results = [];
  const fetcherMap = {
    coingecko: fetchers.coingecko || fetchCoinGeckoPrice,
    uniswap_v3_twap: fetchers.uniswapV3Twap || (async () => null),
    chainlink: fetchers.chainlink || (async () => null),
  };

  for (const source of sources) {
    const fetcher = fetcherMap[source];
    if (!fetcher) continue;
    try {
      const price = await fetcher(token);
      if (Number.isFinite(price)) {
        results.push({ source, price });
      }
    } catch {
      // ignore single source failure
    }
  }

  if (results.length === 0) {
    return { median: null, divergencePct: null, sources: results, flag: null };
  }

  const prices = results.map((r) => r.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 1 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

  let maxDeviation = 0;
  for (const p of prices) {
    if (median === 0) continue;
    const deviation = Math.abs(p - median) / Math.abs(median);
    if (deviation > maxDeviation) maxDeviation = deviation;
  }
  const divergencePct = maxDeviation * 100;

  const flag = divergencePct > 1 ? "oracle_divergence" : null;

  return { median, divergencePct, sources: results, flag };
}
