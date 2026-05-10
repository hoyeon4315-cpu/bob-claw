const DEFILLAMA_POOLS_API = "https://yields.defillama.com/pools";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null;
let cacheTimestamp = 0;

export function featureEnabled(profile = {}) {
  if (typeof profile === "string") return true;
  return profile.defiLlama !== false;
}

async function fetchWithCache(customFetcher) {
  const now = Date.now();
  if (cache && now - cacheTimestamp < CACHE_TTL_MS) {
    return cache;
  }
  try {
    const response = await (customFetcher || fetch)(DEFILLAMA_POOLS_API, {
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429) {
      if (cache) {
        return cache;
      }
      throw new Error("rate_limit");
    }
    if (!response.ok) {
      throw new Error(`defillama_fetch_failed:${response.status}`);
    }
    const data = await response.json();
    cache = data;
    cacheTimestamp = now;
    return data;
  } catch (error) {
    if (cache) {
      return cache;
    }
    throw error;
  }
}

export function resetCache() {
  cache = null;
  cacheTimestamp = 0;
}

export async function fetchPoolYields({ protocol, chain, fetcher, profile } = {}) {
  if (!featureEnabled(profile)) {
    return null;
  }
  const data = await fetchWithCache(fetcher);
  const pools = Array.isArray(data) ? data : data?.data || [];
  const normalizedProtocol = String(protocol || "").toLowerCase();
  const normalizedChain = String(chain || "").toLowerCase();
  const matches = pools.filter((pool) => {
    const p = String(pool.project || pool.protocol || "").toLowerCase();
    const c = String(pool.chain || "").toLowerCase();
    return p === normalizedProtocol && c === normalizedChain;
  });
  return matches.map((pool) => ({
    pool: pool.pool,
    apyBase: Number(pool.apyBase) || 0,
    apyReward: Number(pool.apyReward) || 0,
    apy: Number(pool.apy) || 0,
    tvlUsd: Number(pool.tvlUsd) || 0,
  }));
}
