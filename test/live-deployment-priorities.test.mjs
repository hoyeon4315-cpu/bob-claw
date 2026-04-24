import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveDeploymentPriorities } from "../src/strategy/live-deployment-priorities.mjs";

test("live deployment priorities rank active, refill, and no-trade surfaces", () => {
  const report = buildLiveDeploymentPriorities({
    strategyCatalog: {
      btcFamilies: [
        { id: "btc-gateway-loops", label: "BTC Gateway loops", status: "measured_below_policy", reason: "negative_net" },
      ],
      ethBranches: [
        { id: "eth-mixed", label: "ETH mixed loops", status: "thin_coverage" },
      ],
    },
    merklAllocationPlan: {
      status: "blocked",
      blockedReason: "no_portfolio_entry_ready",
      plan: {
        summary: {
          activePositionUsd: 225,
          activeChainUsd: { base: 75, ethereum: 150 },
          activeProtocolUsd: { yo: 75, morpho: 125, aave: 25 },
        },
        activePositions: [
          { opportunityId: "yo", chain: "base", protocolId: "yo", amountUsd: 75, entryTxHash: "0x1" },
        ],
        entryQueue: [],
        allocations: [
          {
            status: "blocked",
            queueItem: { opportunityId: "sei-usdc", chain: "sei", protocolId: "yei", name: "Lend USDC on Yei" },
            blockers: ["live_canary_proof_required_before_hold", "inventory_missing"],
            sizing: { blockers: ["matched_token_missing"] },
          },
        ],
        capitalJobs: [{ opportunityId: "sei-usdc", chain: "sei" }],
      },
    },
    refillJobs: {
      summary: { jobCount: 2, autoQueuedJobCount: 1 },
    },
    inventory: {
      summary: { estimatedWalletUsd: 100 },
      tokens: [{ chain: "base", estimatedUsd: 10, priceUsd: 50_000, status: "ready" }],
      native: [{ chain: "sei", estimatedUsd: 0, status: "missing" }],
    },
    observedAt: "2026-04-24T00:00:00.000Z",
  });

  assert.equal(report.summary.activeUsd, 225);
  assert.equal(report.summary.openPositionCount, 1);
  assert.equal(report.strategyDecisions[0].decision, "no_trade");
  assert.equal(report.strategyDecisions[1].decision, "measure_first");
  assert.equal(report.chainPriorities[0].chain, "base");
  assert.equal(report.chainPriorities[0].decision, "active");
  const sei = report.chainPriorities.find((item) => item.chain === "sei");
  assert.equal(sei.decision, "refill_required");
  assert.equal(report.merklDeployment.topBlocked[0].opportunityId, "sei-usdc");
});
