import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  dashboardJsonOutputPath,
  dashboardJsonCandidatePaths,
} from "../src/dashboard/live-snapshot-paths.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(path, records) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

test("dashboard live snapshot helper defaults generated JSON away from dashboard/public", () => {
  assert.equal(
    dashboardJsonOutputPath("dashboard-status.json", { env: {} }),
    "data/dashboard-live/dashboard-status.json",
  );
  assert.equal(
    dashboardJsonOutputPath("dashboard-status.json", { env: {}, commitPublic: true }),
    "dashboard/public/dashboard-status.json",
  );
  assert.deepEqual(
    dashboardJsonCandidatePaths("strategy-tick-status.json", {
      rootDir: "dashboard/public",
      liveSnapshotDir: "data/dashboard-live",
      dataDir: "data",
    }),
    [
      "data/dashboard-live/strategy-tick-status.json",
      "dashboard/public/strategy-tick-status.json",
      "data/strategy-tick-status.json",
    ],
  );
});

test("report-auto-kill-events writes live snapshot by default and public only on request", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-live-writer-auto-kill-"));
  const eventsPath = join(cwd, "events.jsonl");
  await writeJsonl(eventsPath, []);

  const result = spawnSync(process.execPath, [
    join(ROOT, "src/cli/report-auto-kill-events.mjs"),
    "--write",
    `--events-path=${eventsPath}`,
  ], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(await exists(join(cwd, "data/dashboard-live/auto-kill-events.json")), true);
  assert.equal(await exists(join(cwd, "dashboard/public/auto-kill-events.json")), false);

  const publicResult = spawnSync(process.execPath, [
    join(ROOT, "src/cli/report-auto-kill-events.mjs"),
    "--write",
    "--commit-public",
    `--events-path=${eventsPath}`,
  ], { cwd, encoding: "utf8" });
  assert.equal(publicResult.status, 0, publicResult.stderr || publicResult.stdout);
  assert.equal(await exists(join(cwd, "dashboard/public/auto-kill-events.json")), true);
});

test("report-strategy-tick-slice writes live snapshot by default", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-live-writer-strategy-tick-"));
  const tickLog = join(cwd, "logs/strategy-tick.jsonl");
  const auditLog = join(cwd, "logs/signer-audit.jsonl");
  const strategyId = "wrapped-btc-loop-base-moonwell";
  await writeJsonl(tickLog, [{
    schemaVersion: 1,
    tickAt: "2026-05-08T00:00:00.000Z",
    strategies: [strategyId],
    snapshotSummary: [{ strategyId, capsConfigured: true }],
    blockers: [{ strategyId, mode: "live_candidate", blockers: [] }],
    dispatchSummary: { allowCount: 1, denyCount: 0 },
    dispatchIntents: [{ strategyId, chain: "base", decision: "allow" }],
    candidateCount: 1,
  }]);
  await writeJsonl(auditLog, []);

  const result = spawnSync(process.execPath, [
    join(ROOT, "src/cli/report-strategy-tick-slice.mjs"),
    `--tick-log=${tickLog}`,
    `--audit=${auditLog}`,
    `--strategy=${strategyId}`,
    "--quiet",
  ], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const livePath = join(cwd, "data/dashboard-live/strategy-tick-status.json");
  assert.equal(await exists(livePath), true);
  assert.equal(await exists(join(cwd, "dashboard/public/strategy-tick-status.json")), false);
  const payload = JSON.parse(await readFile(livePath, "utf8"));
  assert.equal(payload.schemaVersion, 6);
  assert.deepEqual(payload.overall, {
    latestBroadcastAt: null,
    satsSinceFirstBroadcast: 0,
    daysSinceFirstBroadcast: null,
    paybackEffectiveMinReachedAt: null,
    nextDeliveryCandidateEta: null,
  });
});
