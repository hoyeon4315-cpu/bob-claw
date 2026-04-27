import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAntiLockinGuard } from "../src/strategy/anti-lockin-guard.mjs";
import { planRotations, planMultiStepRotations } from "../src/strategy/auto-rotation.mjs";

test("evaluateAntiLockinGuard recomputes score equal to reference", () => {
  const result = evaluateAntiLockinGuard({
    opportunityId: "opp1",
    effectiveApr: 0.10,
    tvlUsd: 1_000_000,
    contractAgeDays: 180,
    hasAudit: true,
  });
  assert.ok(Number.isFinite(result.recomputedScore));
  assert.equal(result.scoreEqualityHolds, true);
});

test("evaluateAntiLockinGuard flags mustReevaluate on 30% score drop", () => {
  const result = evaluateAntiLockinGuard(
    { opportunityId: "opp1", effectiveApr: 0.10, tvlUsd: 1_000_000 },
    {
      scoreHistory: [
        { at: Date.now() - 25 * 24 * 60 * 60 * 1000, score: 100 },
        { at: Date.now() - 15 * 24 * 60 * 60 * 1000, score: 80 },
        { at: Date.now() - 1 * 24 * 60 * 60 * 1000, score: 60 },
      ],
    }
  );
  assert.ok(result.flags.includes("mustReevaluate"));
});

test("evaluateAntiLockinGuard flags campaign ending within 24h", () => {
  const result = evaluateAntiLockinGuard({
    opportunityId: "opp1",
    effectiveApr: 0.10,
    tvlUsd: 1_000_000,
    campaignRemainingHours: 12,
  });
  assert.ok(result.flags.includes("campaign_ends_within_24h"));
});

test("evaluateAntiLockinGuard flags position age advisory", () => {
  const result = evaluateAntiLockinGuard({
    opportunityId: "opp1",
    effectiveApr: 0.10,
    tvlUsd: 1_000_000,
    entryAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.ok(result.flags.includes("position_age_advisory_90d"));
});

test("planRotations migrates when candidate exceeds threshold", () => {
  const migrations = planRotations({
    activePositions: [{ opportunityId: "a", score: 100, sharePct: 0.1, chain: "base", protocol: "morpho" }],
    rankedCandidates: [{ opportunityId: "b", score: 140, migrationCostUsd: 10, expected30dUpliftUsd: 100, sharePct: 0.1, chain: "base", protocol: "aave" }],
    capitalState: {},
  });
  assert.equal(migrations.length, 1);
  assert.equal(migrations[0].enter.opportunityId, "b");
});

test("planRotations blocks migration below threshold", () => {
  const migrations = planRotations({
    activePositions: [{ opportunityId: "a", score: 100, sharePct: 0.1, chain: "base", protocol: "morpho" }],
    rankedCandidates: [{ opportunityId: "b", score: 120, migrationCostUsd: 10, expected30dUpliftUsd: 100, sharePct: 0.1, chain: "base", protocol: "aave" }],
    capitalState: {},
  });
  assert.equal(migrations.length, 0);
});

test("planRotations blocks migration when cost exceeds uplift fraction", () => {
  const migrations = planRotations({
    activePositions: [{ opportunityId: "a", score: 100, sharePct: 0.1, chain: "base", protocol: "morpho" }],
    rankedCandidates: [{ opportunityId: "b", score: 140, migrationCostUsd: 60, expected30dUpliftUsd: 100, sharePct: 0.1, chain: "base", protocol: "aave" }],
    capitalState: {},
  });
  assert.equal(migrations.length, 0);
});

test("planRotations blocks migration into concentration cap", () => {
  const migrations = planRotations({
    activePositions: [{ opportunityId: "a", score: 100, sharePct: 0.1, chain: "base", protocol: "morpho" }],
    rankedCandidates: [{ opportunityId: "b", score: 140, migrationCostUsd: 10, expected30dUpliftUsd: 100, sharePct: 0.5, chain: "base", protocol: "aave" }],
    capitalState: {
      chainSharePct: { base: 0.45 },
      protocolSharePct: { aave: 0.30 },
    },
  });
  assert.equal(migrations.length, 0);
});

test("planRotations excludes same opportunityId", () => {
  const migrations = planRotations({
    activePositions: [{ opportunityId: "a", score: 100, sharePct: 0.1, chain: "base", protocol: "morpho" }],
    rankedCandidates: [{ opportunityId: "a", score: 140, migrationCostUsd: 10, expected30dUpliftUsd: 100, sharePct: 0.1, chain: "base", protocol: "morpho" }],
    capitalState: {},
  });
  assert.equal(migrations.length, 0);
});

test("planMultiStepRotations handles sequential migrations", () => {
  const migrations = planMultiStepRotations({
    activePositions: [
      { opportunityId: "a", score: 100, sharePct: 0.1, chain: "base", protocol: "morpho" },
      { opportunityId: "c", score: 90, sharePct: 0.1, chain: "ethereum", protocol: "aave" },
    ],
    rankedCandidates: [
      { opportunityId: "b", score: 140, migrationCostUsd: 10, expected30dUpliftUsd: 100, sharePct: 0.1, chain: "base", protocol: "aave" },
      { opportunityId: "d", score: 130, migrationCostUsd: 10, expected30dUpliftUsd: 100, sharePct: 0.1, chain: "ethereum", protocol: "morpho" },
    ],
    capitalState: {},
    maxRounds: 3,
  });
  assert.equal(migrations.length, 2);
});

test("planRotations returns empty when no candidates", () => {
  const migrations = planRotations({
    activePositions: [{ opportunityId: "a", score: 100, sharePct: 0.1 }],
    rankedCandidates: [],
    capitalState: {},
  });
  assert.equal(migrations.length, 0);
});
