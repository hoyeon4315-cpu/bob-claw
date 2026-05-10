import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoverPendleCandidates } from "../src/cli/auto-research-loop.mjs";

describe("auto-research pendle discovery", () => {
  it("discoverPendleCandidates returns array", async () => {
    const candidates = await discoverPendleCandidates({
      fetchMarkets: async () => [
        { address: "0xA", chain: "base", ytSymbol: "YT-ETH" },
        { address: "0xB", chain: "ethereum", ytSymbol: "YT-USDC" },
      ],
      fetchMarketDepth: async () => ({
        marketAddress: "0xA",
        chain: "base",
        depthUsd: 200000,
        impliedAprPct: 15,
      }),
    });
    assert.ok(Array.isArray(candidates));
    assert.equal(candidates.length, 2);
  });

  it("scored candidates include strategyId and classKey", async () => {
    const candidates = await discoverPendleCandidates({
      fetchMarkets: async () => [
        { address: "0xA", chain: "base", ytSymbol: "YT-ETH", impliedAprPct: 15 },
      ],
      fetchMarketDepth: async () => ({
        marketAddress: "0xA",
        chain: "base",
        depthUsd: 200000,
        impliedAprPct: 15,
      }),
    });
    const c = candidates[0];
    assert.equal(c.classKey, "pendle_yt");
    assert.ok(c.strategyId.startsWith("pendle-yt-"));
    assert.equal(typeof c.score, "number");
  });

  it("filters out low-depth markets", async () => {
    const candidates = await discoverPendleCandidates({
      fetchMarkets: async () => [
        { address: "0xA", chain: "base", ytSymbol: "YT-ETH" },
        { address: "0xB", chain: "base", ytSymbol: "YT-LOW" },
      ],
      fetchMarketDepth: async ({ marketAddress }) =>
        marketAddress === "0xA"
          ? { marketAddress: "0xA", chain: "base", depthUsd: 200000, impliedAprPct: 15 }
          : { marketAddress: "0xB", chain: "base", depthUsd: 500, impliedAprPct: 15 },
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].marketAddress, "0xA");
  });

  it("never sets autoExecute true", async () => {
    const candidates = await discoverPendleCandidates({
      fetchMarkets: async () => [
        { address: "0xA", chain: "base", ytSymbol: "YT-ETH" },
      ],
      fetchMarketDepth: async () => ({
        marketAddress: "0xA",
        chain: "base",
        depthUsd: 200000,
        impliedAprPct: 15,
      }),
    });
    for (const c of candidates) {
      assert.notEqual(c.autoExecute, true);
    }
  });
});
