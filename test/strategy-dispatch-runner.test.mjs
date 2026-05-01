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
    liveCapable: true,
    currentLiveEligible: false,
    fallbackReason: "route_specific_executor_inputs_required",
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
    "status:dashboard:light",
    "report:strategy-snapshot",
    "report:strategy-execution-surfaces",
  ]);
});

test("strategy dispatch propagates orchestration correlation into command env and record metadata", async () => {
  const envSnapshots = [];
  const record = await executeStrategyDispatch({
    strategies: [strategyFixture()],
    execute: true,
    orchestration: {
      source: "all_chain_autopilot",
      runId: "autopilot-123",
    },
    readGuards: async () => ({ blocked: false, reasons: [] }),
    runCommand: async ({ env }) => {
      envSnapshots.push({
        dispatchId: env.BOB_DISPATCH_ID,
        source: env.BOB_ORCHESTRATION_SOURCE,
        runId: env.BOB_ORCHESTRATION_RUN_ID,
        strategyId: env.BOB_STRATEGY_ID || null,
        phase: env.BOB_DISPATCH_PHASE,
      });
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

  assert.equal(record.orchestration.source, "all_chain_autopilot");
  assert.equal(record.orchestration.runId, "autopilot-123");
  assert.ok(record.dispatchId);
  assert.equal(record.strategyResults[0].dispatchId, record.dispatchId);
  assert.equal(record.strategyResults[0].orchestration.source, "all_chain_autopilot");
  assert.equal(envSnapshots[0].dispatchId, record.dispatchId);
  assert.equal(envSnapshots[0].source, "all_chain_autopilot");
  assert.equal(envSnapshots[0].runId, "autopilot-123");
  assert.equal(envSnapshots[0].strategyId, "gateway_wrapped_btc_loops");
  assert.equal(envSnapshots.at(-1).phase, "follow_up");
});

test("strategy dispatch uses light dashboard status inside all-chain autopilot execution", async () => {
  const calls = [];
  const record = await executeStrategyDispatch({
    strategies: [strategyFixture()],
    execute: true,
    orchestration: {
      source: "all_chain_autopilot",
      runId: "autopilot-light-status",
    },
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
    "status:dashboard:light",
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

test("strategy dispatch allows stable loop analysis scripts", async () => {
  const record = await executeStrategyDispatch({
    strategies: [
      strategyFixture({
        id: "stablecoin_entry_exit_loops",
        selectedMode: "analysis",
        selectedCommands: [
          {
            command: "npm run report:stable-loop-executor -- --write",
            script: "report:stable-loop-executor",
          },
          {
            command: "npm run report:lane-reclassification -- --write",
            script: "report:lane-reclassification",
          },
          {
            command: "npm run report:secondary-strategy-scaffolds -- --write",
            script: "report:secondary-strategy-scaffolds",
          },
        ],
      }),
    ],
    execute: false,
  });

  assert.equal(record.strategyResults[0].executionStatus, "preview");
  assert.deepEqual(record.strategyResults[0].scripts, [
    "report:stable-loop-executor",
    "report:lane-reclassification",
    "report:secondary-strategy-scaffolds",
  ]);
});

test("strategy dispatch exposes live admission blockers for live requests", async () => {
  const record = await executeStrategyDispatch({
    strategies: [strategyFixture({
      liveAdmissionBlockers: ["route_specific_executor_inputs_required"],
    })],
    execute: false,
    requestedMode: "live",
  });

  assert.equal(record.strategyResults[0].executionStatus, "blocked");
  assert.equal(record.strategyResults[0].blockedReason, "route_specific_executor_inputs_required");
  assert.deepEqual(record.strategyResults[0].liveAdmissionBlockers, ["route_specific_executor_inputs_required"]);
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
