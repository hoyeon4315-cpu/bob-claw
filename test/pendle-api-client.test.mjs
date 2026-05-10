import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createPendleApiClient,
  PENDLE_API_BASE,
} from "../src/research/pendle-api-client.mjs";

describe("pendle-api-client", () => {
  it("createPendleApiClient returns a client object", () => {
    const client = createPendleApiClient();
    assert.equal(typeof client.fetchMarkets, "function");
    assert.equal(typeof client.fetchMarketDepth, "function");
  });

  it("fetchMarkets returns array-like shape even on error", async () => {
    const client = createPendleApiClient({
      fetch: async () => ({ ok: false, status: 429, text: async () => "rate limited" }),
    });
    const result = await client.fetchMarkets({ chain: "base" });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it("fetchMarketDepth returns depth shape even on error", async () => {
    const client = createPendleApiClient({
      fetch: async () => ({ ok: false, status: 429, text: async () => "rate limited" }),
    });
    const result = await client.fetchMarketDepth({
      marketAddress: "0x1234",
      chain: "base",
    });
    assert.equal(typeof result, "object");
    assert.equal(result.marketAddress, "0x1234");
    assert.equal(result.chain, "base");
    assert.equal(result.depthUsd, null);
    assert.equal(result.impliedAprPct, null);
  });

  it("caches fetchMarkets for 5 minutes", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => [{ address: "0xA", chainId: 8453 }],
      };
    };
    const client = createPendleApiClient({ fetch: mockFetch });
    const r1 = await client.fetchMarkets({ chain: "base" });
    const r2 = await client.fetchMarkets({ chain: "base" });
    assert.equal(callCount, 1);
    assert.deepEqual(r1, r2);
  });

  it("cache keys are per-chain", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => [{ address: `0x${callCount}`, chainId: 8453 }],
      };
    };
    const client = createPendleApiClient({ fetch: mockFetch });
    await client.fetchMarkets({ chain: "base" });
    await client.fetchMarkets({ chain: "ethereum" });
    assert.equal(callCount, 2);
  });

  it("rate limit returns graceful empty fallback", async () => {
    const client = createPendleApiClient({
      fetch: async () => ({ ok: false, status: 429, text: async () => "rate limited" }),
    });
    const markets = await client.fetchMarkets({ chain: "base" });
    assert.deepEqual(markets, []);
  });
});
