import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateStage } from "../src/executor/policy/stage-evaluator.mjs";
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

test("stage transition audit records sustained refresh hysteresis C to B demotion exactly once", async () => {
  const logsDir = await mkdtemp(join(tmpdir(), "bob-claw-stage-demotion-"));
  await syncStageTransitionAudit({
    logsDir,
    stageEvaluation: {
      currentStage: "C",
      blockers: [],
      evidence: {
        deliveredPeriodCountOnReserveChain: 1,
      },
    },
    observedAt: "2026-05-05T00:00:00.000Z",
  });

  const demoted = evaluateStage({
    marksSlice: {
      reliability: {
        rolling24h: {
          refreshSuccessRatio: 0.97,
          transientFrequency: 0.01,
        },
        rolling7d: {
          refreshSuccessRatio: 0.98,
          transientFrequency: 0.01,
        },
        hysteresis: {
          refreshBelow90Since: "2026-05-05T01:00:00.000Z",
          refreshBelow90SustainedFor1h: true,
        },
      },
    },
    capitalPlan: {
      unresolvedRefillRoutes: 0,
      payback: {
        scheduler: {
          status: "delivered",
          reason: null,
        },
        expansionGate: {
          reserveChain: "base",
          deliveredPeriodCountOnReserveChain: 2,
        },
      },
    },
    evGateStats: {
      calibrated: true,
      matchedReceiptCount: 10,
      keyedEntryCount: 5,
      lookbackDays: 30,
    },
  });

  assert.equal(demoted.currentStage, "B");
  assert.equal(demoted.blockers.includes("stage_c_hysteresis_demoted"), true);

  const first = await syncStageTransitionAudit({
    logsDir,
    stageEvaluation: demoted,
    observedAt: "2026-05-05T02:00:00.000Z",
  });
  const second = await syncStageTransitionAudit({
    logsDir,
    stageEvaluation: demoted,
    observedAt: "2026-05-05T02:05:00.000Z",
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);

  const file = await readFile(join(logsDir, "stage-transitions.jsonl"), "utf8");
  const lines = file.trim().split("\n").map((line) => JSON.parse(line));
  const demotions = lines.filter((line) => line.fromStage === "C" && line.toStage === "B");
  assert.equal(demotions.length, 1);
  assert.equal(demotions[0].transitionType, "demote");
  assert.deepEqual(demotions[0].blockers, ["stage_c_hysteresis_demoted"]);
});
