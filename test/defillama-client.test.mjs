import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPoolYields, featureEnabled, resetCache } from "../src/market/defillama-client.mjs";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ defiLlama: false }), false);
});

function mockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("fetch returns structured yield data", async () => {
  resetCache();
  const mockFetcher = async () => mockResponse([
    { project: "aave", chain: "Ethereum", pool: "pool1", apyBase: 3, apyReward: 1, apy: 4, tvlUsd: 1000000 },
    { project: "aave", chain: "Ethereum", pool: "pool2", apyBase: 2, apyReward: 0, apy: 2, tvlUsd: 500000 },
    { project: "compound", chain: "Base", pool: "pool3", apyBase: 5, apyReward: 0, apy: 5, tvlUsd: 2000000 },
  ]);
  const yields = await fetchPoolYields({ protocol: "aave", chain: "Ethereum", fetcher: mockFetcher });
  assert.equal(yields.length, 2);
  assert.equal(yields[0].pool, "pool1");
  assert.equal(yields[0].apy, 4);
  assert.equal(yields[0].tvlUsd, 1000000);
});

test("fetch keeps missing numeric yield data unknown instead of zero", async () => {
  resetCache();
  const mockFetcher = async () => mockResponse([
    { project: "aave", chain: "Ethereum", pool: "pool1", apyBase: null, apyReward: null, apy: null, tvlUsd: null },
  ]);
  const yields = await fetchPoolYields({ protocol: "aave", chain: "Ethereum", fetcher: mockFetcher });
  assert.equal(yields.length, 1);
  assert.equal(yields[0].apyBase, null);
  assert.equal(yields[0].apyReward, null);
  assert.equal(yields[0].apy, null);
  assert.equal(yields[0].tvlUsd, null);
});

test("fetch with no match returns empty array", async () => {
  resetCache();
  const mockFetcher = async () => mockResponse([
    { project: "aave", chain: "Ethereum", pool: "pool1", apyBase: 3, apyReward: 1, apy: 4, tvlUsd: 1000000 },
  ]);
  const yields = await fetchPoolYields({ protocol: "compound", chain: "Ethereum", fetcher: mockFetcher });
  assert.equal(yields.length, 0);
});

test("rate limit returns stale cache rather than error", async () => {
  resetCache();
  let callCount = 0;
  const mockFetcher = async () => {
    callCount += 1;
    if (callCount === 1) {
      return mockResponse([
        { project: "aave", chain: "Ethereum", pool: "pool1", apyBase: 3, apyReward: 1, apy: 4, tvlUsd: 1000000 },
      ]);
    }
    return mockResponse({}, 429);
  };
  // first call primes cache
  const first = await fetchPoolYields({ protocol: "aave", chain: "Ethereum", fetcher: mockFetcher });
  assert.equal(first.length, 1);
  // second call simulates rate limit and should return stale cache
  const second = await fetchPoolYields({ protocol: "aave", chain: "Ethereum", fetcher: mockFetcher });
  assert.equal(second.length, 1);
});

test("feature disabled returns null", async () => {
  resetCache();
  const yields = await fetchPoolYields({ protocol: "aave", chain: "Ethereum", fetcher: async () => mockResponse([]), profile: { defiLlama: false } });
  assert.equal(yields, null);
});
