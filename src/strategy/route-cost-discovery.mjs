import { fetchAcrossQuote } from "../executor/bridges/across-wrapper.mjs";
import { fetchLiFiQuote } from "../executor/bridges/lifi-wrapper.mjs";
import { fetchNativeBtcTunnelQuote } from "../executor/bridges/native-btc-tunnel-wrapper.mjs";
import { ROUTE_COST_LIMITS } from "../config/route-cost-limits.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const PROVIDER_REGISTRY = Object.freeze({
  across: fetchAcrossQuote,
  lifi: fetchLiFiQuote,
  native_btc_tunnel: fetchNativeBtcTunnelQuote,
});

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30 * 60 * 1000;
const CACHE_TTL_MS = 90_000;

export const circuitBreakerState = new Map();

function isCircuitOpen(provider, nowMs) {
  const state = circuitBreakerState.get(provider);
  if (!state) return false;
  if (state.failures < CIRCUIT_BREAKER_FAILURE_THRESHOLD) return false;
  if (nowMs - state.lastFailureAt < CIRCUIT_BREAKER_COOLDOWN_MS) return true;
  circuitBreakerState.delete(provider);
  return false;
}

function recordProviderResult(provider, ok, nowMs) {
  const state = circuitBreakerState.get(provider) || {
    failures: 0,
    lastFailureAt: 0,
  };
  if (ok) {
    state.failures = 0;
  } else {
    state.failures += 1;
    state.lastFailureAt = nowMs;
  }
  circuitBreakerState.set(provider, state);
}

function routeCacheKey(request = {}) {
  return [
    request.srcChain,
    request.dstChain,
    request.srcAsset,
    request.dstAsset,
    request.amount,
  ].join(":");
}

async function readRouteCache(cachePath) {
  try {
    const raw = await readFile(cachePath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines.map((line) => JSON.parse(line));
    const now = Date.now();
    return entries.filter((e) => now - e.cachedAt < CACHE_TTL_MS);
  } catch {
    return [];
  }
}

async function writeRouteCache(cachePath, entries) {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
  } catch {
    // ignore
  }
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(cachePath, lines, "utf8");
}

function effectiveCostBps(quote, inputUsd) {
  if (!Number.isFinite(inputUsd) || inputUsd <= 0) return Number.POSITIVE_INFINITY;
  const feeAmount = Number(quote.feeAmount ?? 0);
  const feeUsd = Number(quote.feeUsd ?? 0);
  const toAmount = Number(quote.toAmount ?? 0);
  const outputUsd = toAmount > 0 ? toAmount : Math.max(0, inputUsd - feeAmount - feeUsd);
  const estimatedSrcGasUsd = Number(quote.estimatedSrcGasUsd ?? 0);
  return ((inputUsd - outputUsd) / inputUsd) * 10000 + (estimatedSrcGasUsd / inputUsd) * 10000;
}

export async function fetchRouteQuotes(request = {}, {
  providers = ["across", "lifi"],
  fetchFn = globalThis.fetch,
  timeoutMs = 15000,
  cachePath = null,
  now = Date.now(),
} = {}) {
  const key = routeCacheKey(request);

  if (cachePath) {
    const cached = await readRouteCache(cachePath);
    const hit = cached.find((e) => e.key === key);
    if (hit) {
      return {
        quotes: hit.quotes,
        errors: hit.errors,
        fromCache: true,
      };
    }
  }

  const inputUsd = Number(request.amountUsd ?? request.amount ?? 0);
  const quotes = [];
  const errors = [];

  await Promise.all(
    providers.map(async (providerId) => {
      if (isCircuitOpen(providerId, now)) {
        errors.push({ provider: providerId, error: "circuit_open" });
        return;
      }

      const fetchQuote = PROVIDER_REGISTRY[providerId];
      if (!fetchQuote) {
        errors.push({ provider: providerId, error: "unknown_provider" });
        return;
      }

      try {
        const quote = await fetchQuote(
          {
            srcChain: request.srcChain,
            dstChain: request.dstChain,
            srcToken: request.srcAsset,
            dstToken: request.dstAsset,
            amount: request.amount,
            srcChainId: request.srcChainId,
            dstChainId: request.dstChainId,
            fromAddress: request.fromAddress,
          },
          { fetchFn, timeoutMs },
        );

        recordProviderResult(providerId, quote.ok, now);

        if (!quote.ok) {
          errors.push({ provider: providerId, error: quote.error });
          return;
        }

        quotes.push({
          provider: providerId,
          inputUsd,
          outputUsd: quote.toAmount ?? Math.max(0, inputUsd - (quote.feeAmount ?? 0) - (quote.feeUsd ?? 0)),
          effectiveCostBps: effectiveCostBps(quote, inputUsd),
          estimatedTimeMs: quote.estimatedTimeMs,
          validUntil: quote.validUntil,
          raw: quote,
        });
      } catch (err) {
        recordProviderResult(providerId, false, now);
        errors.push({ provider: providerId, error: err.message || "fetch_exception" });
      }
    }),
  );

  if (cachePath) {
    const cached = await readRouteCache(cachePath);
    cached.push({ key, quotes, errors, cachedAt: now });
    await writeRouteCache(cachePath, cached);
  }

  return { quotes, errors, fromCache: false };
}

export function pickCheapestRoute({
  quotes = [],
  constraints = {},
  limits = ROUTE_COST_LIMITS,
} = {}) {
  const assetCategory = constraints.assetCategory || "default";
  const maxBps =
    constraints.maxAllowedCostBps ??
    limits.maxAllowedCostBps[assetCategory] ??
    limits.maxAllowedCostBps.default;

  const eligible = quotes.filter((q) => q.effectiveCostBps <= maxBps);
  eligible.sort((a, b) => a.effectiveCostBps - b.effectiveCostBps);

  const cheapest = eligible[0] ?? null;
  const fallbacks = eligible.slice(1);
  const rejected = quotes.filter((q) => q.effectiveCostBps > maxBps);

  return {
    cheapest,
    fallbacks,
    rejected,
    eligibleCount: eligible.length,
    maxAllowedCostBps: maxBps,
  };
}
