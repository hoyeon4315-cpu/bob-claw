import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFormulaAudit } from "../src/research/formula-audit.mjs";

test("formula audit highlights implemented, partial, and missing formula families", () => {
  const report = buildFormulaAudit();

  assert.equal(report.summary.entryCount, 7);
  assert.equal(report.summary.implementedCount, 3);
  assert.equal(report.summary.partialCount, 3);
  assert.equal(report.summary.missingCount, 1);
  assert.equal(report.summary.topGap.id, "advanced_overfit_statistics");

  const profitFloor = report.entries.find((entry) => entry.id === "profit_floor_and_variance_gate");
  assert.ok(profitFloor);
  assert.equal(profitFloor.status, "partial");
  assert.equal(profitFloor.details.minNetProfitUsd, 0);
  assert.equal(profitFloor.details.minNetProfitPct, 0);

  assert.equal(
    report.mismatches.some((item) => item.id === "risk_policy_zero_profit_floor"),
    true,
  );
});
