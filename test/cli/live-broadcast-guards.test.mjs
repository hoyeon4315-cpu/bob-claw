import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  hasLiveBroadcastReadyStrategy,
  readLiveBroadcastGlobalGuards,
} from "../../src/cli/live-broadcast-guards.mjs";

test("hasLiveBroadcastReadyStrategy accepts runtime executable or policy-ready rows", () => {
  assert.equal(hasLiveBroadcastReadyStrategy({ strategies: [] }), false);
  assert.equal(hasLiveBroadcastReadyStrategy({
    strategies: [{ strategyId: "s1", layerStatus: { runtimeExecutable: true } }],
  }), true);
  assert.equal(hasLiveBroadcastReadyStrategy({
    strategies: [{ strategyId: "s2", policyReadiness: { policyOk: true } }],
  }), true);
});

test("readLiveBroadcastGlobalGuards reports kill, dev lock, and readiness blockers", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-live-broadcast-guards-"));
  const killSwitchPath = join(root, "KILL_SWITCH");
  const devLockPath = join(root, "DEV_LOCK");
  await writeFile(killSwitchPath, "halt\n");
  await writeFile(devLockPath, "lock\n");

  const result = await readLiveBroadcastGlobalGuards({
    execute: true,
    killSwitchPath,
    devLockPath,
    strategyTickStatus: { strategies: [] },
  });

  assert.equal(result.ok, false);
  assert.equal(result.killSwitchActive, true);
  assert.equal(result.devLockActive, true);
  assert.equal(result.readyForLiveBroadcast, false);
  assert.deepEqual(result.blockers, ["kill_switch_active", "dev_lock_active", "readiness_guard_blocked"]);
});
