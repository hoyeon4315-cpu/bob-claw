import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPreliveSimulationLoopPlan, runPreliveSimulationLoop } from "../src/prelive/simulation-loop.mjs";

test("simulation loop preview derives a bounded run plan from remaining successes", () => {
  const preview = buildPreliveSimulationLoopPlan({
    simulationRuns: [
      { observedAt: "2026-04-17T10:00:00.000Z", status: "simulated_ok" },
      { observedAt: "2026-04-17T10:05:00.000Z", status: "simulation_failed" },
    ],
    targetSuccessCount: 5,
    limit: 2,
  });

  assert.equal(preview.currentSummary.successCount, 1);
  assert.equal(preview.currentSummary.failureCount, 1);
  assert.equal(preview.currentSummary.successRemaining, 4);
  assert.equal(preview.settings.maxRuns, 3);
  assert.equal(preview.nextAction, "collect_remaining_successes_but_keep_failure_blocker_visible");
});

test("simulation loop keeps collecting successes even when historical failures already exist", async () => {
  const runs = [
    { observedAt: "2026-04-17T10:00:00.000Z", status: "simulated_ok" },
    { observedAt: "2026-04-17T10:01:00.000Z", status: "simulation_failed" },
  ];
  const record = await runPreliveSimulationLoop({
    loadRuns: async () => runs,
    runBatch: async ({ attempt }) => {
      runs.push({
        observedAt: `2026-04-17T10:0${attempt + 1}:00.000Z`,
        status: "simulated_ok",
      });
      return {
        ok: true,
        results: [{ status: "simulated_ok" }],
        summary: { successCount: runs.filter((item) => item.status === "simulated_ok").length },
      };
    },
    targetSuccessCount: 3,
    limit: 1,
  });

  assert.equal(record.executionStatus, "succeeded");
  assert.equal(record.stopReason, "target_success_count_reached");
  assert.equal(record.initialSummary.failureCount, 1);
  assert.equal(record.finalSummary.successCount, 3);
  assert.equal(record.finalSummary.failureCount, 1);
  assert.equal(record.iterations.length, 2);
});

test("simulation loop stops when a new failure is recorded", async () => {
  const runs = [{ observedAt: "2026-04-17T10:00:00.000Z", status: "simulated_ok" }];
  const record = await runPreliveSimulationLoop({
    loadRuns: async () => runs,
    runBatch: async () => {
      runs.push({
        observedAt: "2026-04-17T10:01:00.000Z",
        status: "simulation_failed",
      });
      return {
        ok: true,
        results: [{ status: "simulation_failed" }],
        summary: null,
      };
    },
    targetSuccessCount: 3,
    limit: 1,
  });

  assert.equal(record.executionStatus, "blocked");
  assert.equal(record.stopReason, "simulation_failure_recorded");
  assert.equal(record.iterations[0].failureDelta, 1);
});
