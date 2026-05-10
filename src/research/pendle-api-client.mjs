export const PENDLE_API_BASE = "https://api-v2.pendle.finance/core/v1";

const CACHE_TTL_MS = 5 * 60 * 1000;

function buildCacheKey(chain, suffix = "markets") {
  return `pendle_${suffix}_${chain}`;
}

export function createPendleApiClient({ fetch: fetchFn = globalThis.fetch } = {}) {
  const cache = new Map();

  async function cachedFetch(key, fetcher) {
    const now = Date.now();
    const entry = cache.get(key);
    if (entry && now - entry.ts < CACHE_TTL_MS) {
      return entry.data;
    }
    const data = await fetcher();
    cache.set(key, { ts: now, data });
    return data;
  }

  async function fetchMarkets({ chain }) {
    const key = buildCacheKey(chain, "markets");
    return cachedFetch(key, async () => {
      try {
        const res = await fetchFn(`${PENDLE_API_BASE}/markets?chain=${encodeURIComponent(chain)}`);
        if (!res.ok) {
          if (res.status === 429) return [];
          return [];
        }
        const json = await res.json();
        return Array.isArray(json) ? json : json?.markets || [];
      } catch {
        return [];
      }
    });
  }

  async function fetchMarketDepth({ marketAddress, chain }) {
    const key = buildCacheKey(chain, `depth_${marketAddress}`);
    return cachedFetch(key, async () => {
      try {
        const res = await fetchFn(
          `${PENDLE_API_BASE}/markets/${encodeURIComponent(marketAddress)}?chain=${encodeURIComponent(chain)}`,
        );
        if (!res.ok) {
          return {
            marketAddress,
            chain,
            depthUsd: null,
            impliedAprPct: null,
          };
        }
        const json = await res.json();
        return {
          marketAddress,
          chain,
          depthUsd: json?.liquidity?.usd ?? null,
          impliedAprPct: json?.impliedApy != null ? Number(json.impliedApy) * 100 : null,
        };
      } catch {
        return {
          marketAddress,
          chain,
          depthUsd: null,
          impliedAprPct: null,
        };
      }
    });
  }

  return Object.freeze({
    fetchMarkets,
    fetchMarketDepth,
  });
}
