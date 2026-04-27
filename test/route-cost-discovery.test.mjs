import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchRouteQuotes,
  pickCheapestRoute,
  circuitBreakerState,
} from "../src/strategy/route-cost-discovery.mjs";

function mockFetch(responseBody, status = 200, delayMs = 0) {
  return async (_url, { signal } = {}) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => responseBody,
        });
      }, delayMs);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("AbortError");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };
}

test("pickCheapestRoute selects lowest effectiveCostBps", () => {
  const result = pickCheapestRoute({
    quotes: [
      { provider: "a", effectiveCostBps: 50 },
      { provider: "b", effectiveCostBps: 30 },
      { provider: "c", effectiveCostBps: 80 },
    ],
  });
  assert.equal(result.cheapest.provider, "b");
  assert.equal(result.fallbacks.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.eligibleCount, 3);
});

test("pickCheapestRoute rejects over maxAllowedCostBps", () => {
  const result = pickCheapestRoute({
    quotes: [
      { provider: "a", effectiveCostBps: 50 },
      { provider: "b", effectiveCostBps: 130 },
    ],
    constraints: { maxAllowedCostBps: 60 },
  });
  assert.equal(result.cheapest.provider, "a");
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].provider, "b");
});

test("pickCheapestRoute uses assetCategory limits", () => {
  const result = pickCheapestRoute({
    quotes: [{ provider: "a", effectiveCostBps: 70 }],
    constraints: { assetCategory: "stable_to_stable" },
  });
  assert.equal(result.cheapest, null);
  assert.equal(result.rejected.length, 1);
});

test("pickCheapestRoute returns null when no quotes", () => {
  const result = pickCheapestRoute({ quotes: [] });
  assert.equal(result.cheapest, null);
  assert.equal(result.eligibleCount, 0);
});

test("fetchRouteQuotes returns quotes from multiple providers", async () => {
  const result = await fetchRouteQuotes(
    { srcChain: "base", dstChain: "optimism", srcAsset: "usdc", dstAsset: "usdc", amount: 1000, amountUsd: 1000, srcChainId: 8453, dstChainId: 10, fromAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4" },
    {
      providers: ["lifi"],
      fetchFn: mockFetch({ estimate: { toAmount: "990000", toAmountMin: "985000", executionDuration: 240, feeCosts: [{ amountUsd: "2.5" }] } }),
    }
  );
  assert.equal(result.fromCache, false);
  assert.equal(result.quotes.length, 1);
  assert.equal(result.errors.length, 0);
});

test("fetchRouteQuotes handles provider errors", async () => {
  const result = await fetchRouteQuotes(
    { srcChain: "base", dstChain: "optimism", srcAsset: "usdc", dstAsset: "usdc", amount: 1000, amountUsd: 1000, srcChainId: 8453, dstChainId: 10, fromAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4" },
    {
      providers: ["across", "lifi"],
      fetchFn: mockFetch({}, 500),
    }
  );
  assert.equal(result.quotes.length, 0);
  assert.equal(result.errors.length, 2);
});

test("fetchRouteQuotes uses cache on second call", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-route-cache-"));
  const cachePath = join(root, "route-cost-cache.jsonl");
  const request = { srcChain: "base", dstChain: "optimism", srcAsset: "usdc", dstAsset: "usdc", amount: 1000, amountUsd: 1000, srcChainId: 8453, dstChainId: 10, fromAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4" };

  const first = await fetchRouteQuotes(request, {
    providers: ["lifi"],
    fetchFn: mockFetch({ estimate: { toAmount: "990000", toAmountMin: "985000", executionDuration: 240, feeCosts: [{ amountUsd: "2.5" }] } }),
    cachePath,
  });
  assert.equal(first.fromCache, false);
  assert.equal(first.quotes.length, 1);

  const second = await fetchRouteQuotes(request, {
    providers: ["lifi"],
    fetchFn: mockFetch({ estimate: { toAmount: "999000", toAmountMin: "998000", executionDuration: 120, feeCosts: [{ amountUsd: "1.0" }] } }),
    cachePath,
  });
  assert.equal(second.fromCache, true);
  assert.equal(second.quotes[0].outputUsd, 990000);

  await rm(root, { recursive: true, force: true });
});

test("fetchRouteQuotes respects circuit breaker after 3 failures", async () => {
  circuitBreakerState.clear();
  const request = { srcChain: "base", dstChain: "optimism", srcAsset: "usdc", dstAsset: "usdc", amount: 1000, amountUsd: 1000, srcChainId: 8453, dstChainId: 10 };

  for (let i = 0; i < 3; i++) {
    const r = await fetchRouteQuotes(request, { providers: ["across"], fetchFn: mockFetch({}, 500) });
    assert.equal(r.errors[0].error, "across_unsupported_pair");
  }

  const fourth = await fetchRouteQuotes(request, { providers: ["across"], fetchFn: mockFetch({}, 500) });
  assert.equal(fourth.errors[0].error, "circuit_open");
  assert.equal(fourth.quotes.length, 0);
});

test("fetchRouteQuotes handles unknown provider gracefully", async () => {
  const result = await fetchRouteQuotes(
    { srcChain: "base", dstChain: "optimism", srcAsset: "usdc", dstAsset: "usdc", amount: 1000 },
    { providers: ["fantasy_provider"] },
  );
  assert.equal(result.quotes.length, 0);
  assert.equal(result.errors[0].error, "unknown_provider");
});
