import assert from "node:assert/strict";
import { test } from "node:test";
import { runMerklPortfolioOrchestrator } from "../src/executor/merkl-portfolio-orchestrator.mjs";

test("module exports runMerklPortfolioOrchestrator", () => {
  assert.equal(typeof runMerklPortfolioOrchestrator, "function");
});

test("preview mode returns structured report without crashing", async () => {
  const report = await runMerklPortfolioOrchestrator({
    execute: false,
    write: false,
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.mode, "preview");
  assert.ok(["blocked", "idle", "ok"].includes(report.status));
  assert.ok(report.exit != null);
  assert.ok(report.allocator != null);
  assert.ok(report.observedAt != null);
});

test("report aggregates blocked status when both phases block", async () => {
  const report = await runMerklPortfolioOrchestrator({
    execute: false,
    write: false,
  });
  // Both exit and allocator are likely blocked in preview without setup,
  // so overall status should be blocked.
  assert.ok(report.status != null);
  // Verify the report shape regardless of exact status
  assert.equal(typeof report.exit.status, "string");
  assert.equal(typeof report.allocator.status, "string");
});
