import { test } from "node:test";
import assert from "node:assert";
import { evaluateNonPrimaryEntryPolicy } from "../src/strategy/non-primary-entry-policy.mjs";

test("allows optimism $5.16 micro canary when ledger p90 EV clears dynamic edge", () => {
  const result = evaluateNonPrimaryEntryPolicy({
    candidate: {
      chain: "optimism",
      notionalUsd: 5.162739,
      expectedNetEvUsd: 0.51,
      observedSampleCount: 5,
    },
    costLedger: {
      p90BridgeCostUsdForRoute: () => 0,
      p90GasCostUsdForChain: () => 0.003,
      p90ClaimCostUsdForProtocol: () => 0,
      p90RewardSwapCostUsdForToken: () => 0,
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.requiredEdgeUsd, 0.5045);
  assert.equal(result.uncertaintyPenaltyUsd, 0.0015);
  assert.equal(result.edgeFloorUsd, 0.5);
});

test("blocks non-primary entry when EV is below p90 cost plus sample uncertainty", () => {
  const result = evaluateNonPrimaryEntryPolicy({
    candidate: {
      chain: "bsc",
      notionalUsd: 40,
      expectedNetEvUsd: 0.52,
      observedSampleCount: 25,
    },
    costLedger: {
      p90BridgeCostUsdForRoute: () => 0,
      p90GasCostUsdForChain: () => 0.03,
      p90ClaimCostUsdForProtocol: () => 0,
      p90RewardSwapCostUsdForToken: () => 0,
    },
  });

  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockers, ["non_primary_ev_below_required_edge"]);
  assert.equal(result.requiredEdgeUsd, 0.5375);
});

test("non-primary entry policy canonicalizes chain aliases before cost lookup", () => {
  const result = evaluateNonPrimaryEntryPolicy({
    candidate: {
      chain: "BNB Chain",
      notionalUsd: 10,
      expectedNetEvUsd: 0.54,
      observedSampleCount: 30,
    },
    costLedger: {
      p90BridgeCostUsdForRoute: () => 0,
      p90GasCostUsdForChain: (chain) => (chain === "bsc" ? 0.01 : 1),
      p90ClaimCostUsdForProtocol: () => 0,
      p90RewardSwapCostUsdForToken: () => 0,
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.chain, "bsc");
  assert.equal(result.p90RoundTripCostUsd, 0.03);
  assert.equal(result.requiredEdgeUsd, 0.533);
});

test("charges claim and reward swap p90 only when an explicit reward token is present", () => {
  const base = {
    chain: "base",
    notionalUsd: 10,
    expectedNetEvUsd: 0.55,
    observedSampleCount: 30,
  };
  const costLedger = {
    p90BridgeCostUsdForRoute: () => 0,
    p90GasCostUsdForChain: () => 0.01,
    p90ClaimCostUsdForProtocol: () => 0.2,
    p90RewardSwapCostUsdForToken: () => 0.3,
  };

  const withoutReward = evaluateNonPrimaryEntryPolicy({
    candidate: base,
    costLedger,
  });
  const withReward = evaluateNonPrimaryEntryPolicy({
    candidate: { ...base, rewardToken: "AERO" },
    costLedger,
  });

  assert.equal(withoutReward.allowed, true);
  assert.equal(withoutReward.rewardExitCostUsd, 0);
  assert.equal(withoutReward.p90RoundTripCostUsd, 0.012);
  assert.equal(withReward.allowed, false);
  assert.equal(withReward.rewardExitCostUsd, 0.5);
  assert.equal(withReward.p90RoundTripCostUsd, 0.512);
});
