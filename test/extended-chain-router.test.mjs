import { describe, it } from "node:test";
import assert from "node:assert";
import { computeExtendedNetBtcApy } from "../src/strategy/extended-chain-router.mjs";

describe("extended chain router", () => {
  it("Gateway chain uses direct route", () => {
    const result = computeExtendedNetBtcApy({ chain: "Base", apy: 50, tvlUsd: 10_000_000 }, 1.0, 30);
    assert.strictEqual(result.routeType, "gateway_direct");
    assert.strictEqual(result.isGateway, true);
    assert.strictEqual(result.bridgeToChainCostBtc, 0);
    assert.ok(result.viable);
  });

  it("Arbitrum (EVM L2) is viable with manual bridge", () => {
    const result = computeExtendedNetBtcApy({ chain: "Arbitrum", apy: 68.99, tvlUsd: 850_000 }, 1.0, 30);
    assert.strictEqual(result.routeType, "post_gateway_manual_bridge");
    assert.strictEqual(result.isGateway, false);
    assert.ok(result.totalBridgeCostBtc > 0);
    assert.ok(result.viable);
    assert.ok(result.netApy > 60); // 68.99% - bridge cost
  });

  it("Solana (non-EVM) has high bridge cost", () => {
    const result = computeExtendedNetBtcApy({ chain: "Solana", apy: 26.35, tvlUsd: 4_960_000 }, 1.0, 30);
    assert.strictEqual(result.routeType, "post_gateway_manual_bridge");
    assert.strictEqual(result.bridgeType, "non_evm");
    assert.ok(result.totalBridgeCostBtc > 0.005); // >$475 bridge
    assert.ok(result.netApy < 15); // bridge eats a lot
  });

  it("unsupported chain returns error", () => {
    const result = computeExtendedNetBtcApy({ chain: "SomeRandomChain", apy: 100, tvlUsd: 1_000_000 }, 1.0, 30);
    assert.strictEqual(result.routeType, "unsupported_chain");
    assert.strictEqual(result.viable, false);
  });

  it("small principal makes non-Gateway unviable", () => {
    // 0.001 BTC (~$95) into low yield non-Gateway: bridge cost dominates
    const result = computeExtendedNetBtcApy({ chain: "Arbitrum", apy: 5, tvlUsd: 850_000 }, 0.001, 30);
    // Bridge cost ~$1 is > 1% of $95 principal, makes it unviable
    assert.strictEqual(result.viable, false);
  });
});
