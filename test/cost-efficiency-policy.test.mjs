import { describe, it } from "node:test";
import assert from "node:assert";
import { computeOpportunityScore, DEFAULT_RANKER_WEIGHTS } from "../src/strategy/opportunity-ranker.mjs";
import { evaluateOpportunityPolicy } from "../src/executor/policy/opportunity-policy.mjs";

describe("cost-efficiency and yield maximization", () => {
  it("same-chain opportunity gets score bonus", () => {
    const same = computeOpportunityScore({ aprPct: 10, tvlUsd: 10_000_000, srcChain: "base", dstChain: "base", hasAudit: true, trustedIssuer: true });
    const cross = computeOpportunityScore({ aprPct: 10, tvlUsd: 10_000_000, srcChain: "base", dstChain: "ethereum", hasAudit: true, trustedIssuer: true, bridgeCostBps: 25 });
    assert.ok(same > cross, `same-chain (${same}) should score higher than cross-chain (${cross})`);
  });

  it("cross-chain opportunity penalizes bridge cost from APR", () => {
    const crossHighBridge = computeOpportunityScore({ aprPct: 5, tvlUsd: 10_000_000, srcChain: "base", dstChain: "ethereum", bridgeCostBps: 600, hasAudit: true });
    const crossLowBridge = computeOpportunityScore({ aprPct: 5, tvlUsd: 10_000_000, srcChain: "base", dstChain: "ethereum", bridgeCostBps: 25, hasAudit: true });
    assert.ok(crossLowBridge > crossHighBridge, `low bridge (${crossLowBridge}) > high bridge (${crossHighBridge})`);
  });

  it("blocks cross-chain intent when position too small for bridge cost", async () => {
    const result = await evaluateOpportunityPolicy({
      intent: {
        strategyId: "test",
        srcChain: "base",
        dstChain: "ethereum",
        chain: "ethereum",
        amountUsd: 100,
        apr: 5,
        expectedHoldDays: 14,
        estimatedBridgeCostUsd: 0.33,
        roundTripSuccessRate: 0.95,
        observedAt: new Date().toISOString(),
      },
      currentAllocations: {},
      capitalState: { totalDeployableCapital: 10000 },
    });
    assert.strictEqual(result.decision, "BLOCK");
    assert.ok(result.blockers.some((b) => b.includes("cross_chain_unprofitable")));
  });

  it("allows same-chain intent above min profitable threshold", async () => {
    const result = await evaluateOpportunityPolicy({
      intent: {
        strategyId: "test",
        srcChain: "base",
        dstChain: "base",
        chain: "base",
        amountUsd: 1000,
        apr: 4,
        expectedHoldDays: 14,
        estimatedGasCostUsd: 0.12,
        roundTripSuccessRate: 0.95,
        observedAt: new Date().toISOString(),
      },
      currentAllocations: {},
      capitalState: { totalDeployableCapital: 10000 },
    });
    assert.strictEqual(result.decision, "ALLOW");
  });

  it("blocks same-chain intent when gas eats >50% of profit", async () => {
    const result = await evaluateOpportunityPolicy({
      intent: {
        strategyId: "test",
        srcChain: "base",
        dstChain: "base",
        chain: "base",
        amountUsd: 50,
        apr: 4,
        expectedHoldDays: 14,
        estimatedGasCostUsd: 0.12,
        roundTripSuccessRate: 0.95,
        observedAt: new Date().toISOString(),
      },
      currentAllocations: {},
      capitalState: { totalDeployableCapital: 10000 },
    });
    assert.strictEqual(result.decision, "BLOCK");
    assert.ok(result.blockers.some((b) => b.includes("same_chain_unprofitable")));
  });
});
