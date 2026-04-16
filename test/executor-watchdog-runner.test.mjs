import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runWatchdogCycle } from "../src/executor/watchdog/runner.mjs";
import { enforceWatchdog } from "../src/executor/watchdog/watchdog-loop.mjs";

const FIXTURE_ROOT = join(process.cwd(), "test", ".artifacts");

async function createWorkspace(prefix) {
  await mkdir(FIXTURE_ROOT, { recursive: true });
  const dir = join(FIXTURE_ROOT, `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

test("runWatchdogCycle holds fire during startup grace when heartbeat is still missing", async () => {
  let enforced = false;
  const result = await runWatchdogCycle({
    heartbeatPath: "./state/executor-heartbeat.json",
    killSwitchPath: "./state/kill-switch",
    ttlMs: 60_000,
    startupGraceMs: 60_000,
    startedAt: "2026-04-15T00:00:00.000Z",
    now: "2026-04-15T00:00:10.000Z",
    readHeartbeatImpl: async () => null,
    enforceImpl: async () => {
      enforced = true;
      throw new Error("watchdog enforcement should not run during startup grace");
    },
  });

  assert.equal(enforced, false);
  assert.equal(result.startupGraceActive, true);
  assert.equal(result.evaluation.status, "startup_grace");
  assert.equal(result.halted, false);
  assert.equal(result.killSwitchWritten, false);
});

test("enforceWatchdog does not rewrite an existing kill switch file", async () => {
  const workspace = await createWorkspace("watchdog-existing-kill-switch");
  try {
    const heartbeatPath = join(workspace, "executor-heartbeat.json");
    const killSwitchPath = join(workspace, "kill-switch.flag");
    await writeFile(
      heartbeatPath,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: "2026-04-15T00:00:00.000Z", pid: 123 }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(killSwitchPath, "already-halted\n", "utf8");

    let alerted = false;
    const result = await enforceWatchdog({
      heartbeatPath,
      killSwitchPath,
      ttlMs: 1_000,
      now: "2026-04-15T00:00:05.000Z",
      alertImpl: async () => {
        alerted = true;
      },
    });

    assert.equal(result.halted, true);
    assert.equal(result.killSwitchWritten, false);
    assert.equal(result.killSwitchPresent, true);
    assert.equal(alerted, false);
    assert.equal(await readFile(killSwitchPath, "utf8"), "already-halted\n");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("run-executor-watchdog CLI raises the kill switch for a stale heartbeat", async () => {
  const workspace = await createWorkspace("watchdog-cli");
  try {
    const heartbeatPath = join(workspace, "executor-heartbeat.json");
    const killSwitchPath = join(workspace, "kill-switch.flag");
    await writeFile(
      heartbeatPath,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: "2026-04-15T00:00:00.000Z", pid: 456 }, null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "src/cli/run-executor-watchdog.mjs",
        "--once",
        "--ttl-ms=1000",
        "--startup-grace-ms=0",
        `--heartbeat-path=${heartbeatPath}`,
        `--kill-switch-path=${killSwitchPath}`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /status=stale/);
    assert.match(result.stdout, /halted=true/);
    assert.equal(await pathExists(killSwitchPath), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
