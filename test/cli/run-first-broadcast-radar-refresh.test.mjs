import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runFirstBroadcastRunnerCli } from "../../src/cli/run-first-broadcast-runner.mjs";

test("first broadcast runner refreshes Merkl radar inputs before promotion by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-first-broadcast-refresh-"));
  const calls = [];
  const result = await runFirstBroadcastRunnerCli(["--preview", "--json"], {
    cwd: root,
    dataDir: join(root, "data"),
    runStep: async (step) => {
      calls.push(step);
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, candidates: [] }), stderr: "" };
    },
    now: "2026-05-09T00:00:00.000Z",
  });

  const ids = calls.map((step) => step.id);
  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.refreshRadar, true);
  assert.ok(ids.indexOf("radar_sync_merkl") >= 0);
  assert.ok(ids.indexOf("radar_ingest") > ids.indexOf("radar_sync_merkl"));
  assert.ok(ids.indexOf("radar_promote") > ids.indexOf("radar_ingest"));
  assert.ok(calls.find((step) => step.id === "cold_start_canary").args.includes("--refresh-proofs"));
});

test("first broadcast runner can skip radar refresh explicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-first-broadcast-no-refresh-"));
  const calls = [];
  const result = await runFirstBroadcastRunnerCli(["--preview", "--json", "--no-refresh"], {
    cwd: root,
    dataDir: join(root, "data"),
    runStep: async (step) => {
      calls.push(step);
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, candidates: [] }), stderr: "" };
    },
    now: "2026-05-09T00:00:00.000Z",
  });

  const ids = calls.map((step) => step.id);
  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.refreshRadar, false);
  assert.equal(ids.includes("radar_sync_merkl"), false);
  assert.equal(ids.includes("radar_ingest"), false);
  assert.ok(calls.find((step) => step.id === "cold_start_canary").args.includes("--no-refresh"));
});
