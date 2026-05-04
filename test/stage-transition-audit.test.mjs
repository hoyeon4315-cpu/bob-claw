import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  getLatestStageTransition,
  syncStageTransitionAudit,
} from "../src/executor/policy/stage-transition-audit.mjs";

test("stage transition audit appends once per stage change and stays idempotent for repeated stage B", async () => {
  const logsDir = await mkdtemp(join(tmpdir(), "bob-claw-stage-audit-"));
  const stageEvaluation = {
    currentStage: "B",
    blockers: ["refresh_success_ratio_below_stage_b_threshold"],
    evidence: {
      refreshSuccessRatio24h: 0.89,
    },
  };

  const first = await syncStageTransitionAudit({
    logsDir,
    stageEvaluation,
    observedAt: "2026-05-05T00:00:00.000Z",
  });
  const second = await syncStageTransitionAudit({
    logsDir,
    stageEvaluation,
    observedAt: "2026-05-05T00:05:00.000Z",
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);

  const file = await readFile(join(logsDir, "stage-transitions.jsonl"), "utf8");
  const lines = file.trim().split("\n");
  assert.equal(lines.length, 1);

  const latest = await getLatestStageTransition({ logsDir });
  assert.equal(latest.fromStage, "unknown");
  assert.equal(latest.toStage, "B");
});
