import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveDevLockPath,
  isDevLocked,
  devLockStatus,
  exitIfDevLocked,
} from "../src/runtime/dev-lock.mjs";

test("resolveDevLockPath honors DEV_LOCK_PATH env override", () => {
  const path = resolveDevLockPath({ DEV_LOCK_PATH: "/tmp/custom-dev-lock" });
  assert.equal(path, "/tmp/custom-dev-lock");
});

test("resolveDevLockPath defaults under HOME/.bob-claw/DEV_LOCK", () => {
  const path = resolveDevLockPath({ HOME: "/Users/example" });
  assert.equal(path, "/Users/example/.bob-claw/DEV_LOCK");
});

test("isDevLocked false when file absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devlock-"));
  const path = join(dir, "DEV_LOCK");
  try {
    assert.equal(isDevLocked({ path }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isDevLocked true when file present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devlock-"));
  const path = join(dir, "DEV_LOCK");
  await writeFile(path, "locked", "utf8");
  try {
    assert.equal(isDevLocked({ path }), true);
    const status = devLockStatus({ path });
    assert.equal(status.locked, true);
    assert.ok(status.mtime);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exitIfDevLocked returns true and logs when locked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devlock-"));
  const path = join(dir, "DEV_LOCK");
  await writeFile(path, "locked", "utf8");
  let logged = "";
  try {
    const exited = exitIfDevLocked({
      cliName: "test-cli",
      path,
      logger: (msg) => {
        logged = msg;
      },
    });
    assert.equal(exited, true);
    assert.match(logged, /test-cli/);
    assert.match(logged, /dev-lock active/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exitIfDevLocked returns false when unlocked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devlock-"));
  const path = join(dir, "DEV_LOCK");
  try {
    let called = false;
    const exited = exitIfDevLocked({
      cliName: "test-cli",
      path,
      logger: () => {
        called = true;
      },
    });
    assert.equal(exited, false);
    assert.equal(called, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
