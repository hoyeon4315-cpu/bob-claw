import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("strategy catalog dispatcher is import-safe and exposes its lightweight input loader", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import('./src/cli/run-strategy-catalog-dispatcher.mjs'); console.log(typeof m.loadStrategyCatalogDispatchInputs);",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stdout.trim(), "function");
});

test("strategy catalog dispatcher maps target dry-run to a scoped non-execute run", async () => {
  const { parseArgs } = await import("../src/cli/run-strategy-catalog-dispatcher.mjs");
  const args = parseArgs([
    "--target=wrapped-btc-loop-base-moonwell",
    "--dry-run",
    "--json",
  ]);

  assert.equal(args.dryRun, true);
  assert.equal(args.execute, false);
  assert.deepEqual(args.target, ["wrapped-btc-loop-base-moonwell"]);
  assert.deepEqual(args.scope, ["wrapped-btc-loop-base-moonwell"]);
});

test("strategy catalog dispatcher builds dispatch inputs from lightweight snapshots", async () => {
  const { loadStrategyCatalogDispatchInputs } = await import("../src/cli/run-strategy-catalog-dispatcher.mjs");
  const loaded = await loadStrategyCatalogDispatchInputs({
    loadStrategyExecutionSurfaceInputsImpl: async ({ dataDir }) => {
      assert.equal(dataDir, "/tmp/dispatch-inputs");
      return {
        dashboardStatus: {
          generatedAt: "2026-05-06T00:00:00.000Z",
          overall: { liveTrading: "BLOCKED" },
          strategy: {},
        },
        state: { scoreSnapshot: { scores: [] } },
        triangleArtifacts: {},
        artifacts: {
          autonomousDiscoveryBoard: {
            generatedAt: "2026-05-06T00:00:00.000Z",
            summary: { opportunityCount: 1, readyNowCount: 0 },
            opportunities: [
              {
                id: "gateway_wrapped_btc_loops",
                label: "Gateway wrapped-BTC loops",
                type: "strategy",
                lane: "btc_family",
                status: "review",
                selectionScore: 7,
              },
            ],
          },
        },
      };
    },
    dataDir: "/tmp/dispatch-inputs",
  });

  assert.equal(loaded.executionSurfaces.summary.strategyCount > 0, true);
  assert.equal(loaded.planningBridge.authority, "planning_only");
  assert.equal(loaded.planningBridge.topCandidateId, "gateway_wrapped_btc_loops");
});
