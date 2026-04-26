import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readExecutionGuards } from "../src/execution/guards.mjs";

async function withWorkspace(name, fn) {
  const root = join(tmpdir(), `bob-claw-${name}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("readExecutionGuards blocks live execution when kill-switch file is present", async () => {
  await withWorkspace("execution-guards-kill-switch", async (root) => {
    const killSwitchPath = join(root, "kill.switch");
    const emergencyStopPath = join(root, "emergency.stop");
    const liveModePath = join(root, "live-mode.enabled");
    await writeFile(killSwitchPath, "halted\n", "utf8");
    await writeFile(liveModePath, "enabled\n", "utf8");

    const guards = await readExecutionGuards({
      emergencyStopPath,
      liveModePath,
      killSwitchPath,
      mode: "live",
    });

    assert.equal(guards.blocked, true);
    assert.equal(guards.killSwitchActive, true);
    assert.deepEqual(guards.reasons, ["kill_switch_active"]);
  });
});

test("readExecutionGuards combines kill-switch and live mode blockers", async () => {
  await withWorkspace("execution-guards-live-mode", async (root) => {
    const killSwitchPath = join(root, "kill.switch");
    const emergencyStopPath = join(root, "emergency.stop");
    const liveModePath = join(root, "live-mode.enabled");
    await writeFile(killSwitchPath, "halted\n", "utf8");

    const guards = await readExecutionGuards({
      emergencyStopPath,
      liveModePath,
      killSwitchPath,
      mode: "live",
    });

    assert.equal(guards.blocked, true);
    assert.deepEqual(guards.reasons, ["kill_switch_active", "live_mode_not_enabled"]);
  });
});

test("readExecutionGuards does not duplicate stop reasons when paths match", async () => {
  await withWorkspace("execution-guards-shared-stop", async (root) => {
    const killSwitchPath = join(root, "stop.flag");
    const liveModePath = join(root, "live-mode.enabled");
    await writeFile(killSwitchPath, "halted\n", "utf8");
    await writeFile(liveModePath, "enabled\n", "utf8");

    const guards = await readExecutionGuards({
      emergencyStopPath: killSwitchPath,
      liveModePath,
      killSwitchPath,
      mode: "live",
    });

    assert.deepEqual(guards.reasons, ["kill_switch_active"]);
  });
});
