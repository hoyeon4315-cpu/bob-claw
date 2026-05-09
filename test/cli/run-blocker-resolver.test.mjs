import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runBlockerResolverCli } from "../../src/cli/run-blocker-resolver.mjs";

async function fixtureRoot(name) {
  const root = await mkdtemp(join(tmpdir(), name));
  await mkdir(join(root, "data"), { recursive: true });
  await mkdir(join(root, "dashboard", "public"), { recursive: true });
  await writeFile(join(root, "dashboard", "public", "strategy-tick-status.json"), JSON.stringify({
    schemaVersion: 5,
    strategies: [
      { strategyId: "s1", lastTickBlockers: ["stale_gateway_quote"], lastTickAt: "2026-05-09T00:00:00.000Z" },
      { strategyId: "s2", topDenyReason: "same_chain_unprofitable:need_$5_on_base", lastTickAt: "2026-05-09T00:00:00.000Z" },
    ],
  }));
  return root;
}

test("blocker resolver preview writes a plan and never enqueues", async () => {
  const root = await fixtureRoot("bob-claw-resolver-preview-");
  let executed = false;
  const result = await runBlockerResolverCli(["--preview"], {
    cwd: root,
    dataDir: join(root, "data"),
    dashboardDir: join(root, "dashboard", "public"),
    executeAction: async () => {
      executed = true;
    },
    now: "2026-05-09T00:00:01.000Z",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(executed, false);
  const preview = JSON.parse(await readFile(join(root, "data", "blocker-resolution-preview.json"), "utf8"));
  assert.equal(preview.summary.resolverActionableCount, 1);
  assert.equal(preview.summary.requiresStrategyOrCapitalChangeCount, 0);
  assert.equal(preview.filteredCandidates.count, 1);
  assert.equal(preview.groups[0].expectedDailyUsdOnResolve ?? null, null);
});

test("blocker resolver execute respects readiness hard guard", async () => {
  const root = await fixtureRoot("bob-claw-resolver-guard-");
  const result = await runBlockerResolverCli(["--execute"], {
    cwd: root,
    dataDir: join(root, "data"),
    dashboardDir: join(root, "dashboard", "public"),
    readGlobalGuards: async () => ({
      ok: false,
      blockers: ["readiness_guard_blocked"],
      readyForLiveBroadcast: false,
    }),
    now: "2026-05-09T00:00:01.000Z",
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /readiness_guard_blocked/);
});
