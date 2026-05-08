import assert from "node:assert/strict";
import test from "node:test";

import { buildIdleConsolidationDryRun } from "../src/cli/run-idle-consolidation.mjs";

const NOW = "2026-05-09T00:00:00.000Z";

test("idle consolidation dry-run queues insufficient-funds refill prerequisites without writing", () => {
  const report = buildIdleConsolidationDryRun({
    now: NOW,
    allChainReport: {
      observedAt: NOW,
      refillExecutions: [
        {
          jobId: "job-soneium-gas",
          chain: "soneium",
          asset: "ETH",
          targetAmountDecimal: 0.0007,
          previewStatus: "blocked",
          previewBlockedReason: "insufficient_funds",
          refillSource: "treasury",
        },
      ],
    },
    auditRecords: [],
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.status, "planned");
  assert.equal(report.write, false);
  assert.equal(report.jobs.length, 1);
  assert.equal(report.jobs[0].kind, "idle_inventory_consolidation");
  assert.equal(report.jobs[0].lifecycleStage, "idle_consolidation_planned");
  assert.equal(report.prerequisiteSummary.byBlocker.insufficient_funds, 1);
});
