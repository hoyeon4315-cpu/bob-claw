import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function makeTempWorkspace(name) {
  const dir = join(tmpdir(), `bob-claw-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runCliLocked(script, args = ["--execute", "--json"]) {
  const dir = makeTempWorkspace("dev-lock-cli");
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const lockPath = join(dir, "DEV_LOCK");
  writeFileSync(lockPath, "locked\n");
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
      BOB_GATEWAY_API_BASE: "http://127.0.0.1:9",
      DEV_LOCK_PATH: lockPath,
    },
    encoding: "utf8",
  });
  return { result, dataDir, dir };
}

for (const script of [
  "src/cli/run-gateway-update-autopilot.mjs",
  "src/cli/run-autonomous-discovery-board.mjs",
  "src/cli/run-shadow-refresh-queue.mjs",
  "src/cli/run-shadow-refresh-batch.mjs",
]) {
  test(`${script} exits cleanly without side effects when dev-locked`, () => {
    const { result, dataDir, dir } = runCliLocked(script);
    try {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stderr, /dev-lock active/);
      assert.equal(result.stdout.trim(), "");
      assert.deepEqual(readdirSync(dataDir), []);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });
}
