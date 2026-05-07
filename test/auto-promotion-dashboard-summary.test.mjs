import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAutoPromotionDashboardSummary } from "../src/status/dashboard-status.mjs";

test("auto-promotion dashboard summary is empty and frozen without a report", () => {
  const summary = buildAutoPromotionDashboardSummary(null);
  assert.equal(summary.available, false);
  assert.equal(summary.advisoryOnly, true);
  assert.equal(summary.eligibleCount, 0);
  assert.equal(summary.blockedCount, 0);
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(summary.eligible));
  assert.ok(Object.isFrozen(summary.blocked));
});

test("auto-promotion dashboard summary hides evidence bodies and suggested diffs", () => {
  const summary = buildAutoPromotionDashboardSummary({
    generatedAt: "2026-05-03T00:00:00.000Z",
    source: "auto_promotion_evidence",
    advisoryOnly: true,
    summary: {
      eligibleCount: 1,
      blockedCount: 1,
      evidenceProvidedCount: 2,
    },
    reports: [
      {
        strategyId: "passed",
        passed: true,
        evidenceProvided: true,
        evaluated: { secretLookingField: "do-not-render" },
        suggestedDiff: { file: "src/config/strategy-caps.mjs" },
      },
      {
        strategyId: "blocked",
        passed: false,
        evidenceProvided: true,
        blockers: ["oos_holdout_missing"],
      },
    ],
  });
  assert.equal(summary.available, true);
  assert.equal(summary.generatedAt, "2026-05-03T00:00:00.000Z");
  assert.equal(summary.eligibleCount, 1);
  assert.equal(summary.blockedCount, 1);
  assert.equal(summary.evidenceProvidedCount, 2);
  assert.deepEqual(summary.eligible, [{ strategyId: "passed" }]);
  assert.deepEqual(summary.blocked, [
    { strategyId: "blocked", firstBlocker: "oos_holdout_missing", evidenceProvided: true },
  ]);
  const json = JSON.stringify(summary);
  assert.equal(json.includes("suggestedDiff"), false);
  assert.equal(json.includes("secretLookingField"), false);
  assert.equal(json.includes("strategy-caps.mjs"), false);
});
