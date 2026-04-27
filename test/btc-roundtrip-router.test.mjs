import { describe, it } from "node:test";
import assert from "node:assert";
import { computeNetBtcApy, computeMultiHopNetApy, rankByNetBtcApy, findBestRoute } from "../src/strategy/btc-roundtrip-router.mjs";

describe("BTC round-trip router", () => {
  it("Base cbBTC-USDC has high net APY for 1 BTC", () => {
    const result = computeNetBtcApy({ chain: "Base", apy: 89.29, tvlUsd: 12_200_000 }, 1.0, 30);
    assert.ok(result.viable);
    assert.ok(result.netApy > 80);
    assert.ok(result.breakevenDays <= 1);
  });

  it("Ethereum morpho USDC is viable for 1 BTC", () => {
    const result = computeNetBtcApy({ chain: "Ethereum", apy: 20.77, tvlUsd: 8_190_000, isStable: true }, 1.0, 30);
    assert.ok(result.viable);
    assert.ok(result.netApy > 10);
  });

  it("small principal makes Ethereum unviable", () => {
    const result = computeNetBtcApy({ chain: "Ethereum", apy: 20.77, tvlUsd: 8_190_000, isStable: true }, 0.01, 30);
    assert.strictEqual(result.viable, false);
  });

  it("same-chain rotation triggers on >1% improvement", () => {
    const current = { chain: "Base", apy: 9.26, tvlUsd: 7_670_000 };
    const next = { chain: "Base", apy: 89.29, tvlUsd: 12_200_000 };
    const result = computeMultiHopNetApy({ currentPosition: current, newOpportunity: next, principalBtc: 1.0, holdDays: 30 });
    assert.strictEqual(result.shouldRotate, true);
    assert.strictEqual(result.isSameChain, true);
    assert.ok(result.improvement > 70);
  });

  it("cross-chain rotation blocked when bridge eats profit", () => {
    const current = { chain: "Base", apy: 89.29, tvlUsd: 12_200_000 };
    const next = { chain: "Ethereum", apy: 20.77, tvlUsd: 8_190_000, isStable: true };
    const result = computeMultiHopNetApy({ currentPosition: current, newOpportunity: next, principalBtc: 1.0, holdDays: 30 });
    assert.strictEqual(result.shouldRotate, false);
    assert.strictEqual(result.isSameChain, false);
  });

  it("ranks opportunities by net BTC APY", () => {
    const opps = [
      { chain: "Ethereum", apy: 20.77, tvlUsd: 8_190_000 },
      { chain: "Base", apy: 89.29, tvlUsd: 12_200_000 },
      { chain: "Base", apy: 9.26, tvlUsd: 7_670_000 },
    ];
    const ranked = rankByNetBtcApy(opps, 1.0, 30);
    assert.strictEqual(ranked[0].chain, "Base");
    assert.ok(ranked[0].netBtc.netApy > ranked[1].netBtc.netApy);
  });

  it("findBestRoute enters best on fresh capital", () => {
    const opps = [
      { chain: "Base", apy: 89.29, tvlUsd: 12_200_000 },
      { chain: "Ethereum", apy: 20.77, tvlUsd: 8_190_000 },
    ];
    const decision = findBestRoute(opps, null, 1.0, 30);
    assert.strictEqual(decision.action, "enter");
    assert.strictEqual(decision.target.chain, "Base");
  });

  it("findBestRoute holds when no better alternative", () => {
    const current = { chain: "Base", apy: 89.29, tvlUsd: 12_200_000 };
    const opps = [
      { chain: "Ethereum", apy: 20.77, tvlUsd: 8_190_000 },
    ];
    const decision = findBestRoute(opps, current, 1.0, 30);
    assert.strictEqual(decision.action, "hold");
  });
});
