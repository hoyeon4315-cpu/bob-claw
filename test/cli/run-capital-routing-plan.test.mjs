import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCapitalRoutingPlanCli } from "../../src/cli/run-capital-routing-plan.mjs";

async function fixtureRoot(name) {
  const root = await mkdtemp(join(tmpdir(), name));
  await mkdir(join(root, "data"), { recursive: true });
  await mkdir(join(root, "logs"), { recursive: true });
  await mkdir(join(root, "dashboard", "public"), { recursive: true });
  await writeFile(join(root, "dashboard", "public", "strategy-tick-status.json"), JSON.stringify({
    schemaVersion: 6,
    strategies: [{ strategyId: "s1", layerStatus: { runtimeBlocker: "policy_reject" }, policyReadiness: { policyOk: true }, autoExecute: true }],
  }));
  await writeFile(join(root, "dashboard", "public", "blocker-funnel.json"), JSON.stringify({
    schemaVersion: 1,
    rootCauseGroups: [{ code: "economic_no_go:edge_below_variance_floor", params: { strategyId: "s1", chain: "base" }, affectedStrategies: ["s1"] }],
  }));
  return root;
}

test("capital routing preview writes data and dashboard artifacts without enqueueing", async () => {
  const root = await fixtureRoot("bob-claw-capital-routing-preview-");
  let enqueued = false;
  const result = await runCapitalRoutingPlanCli(["--preview", "--json"], {
    cwd: root,
    dataDir: join(root, "data"),
    dashboardDir: join(root, "dashboard", "public"),
    strategies: [{ strategyId: "s1", autoExecute: true, caps: { perTxUsd: 200, perDayUsd: 500, perChainUsd: { base: 500 }, maxDailyLossUsd: 25 } }],
    snapshots: [{ strategyId: "s1", measuredEdgeBpsPerDay: 100, measuredRoundTripCostUsd: 1, slippageVarianceUsd: 0.2, varianceFloorUsd: 0.5, observedNotionalUsd: 100, freshness: { sampleCount: 3, isThin: false, lastReceiptAt: "2026-05-08T00:00:00.000Z" } }],
    treasurySnapshot: { freeCapitalUsd: 100, lockedCapitalUsd: 0, perChainUsd: { base: 100 }, sources: [{ chain: "base", asset: "USDC", freeUsd: 100 }] },
    enqueueJob: async () => {
      enqueued = true;
    },
    now: "2026-05-09T00:00:00.000Z",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(enqueued, false);
  assert.equal(result.payload.routingPlan.length, 1);
  assert.equal(result.payload.routingPlan[0].expectedDailyUsdOnResolve > 0, true);
  const dataPlan = JSON.parse(await readFile(join(root, "data", "capital-routing-plan-preview.json"), "utf8"));
  const dashboardPlan = JSON.parse(await readFile(join(root, "dashboard", "public", "capital-routing-plan.json"), "utf8"));
  assert.equal(dataPlan.routingPlan.length, 1);
  assert.equal(dashboardPlan.routingPlan.length, 1);
});

test("capital routing execute refuses readiness hard guard with exit code 2", async () => {
  const root = await fixtureRoot("bob-claw-capital-routing-guard-");
  const result = await runCapitalRoutingPlanCli(["--execute", "--json"], {
    cwd: root,
    dataDir: join(root, "data"),
    dashboardDir: join(root, "dashboard", "public"),
    readGlobalGuards: async () => ({
      ok: false,
      blockers: ["readiness_guard_blocked"],
      readyForLiveBroadcast: false,
    }),
    now: "2026-05-09T00:00:00.000Z",
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /readiness_guard_blocked/);
});
