import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runFirstBroadcastRunnerCli } from "../../src/cli/run-first-broadcast-runner.mjs";

test("first broadcast runner preview captures steps and never executes live command", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-first-broadcast-"));
  const calls = [];
  const result = await runFirstBroadcastRunnerCli(["--preview", "--json"], {
    cwd: root,
    dataDir: join(root, "data"),
    runStep: async (step) => {
      calls.push(step);
      if (step.id === "merkl_orchestrator") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            summary: { executableNow: 1 },
            candidates: [{ id: "merkl-1", expectedRealizedNetUsd: 0.42, executableNow: true }],
          }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.some((step) => step.args.includes("--execute")), false);
  assert.equal(result.payload.mode, "preview");
  assert.equal(result.payload.selectedCandidate.kind, "merkl");
  const stepLog = JSON.parse(await readFile(join(root, "data", "first-broadcast-runs", "merkl_orchestrator.json"), "utf8"));
  assert.equal(stepLog.stepId, "merkl_orchestrator");
  const finalLog = JSON.parse(await readFile(join(root, "data", "first-broadcast-runs", "final.json"), "utf8"));
  assert.equal(finalLog.outcome, "candidate_selected_preview");
});

test("first broadcast runner reports no-op when every candidate set is empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-first-broadcast-empty-"));
  const result = await runFirstBroadcastRunnerCli(["--preview", "--json"], {
    cwd: root,
    dataDir: join(root, "data"),
    runStep: async () => ({ exitCode: 0, stdout: JSON.stringify({ summary: { executableNow: 0 }, candidates: [] }), stderr: "" }),
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.selectedCandidate, null);
  assert.equal(result.payload.outcome, "no_candidate_sets_non_empty");
});

test("first broadcast runner continues preview ladder after a blocked intermediate step", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-first-broadcast-continue-"));
  const calls = [];
  const result = await runFirstBroadcastRunnerCli(["--preview", "--json"], {
    cwd: root,
    dataDir: join(root, "data"),
    runStep: async (step) => {
      calls.push(step.id);
      if (step.id === "merkl_orchestrator") {
        return { exitCode: 1, stdout: JSON.stringify({ status: "blocked" }), stderr: "" };
      }
      if (step.id === "radar_promote") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ candidates: [{ candidateId: "radar-1", status: "ready", expectedNetUsd: 0.1 }] }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.includes("cold_start_canary"), true);
  assert.equal(result.payload.selectedCandidate.kind, "radar");
});


test("first broadcast runner execute refuses candidates without a single-candidate selector", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-first-broadcast-broad-"));
  const calls = [];
  const result = await runFirstBroadcastRunnerCli(["--execute", "--json"], {
    cwd: root,
    dataDir: join(root, "data"),
    runStep: async (step) => {
      calls.push(step);
      if (step.id === "merkl_orchestrator") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            summary: { executableNow: 1 },
            candidates: [{ id: "merkl-1", expectedRealizedNetUsd: 0.42, executableNow: true }],
          }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.payload.outcome, "execute_blocked_no_single_broadcast_selector");
  assert.equal(calls.some((step) => step.args.includes("--execute")), false);
});

test("first broadcast runner execute invokes only the selected cold-start canary", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-first-broadcast-execute-"));
  const calls = [];
  const result = await runFirstBroadcastRunnerCli(["--execute", "--json"], {
    cwd: root,
    dataDir: join(root, "data"),
    runStep: async (step) => {
      calls.push(step);
      if (step.id === "cold_start_canary") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            status: "ready",
            selectedCandidate: { candidateId: "candidate-1" },
            selectedEv: { expectedNetUsd: 0.21 },
          }),
          stderr: "",
        };
      }
      if (step.id === "selected_execute") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ run: { outcome: "not_broadcast", reason: "signed_false" } }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    now: "2026-05-09T00:00:00.000Z",
  });

  const executeCalls = calls.filter((step) => step.args.includes("--execute"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.outcome, "not_broadcast");
  assert.equal(executeCalls.length, 1);
  assert.deepEqual(executeCalls[0].args, [
    "run",
    "cold-start:canary",
    "--",
    "--execute",
    "--candidate-id=candidate-1",
    "--json",
  ]);
  const executeLog = JSON.parse(await readFile(join(root, "data", "first-broadcast-runs", "selected_execute.json"), "utf8"));
  assert.equal(executeLog.selectedCandidate.kind, "radar_canary");
});

test("first broadcast runner execute respects fresh single-broadcast lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-first-broadcast-lock-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "first-broadcast.lock"), JSON.stringify({ createdAt: "2026-05-09T00:00:00.000Z" }));
  const result = await runFirstBroadcastRunnerCli(["--execute", "--json"], {
    cwd: root,
    dataDir,
    runStep: async (step) => {
      if (step.id === "cold_start_canary") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            status: "ready",
            selectedCandidate: { candidateId: "candidate-1" },
            selectedEv: { expectedNetUsd: 0.21 },
          }),
          stderr: "",
        };
      }
      assert.notEqual(step.id, "selected_execute");
      return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    now: "2026-05-09T00:05:00.000Z",
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.payload.outcome, "execute_blocked_lock_active");
});
