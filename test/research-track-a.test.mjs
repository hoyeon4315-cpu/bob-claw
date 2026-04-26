import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

function tempDir(name) {
  return mkdtempSync(join(tmpdir(), `bob-claw-${name}-`));
}

test("Track A env runner materializes and scores an agent candidate", () => {
  const dir = tempDir("research-track-a");
  try {
    const candidateDir = join(dir, "candidates");
    const resultsPath = join(dir, "results.tsv");
    const dataDir = join(dir, "data");
    const result = spawnSync(
      "npm",
      [
        "run",
        "research",
        "--",
        "--max-experiments=1",
        `--data-dir=${dataDir}`,
        `--candidate-dir=${candidateDir}`,
        `--results-path=${resultsPath}`,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          RESEARCH_AGENT_CMD: process.execPath,
          RESEARCH_AGENT_ARGS: JSON.stringify([resolve("research", "trackA-agent.mjs"), "--max-experiments=1"]),
          DEV_LOCK_PATH: join(dir, "DEV_LOCK"),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /trackA: status=completed generated=1/);
    assert.equal(existsSync(join(candidateDir, "agent_momentum_bridge_01.mjs")), true);
    assert.equal(existsSync(resultsPath), true);
    assert.match(readFileSync(resultsPath, "utf8"), /agent_momentum_bridge_01/);
    assert.match(readFileSync(join(dataDir, "research-track-a-runs.jsonl"), "utf8"), /"generatedCount":1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
