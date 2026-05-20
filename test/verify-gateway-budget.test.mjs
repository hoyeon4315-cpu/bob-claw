import test from "node:test";
import assert from "node:assert/strict";

import { shouldAbortForBudget, buildBudgetExceededDiagnostic } from "../src/cli/verify-gateway.mjs";

// Regression: when --btc-routes runs longer than the configured time budget,
// the CLI must emit a structured diagnostic_failure JSON instead of leaving
// callers with npm preamble or a hung process. Bundle consumers can then
// classify the run as BLOCKED_BY_DIAGNOSTIC_FAILURE per AGENTS.md.

test("shouldAbortForBudget returns false when no budget is configured", () => {
  assert.equal(shouldAbortForBudget({ elapsedMs: 10_000, budgetMs: null }), false);
  assert.equal(shouldAbortForBudget({ elapsedMs: 10_000, budgetMs: undefined }), false);
});

test("shouldAbortForBudget returns false for non-positive budgets (treat as disabled)", () => {
  assert.equal(shouldAbortForBudget({ elapsedMs: 10_000, budgetMs: 0 }), false);
  assert.equal(shouldAbortForBudget({ elapsedMs: 10_000, budgetMs: -1 }), false);
  assert.equal(shouldAbortForBudget({ elapsedMs: 10_000, budgetMs: Number.NaN }), false);
});

test("shouldAbortForBudget returns true only after elapsed reaches budget", () => {
  assert.equal(shouldAbortForBudget({ elapsedMs: 999, budgetMs: 1000 }), false);
  assert.equal(shouldAbortForBudget({ elapsedMs: 1000, budgetMs: 1000 }), true);
  assert.equal(shouldAbortForBudget({ elapsedMs: 5000, budgetMs: 1000 }), true);
});

test("buildBudgetExceededDiagnostic emits typed diagnostic payload with partial records", () => {
  const checkedRoutes = [
    { srcChain: "alpha", dstChain: "beta", srcToken: "0xa", dstToken: "0xb" },
    { srcChain: "alpha", dstChain: "gamma", srcToken: "0xa", dstToken: "0xc" },
    { srcChain: "delta", dstChain: "beta", srcToken: "0xd", dstToken: "0xb" },
  ];
  const records = [{ ok: true, metric: { route: checkedRoutes[0], amount: "100" } }];
  const diag = buildBudgetExceededDiagnostic({
    schemaVersion: 7,
    runId: "run-xyz",
    startedAt: "2026-05-20T00:00:00.000Z",
    elapsedMs: 60_500,
    budgetMs: 60_000,
    routeSummary: { totalRoutes: 9 },
    checkedRoutes,
    completedRouteCount: 1,
    records,
  });

  assert.equal(diag.status, "diagnostic_failure");
  assert.equal(diag.failureReason, "time_budget_exceeded_before_completion");
  assert.equal(diag.runId, "run-xyz");
  assert.equal(diag.startedAt, "2026-05-20T00:00:00.000Z");
  assert.equal(diag.elapsedMs, 60_500);
  assert.equal(diag.budgetMs, 60_000);
  assert.equal(diag.plannedRouteCount, 3);
  assert.equal(diag.completedRouteCount, 1);
  assert.equal(diag.schemaVersion, 7);
  assert.deepEqual(diag.routeSummary, { totalRoutes: 9 });
  assert.equal(diag.records.length, 1);
  assert.equal(diag.checkedRoutes.length, 3);
  assert.ok(diag.observedAt, "must carry observedAt timestamp");
});

test("buildBudgetExceededDiagnostic preserves zero completedRouteCount when budget hit before any route finished", () => {
  const diag = buildBudgetExceededDiagnostic({
    schemaVersion: 1,
    runId: "run-zero",
    startedAt: "2026-05-20T00:00:00.000Z",
    elapsedMs: 31_000,
    budgetMs: 30_000,
    routeSummary: { totalRoutes: 2 },
    checkedRoutes: [
      { srcChain: "s1", dstChain: "d1", srcToken: "0x1", dstToken: "0x2" },
      { srcChain: "s2", dstChain: "d2", srcToken: "0x3", dstToken: "0x4" },
    ],
    completedRouteCount: 0,
    records: [],
  });
  assert.equal(diag.completedRouteCount, 0);
  assert.equal(diag.records.length, 0);
  assert.equal(diag.plannedRouteCount, 2);
});
