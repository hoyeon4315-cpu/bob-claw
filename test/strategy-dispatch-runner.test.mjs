import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyDispatchSummary, executeStrategyDispatch } from "../src/session/strategy-dispatch-runner.mjs";

function strategyFixture(overrides = {}) {
  return {
    id: "gateway_wrapped_btc_loops",
    label: "Gateway wrapped-BTC loops",
    lane: "btc_family",
    status: "thin_coverage",
    capabilityBucket: "dry_run_or_shadow_only",
    selectedMode: "shadow",
    liveCapable: false,
    currentLiveEligible: false,
    fallbackReason: "deterministic_closed_loop_executor_missing",
    selectedCommands: [
      {
        command: "npm run score:gateway",
        script: "score:gateway",
      },
      {
        command: "npm run status:dashboard",
        script: "status:dashboard",
      },
    ],
    ...overrides,
  };
}

test("strategy dispatch previews selected commands without executing them", async () => {
  const record = await executeStrategyDispatch({
    strategies: [strategyFixture()],
    execute: false,
  });

  assert.equal(record.mode, "preview");
  assert.equal(record.batchStatus, "preview");
  assert.equal(record.strategyResults.length, 1);
  assert.equal(record.strategyResults[0].executionStatus, "preview");
  assert.equal(record.followUps.length, 3);
});

test("strategy dispatch executes selected commands and runs follow-ups", async () => {
  const calls = [];
  const record = await executeStrategyDispatch({
    strategies: [strategyFixture()],
    execute: true,
    readGuards: async () => ({ blocked: false, reasons: [] }),
    runCommand: async ({ step }) => {
      calls.push(step.script);
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 4,
        stdout: "ok",
        stderr: "",
      };
    },
  });

  assert.equal(record.batchStatus, "succeeded");
  assert.deepEqual(calls, [
    "score:gateway",
    "status:dashboard",
    "status:dashboard",
    "report:strategy-snapshot",
    "report:strategy-execution-surfaces",
  ]);
});

test("strategy dispatch blocks unsupported requested modes", async () => {
  const record = await executeStrategyDispatch({
    strategies: [strategyFixture()],
    execute: false,
    requestedMode: "live",
  });

  assert.equal(record.strategyResults[0].executionStatus, "blocked");
  assert.equal(record.strategyResults[0].blockedReason, "requested_mode_not_supported");
});

test("strategy dispatch summary aggregates execute and preview runs", () => {
  const summary = buildStrategyDispatchSummary([
    {
      observedAt: "2026-04-16T10:00:00.000Z",
      dispatchId: "d1",
      mode: "execute",
      batchStatus: "succeeded",
      selectedCount: 1,
      strategyResults: [{ executionStatus: "succeeded" }],
    },
    {
      observedAt: "2026-04-16T10:01:00.000Z",
      dispatchId: "d2",
      mode: "preview",
      batchStatus: "preview",
      selectedCount: 2,
      strategyResults: [{ executionStatus: "preview" }],
    },
  ]);

  assert.equal(summary.runCount, 1);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.previewCount, 1);
  assert.equal(summary.latestMode, "preview");
  assert.equal(summary.recentBatches[0].dispatchId, "d2");
});
