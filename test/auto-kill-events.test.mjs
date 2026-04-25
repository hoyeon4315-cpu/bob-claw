import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAutoKillConfig } from "../src/config/auto-kill.mjs";
import { runAutoKillCheck, AUTO_KILL_EVENTS_PATH } from "../src/risk/auto-kill-events.mjs";

async function withTempRoot(fn) {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-auto-kill-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runAutoKillCheck no-ops when no triggers fire", async () => {
  await withTempRoot(async (rootDir) => {
    const killSwitchPath = join(rootDir, "kill.switch");
    const result = await runAutoKillCheck({
      auditRecords: [],
      oracleSamples: [],
      heartbeatAtMs: Date.now(),
      killSwitchPath,
      rootDir,
    });
    assert.equal(result.triggered, false);
    assert.equal(result.killSwitchWritten, false);
    let exists = true;
    try {
      await access(killSwitchPath, constants.F_OK);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, "kill-switch file must not be written");
  });
});

test("runAutoKillCheck writes kill-switch file and event log on trigger", async () => {
  await withTempRoot(async (rootDir) => {
    const killSwitchPath = join(rootDir, "kill.switch");
    const config = buildAutoKillConfig({
      oracleDivergence: { maxDivergencePct: 0.01 },
    });
    const result = await runAutoKillCheck({
      auditRecords: [],
      oracleSamples: [
        { source: "a", priceUsd: 100 },
        { source: "b", priceUsd: 110 },
      ],
      config,
      killSwitchPath,
      rootDir,
    });
    assert.equal(result.triggered, true);
    assert.equal(result.killSwitchWritten, true);
    const eventLog = await readFile(join(rootDir, AUTO_KILL_EVENTS_PATH), "utf8");
    const parsed = JSON.parse(eventLog.trim().split("\n").pop());
    assert.equal(parsed.triggers[0].trigger, "oracle_divergence");
    const killPayload = JSON.parse(await readFile(killSwitchPath, "utf8"));
    assert.equal(killPayload.triggers[0].trigger, "oracle_divergence");
  });
});

test("runAutoKillCheck does not overwrite an already-armed kill-switch", async () => {
  await withTempRoot(async (rootDir) => {
    const killSwitchPath = join(rootDir, "kill.switch");
    const config = buildAutoKillConfig({ oracleDivergence: { maxDivergencePct: 0.01 } });
    await runAutoKillCheck({
      oracleSamples: [
        { source: "a", priceUsd: 100 },
        { source: "b", priceUsd: 110 },
      ],
      config,
      killSwitchPath,
      rootDir,
    });
    const second = await runAutoKillCheck({
      oracleSamples: [
        { source: "a", priceUsd: 100 },
        { source: "b", priceUsd: 110 },
      ],
      config,
      killSwitchPath,
      rootDir,
    });
    assert.equal(second.triggered, true);
    assert.equal(second.alreadyArmed, true);
    assert.equal(second.killSwitchWritten, false);
    const eventLines = (await readFile(join(rootDir, AUTO_KILL_EVENTS_PATH), "utf8"))
      .trim()
      .split("\n");
    assert.equal(eventLines.length, 2, "every check appends an event");
  });
});
