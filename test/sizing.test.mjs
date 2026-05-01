import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SIZING_POLICY,
  sizingPolicy,
  computeMinProfitablePositionUsd,
  computeTinyCanaryMinProfitablePositionUsd,
  computePositionUsd,
  resolveTinyCanaryExpectedHoldDays,
} from "../src/config/sizing.mjs";

test("default sizing policy values", () => {
  assert.equal(SIZING_POLICY.minPositionUsd, 25);
  assert.equal(SIZING_POLICY.maxSinglePositionPct, 0.25);
  assert.equal(SIZING_POLICY.tierLeverageMultiplier.TIER_A, 1.5);
  assert.equal(SIZING_POLICY.tierLeverageMultiplier.TIER_B, 1.0);
  assert.equal(SIZING_POLICY.tierLeverageMultiplier.TIER_C, 0.5);
});

test("sizingPolicy override preserves defaults", () => {
  const custom = sizingPolicy({ minPositionUsd: 50 });
  assert.equal(custom.minPositionUsd, 50);
  assert.equal(custom.maxSinglePositionPct, 0.25);
  assert.equal(custom.tierLeverageMultiplier.TIER_A, 1.5);
});

test("computeMinProfitablePositionUsd basic case", () => {
  const result = computeMinProfitablePositionUsd({
    roundTripCostUsd: 10,
    postedAprDecimal: 0.10,
    expectedHoldYearFraction: 0.25,
    safetyFactor: 0.5,
  });
  assert.equal(result, 10 / (0.10 * 0.25 * 0.5));
});

test("computeMinProfitablePositionUsd returns null on invalid input", () => {
  assert.equal(
    computeMinProfitablePositionUsd({
      roundTripCostUsd: -5,
      postedAprDecimal: 0.1,
      expectedHoldYearFraction: 0.25,
    }),
    null
  );
  assert.equal(
    computeMinProfitablePositionUsd({
      roundTripCostUsd: 10,
      postedAprDecimal: 0,
      expectedHoldYearFraction: 0.25,
    }),
    null
  );
  assert.equal(
    computeMinProfitablePositionUsd({
      roundTripCostUsd: 10,
      postedAprDecimal: 0.1,
      expectedHoldYearFraction: -1,
    }),
    null
  );
  assert.equal(
    computeMinProfitablePositionUsd({}),
    null
  );
});

test("resolveTinyCanaryExpectedHoldDays uses campaign remaining hours before fallback", () => {
  assert.equal(
    resolveTinyCanaryExpectedHoldDays({ campaignRemainingHours: 24 * 33 }),
    33
  );
  assert.equal(
    resolveTinyCanaryExpectedHoldDays({
      campaignEndsAt: "2026-05-04T00:00:00.000Z",
      now: "2026-05-01T00:00:00.000Z",
    }),
    3
  );
  assert.equal(resolveTinyCanaryExpectedHoldDays({}), 7);
});

test("computeTinyCanaryMinProfitablePositionUsd uses chain-aware tiny canary cost", () => {
  const base = computeTinyCanaryMinProfitablePositionUsd({
    chain: "base",
    aprPct: 19.8,
    expectedHoldDays: 33,
  });
  const ethereum = computeTinyCanaryMinProfitablePositionUsd({
    chain: "ethereum",
    aprPct: 19.8,
    expectedHoldDays: 33,
  });

  assert.ok(base < 1.4);
  assert.ok(ethereum > 40);
});

test("computePositionUsd basic allocation", () => {
  const result = computePositionUsd({
    totalDeployableCapital: 1000,
    opportunityScore: 50,
    sumOfTopNScores: 100,
    tier: "TIER_B",
  });
  assert.equal(result, 250);
});

test("computePositionUsd applies tier multiplier", () => {
  const customSizing = sizingPolicy({ maxSinglePositionPct: 1.0 });
  const tierA = computePositionUsd({
    totalDeployableCapital: 1000,
    opportunityScore: 50,
    sumOfTopNScores: 100,
    tier: "TIER_A",
    sizing: customSizing,
  });
  const tierB = computePositionUsd({
    totalDeployableCapital: 1000,
    opportunityScore: 50,
    sumOfTopNScores: 100,
    tier: "TIER_B",
    sizing: customSizing,
  });
  assert.equal(tierA, 750);
  assert.equal(tierB, 500);
});

test("computePositionUsd applies concentration penalties", () => {
  const noPenalty = computePositionUsd({
    totalDeployableCapital: 1000,
    opportunityScore: 50,
    sumOfTopNScores: 100,
    tier: "TIER_B",
  });
  const withPenalty = computePositionUsd({
    totalDeployableCapital: 1000,
    opportunityScore: 50,
    sumOfTopNScores: 100,
    tier: "TIER_B",
    chainConcentrationPenalty: 0.5,
    protocolConcentrationPenalty: 0.5,
  });
  assert.equal(noPenalty, 250);
  assert.equal(withPenalty, 125);
});

test("computePositionUsd respects minPositionUsd floor", () => {
  const result = computePositionUsd({
    totalDeployableCapital: 100,
    opportunityScore: 1,
    sumOfTopNScores: 100,
    tier: "TIER_C",
  });
  assert.equal(result, 25);
});

test("computePositionUsd respects maxSinglePositionPct ceiling", () => {
  const result = computePositionUsd({
    totalDeployableCapital: 1000,
    opportunityScore: 100,
    sumOfTopNScores: 100,
    tier: "TIER_A",
  });
  assert.equal(result, 250);
});

test("computePositionUsd returns 0 on invalid capital", () => {
  assert.equal(
    computePositionUsd({ totalDeployableCapital: -100, opportunityScore: 50, sumOfTopNScores: 100, tier: "TIER_B" }),
    0
  );
  assert.equal(
    computePositionUsd({ totalDeployableCapital: 0, opportunityScore: 50, sumOfTopNScores: 100, tier: "TIER_B" }),
    0
  );
});

test("computePositionUsd defaults unknown tier to TIER_C", () => {
  const result = computePositionUsd({
    totalDeployableCapital: 1000,
    opportunityScore: 50,
    sumOfTopNScores: 100,
    tier: "UNKNOWN",
  });
  assert.equal(result, 250);
});
