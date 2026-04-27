import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateMerklOpportunity } from "../src/strategy/merkl-opportunity-prefilter.mjs";

function buildOpportunity(overrides = {}) {
  return {
    source: "merkl",
    observedAt: "2026-04-27T07:00:00.000Z",
    opportunityId: "opp-base",
    chain: "base",
    status: "LIVE",
    liveCampaigns: 2,
    family: "wrapped_btc_lending",
    rewardTokenTypes: [],
    hasPointRewards: false,
    hasBtcExposure: true,
    hasSupportedAssetExposure: true,
    btcPaybackCompatible: true,
    mappedStrategyId: "wrapped-btc-loop-base-moonwell",
    executionSurface: "lending",
    managedVault: false,
    requiresRangeManagement: false,
    operatorHold: false,
    tvlUsd: 2_000_000,
    aprPct: 12,
    nativeAprPct: 2,
    incentiveAprPct: 2,
    campaignRemainingHours: 120,
    ...overrides,
  };
}

test("higher APR candidate scores above otherwise equal lower APR candidate", () => {
  const lowApr = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "apr-3",
    aprPct: 3,
    nativeAprPct: 1,
    incentiveAprPct: 1,
  }));
  const highApr = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "apr-12",
    aprPct: 12,
    nativeAprPct: 2,
    incentiveAprPct: 2,
  }));

  assert.equal(lowApr.decision, "candidate");
  assert.equal(highApr.decision, "candidate");
  assert.ok(highApr.score > lowApr.score);
});

test("low TVL high APR candidate still loses net score despite APR band boost", () => {
  const safeTvl = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "high-apr-safe-tvl",
    aprPct: 25,
    tvlUsd: 2_000_000,
    nativeAprPct: 8,
    incentiveAprPct: 6,
  }));
  const lowTvl = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "high-apr-low-tvl",
    aprPct: 25,
    tvlUsd: 500_000,
    nativeAprPct: 8,
    incentiveAprPct: 6,
  }));

  assert.ok(lowTvl.overfitFlags.includes("low_tvl_high_apr"));
  assert.ok(lowTvl.hardBlockers.includes("tvl_below_family_floor"));
  assert.ok(lowTvl.score < safeTvl.score);
});

test("missing APR stays in the low band and adds no extra score", () => {
  const missingApr = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "apr-missing",
    aprPct: null,
    nativeAprPct: null,
    incentiveAprPct: null,
  }));
  const lowBandApr = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "apr-low-band",
    aprPct: 2.9,
    nativeAprPct: null,
    incentiveAprPct: null,
  }));

  assert.equal(missingApr.score, lowBandApr.score);
});

test("incentive dominant penalty still applies even with APR scoring enabled", () => {
  const balancedRewards = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "balanced-rewards",
    aprPct: 12,
    nativeAprPct: 8,
    incentiveAprPct: 4,
  }));
  const incentiveDominant = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "incentive-dominant",
    aprPct: 12,
    nativeAprPct: 2,
    incentiveAprPct: 10,
  }));

  assert.ok(incentiveDominant.overfitFlags.includes("incentive_dominant"));
  assert.ok(incentiveDominant.score < balancedRewards.score);
});

test("POINT hard reject candidate remains clamped at zero score", () => {
  const pointReward = evaluateMerklOpportunity(buildOpportunity({
    opportunityId: "point-reward",
    family: "non_core_asset",
    rewardTokenTypes: ["POINT"],
    hasPointRewards: true,
    hasBtcExposure: false,
    hasSupportedAssetExposure: false,
    btcPaybackCompatible: false,
    mappedStrategyId: null,
    executionSurface: "managedVault",
    tvlUsd: 100_000,
    aprPct: 50,
    nativeAprPct: null,
    incentiveAprPct: 40,
    campaignRemainingHours: 12,
    liveCampaigns: 1,
  }));

  assert.ok(pointReward.hardBlockers.includes("point_reward_program"));
  assert.equal(pointReward.score, 0);
});
