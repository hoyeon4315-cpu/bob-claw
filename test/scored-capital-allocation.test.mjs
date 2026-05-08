import test from "node:test";
import assert from "node:assert/strict";
import { buildScoredAllocation } from "../src/strategy/scored-capital-allocation.mjs";

test("scored capital allocation uses ledger chain score instead of static Base bias", () => {
  const result = buildScoredAllocation({
    chainScoreLedger: {
      byChain: {
        base: {
          chainScore: 0.25,
          scoreSource: "ledger",
          widePosterior: false,
          blockers: [],
        },
        bsc: {
          chainScore: 0.85,
          scoreSource: "ledger",
          widePosterior: false,
          blockers: [],
        },
      },
    },
    venueMetadata: {
      "base-strategy": { riskScore: 0.5, chainScore: 0.9, family: "yield" },
      "bsc-strategy": { riskScore: 0.5, chainScore: 0.8, family: "yield" },
    },
    candidates: [
      {
        strategyId: "base-strategy",
        chain: "base",
        protocol: "moonwell",
        proposedAllocationSats: 50,
        expectedYieldSats: 10,
      },
      {
        strategyId: "bsc-strategy",
        chain: "BNB Chain",
        protocol: "venus",
        proposedAllocationSats: 50,
        expectedYieldSats: 10,
      },
    ],
    totalAvailableSats: 100,
    diversificationPolicy: null,
  });

  const base = result.allocations.find((item) => item.strategyId === "base-strategy");
  const bsc = result.allocations.find((item) => item.strategyId === "bsc-strategy");
  assert.equal(base.chain, "base");
  assert.equal(bsc.chain, "bsc");
  assert.equal(base.chainScore, 0.25);
  assert.equal(bsc.chainScore, 0.85);
  assert.equal(base.chainScoreSource, "ledger");
  assert.equal(bsc.chainScoreSource, "ledger");
  assert.ok(bsc.score > base.score);
});

test("scored capital allocation clamps wide-posterior explore candidates to micro caps", () => {
  const result = buildScoredAllocation({
    btcPriceUsd: 100_000,
    chainScoreLedger: {
      byChain: {
        bsc: {
          chainScore: 0.8,
          scoreSource: "prior",
          widePosterior: true,
          sampleCount: 0,
          alphaSampleCount: 0,
          blockers: ["chain_score_unobserved"],
        },
      },
    },
    venueMetadata: {
      "bsc-strategy": { riskScore: 0.9, chainScore: 0.8, family: "yield" },
    },
    candidates: [
      {
        strategyId: "bsc-strategy",
        chain: "BNB Chain",
        protocol: "venus",
        proposedAllocationSats: 1_000_000,
        expectedYieldSats: 100_000,
      },
    ],
    totalAvailableSats: 1_000_000,
    diversificationPolicy: null,
  });

  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].allocationBucket, "explore");
  assert.equal(result.allocations[0].allocatedSats, 10_000);
  assert.equal(result.allocations[0].exploreCapSats, 10_000);
  assert.equal(result.summary.exploreAllocationSats, 10_000);
});
