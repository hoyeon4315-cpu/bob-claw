import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function runCli(args, { dataDir, env = {} } = {}) {
  return spawnSync(process.execPath, ["src/cli/report-dev-agent-automation-bridge.mjs", ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
      ...env,
    },
    encoding: "utf8",
  });
}

test("dev-agent bridge CLI writes a JSON artifact from existing discovery reports", () => {
  const dir = makeTempWorkspace("dev-agent-bridge-cli");
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  try {
    writeFileSync(
      join(dataDir, "route-remediation-autopilot.json"),
      `${JSON.stringify({
        generatedAt: "2026-05-03T00:00:00.000Z",
        workOrders: [
          {
            rank: 1,
            candidateId: "base-route-gap",
            candidateLabel: "Base route gap",
            chain: "base",
            action: "build_route_adapter",
            estimatedNetAfterBuildUsd: 5,
            sourceBlockers: ["gateway_route_missing"],
            safety: {
              allowedToExecuteLive: false,
              signerBypass: false,
              runtimeMutation: false,
              llmSigningAllowed: false,
            },
            implementationPlan: {
              writeScope: ["src/strategy/", "test/"],
              requiredTests: ["route adapter test"],
              steps: ["Add adapter."],
            },
          },
        ],
      })}\n`,
    );

    const result = runCli(["--write", "--json"], { dataDir });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    const artifactPath = join(dataDir, "dev-agent-automation-bridge.json");
    assert.equal(existsSync(artifactPath), true);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

    assert.equal(output.summary.taskCount, 1);
    assert.equal(artifact.mode, "dev_agent_task_queue");
    assert.equal(artifact.tasks[0].safety.allowedToExecuteLive, false);
    assert.equal(artifact.modelPolicy.runtimeAuthority, "none");
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

test("dev-agent bridge CLI respects dev-lock for writes", () => {
  const dir = makeTempWorkspace("dev-agent-bridge-lock");
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const lockPath = join(dir, "DEV_LOCK");
  writeFileSync(lockPath, "locked\n");
  try {
    const result = runCli(["--write", "--json"], {
      dataDir,
      env: { DEV_LOCK_PATH: lockPath },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /dev-lock active/);
    assert.equal(result.stdout.trim(), "");
    assert.equal(existsSync(join(dataDir, "dev-agent-automation-bridge.json")), false);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});
