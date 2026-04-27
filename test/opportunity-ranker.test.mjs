import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeOpportunityScore,
  rankOpportunities,
  selectTopN,
  computeScoreSum,
  DEFAULT_RANKER_WEIGHTS,
  DEFAULT_RANKER_PENALTIES,
} from "../src/strategy/opportunity-ranker.mjs";

test("computeOpportunityScore basic case", () => {
  const score = computeOpportunityScore({
    effectiveApr: 0.10,
    tvlUsd: 1_000_000,
    contractAgeDays: 365,
    hasAudit: true,
  });
  assert.ok(score > 0);
});

test("rankOpportunities orders by descending score", () => {
  const ranked = rankOpportunities([
    { aprPct: 5, tvlUsd: 1_000_000 },
    { aprPct: 15, tvlUsd: 1_000_000 },
    { aprPct: 10, tvlUsd: 1_000_000 },
  ]);
  assert.equal(ranked[0].aprPct, 15);
  assert.equal(ranked[1].aprPct, 10);
  assert.equal(ranked[2].aprPct, 5);
});

test("computeOpportunityScore applies low TVL penalty", () => {
  const high = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 2_000_000, contractAgeDays: 365 });
  const low = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 500_000, contractAgeDays: 365 });
  assert.ok(low < high);
});

test("computeOpportunityScore applies high volatility penalty", () => {
  const stable = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, vol30dPct: 20 });
  const volatile = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, vol30dPct: 90 });
  assert.ok(volatile < stable);
});

test("computeOpportunityScore applies unknown issuer penalty", () => {
  const known = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, hasAudit: true });
  const unknown = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, hasAudit: false });
  assert.ok(unknown < known);
});

test("computeOpportunityScore applies point reward penalty", () => {
  const normal = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000 });
  const points = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, hasPointRewards: true });
  assert.ok(points < normal);
});

test("computeOpportunityScore applies campaign ends soon penalty", () => {
  const long = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, campaignRemainingHours: 48 });
  const short = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, campaignRemainingHours: 12 });
  assert.ok(short < long);
});

test("computeOpportunityScore gives trusted issuer bonus", () => {
  const base = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, hasAudit: true });
  const trusted = computeOpportunityScore({ effectiveApr: 0.10, tvlUsd: 1_000_000, hasAudit: true, trustedIssuer: true });
  assert.ok(trusted > base);
});

test("computeOpportunityScore uses effectiveApr over aprPct", () => {
  const a = computeOpportunityScore({ effectiveApr: 0.05, aprPct: 10, tvlUsd: 1_000_000 });
  const b = computeOpportunityScore({ effectiveApr: 0.15, aprPct: 10, tvlUsd: 1_000_000 });
  assert.ok(b > a);
});

test("selectTopN slices correctly", () => {
  const ranked = [{ score: 10 }, { score: 8 }, { score: 6 }, { score: 4 }];
  const top2 = selectTopN(ranked, 2);
  assert.equal(top2.length, 2);
  assert.equal(top2[0].score, 10);
});

test("computeScoreSum aggregates scores", () => {
  const sum = computeScoreSum([{ score: 10 }, { score: 20 }, { score: 30 }]);
  assert.equal(sum, 60);
});

test("score equality for active vs candidate inputs", () => {
  const opportunity = {
    effectiveApr: 0.12,
    tvlUsd: 2_000_000,
    contractAgeDays: 180,
    hasAudit: true,
    trustedIssuer: true,
  };
  const asActive = computeOpportunityScore({ ...opportunity, isActive: true });
  const asCandidate = computeOpportunityScore({ ...opportunity, isActive: false });
  assert.equal(asActive, asCandidate);
});

test("score is zero for invalid input", () => {
  assert.equal(computeOpportunityScore({}), 0);
});

test("multiplier never goes negative", () => {
  const score = computeOpportunityScore({
    effectiveApr: 0.10,
    tvlUsd: 100,
    hasAudit: false,
    hasPointRewards: true,
    vol30dPct: 200,
    incentiveDominant: true,
    campaignRemainingHours: 1,
  });
  assert.equal(score, 0);
});
