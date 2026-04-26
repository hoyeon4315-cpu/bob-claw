import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAutoResearchRefreshPlan,
  isResearchRefreshDue,
  parseArgs,
} from "../src/cli/run-auto-research-refresh.mjs";

test("auto research refresh parseArgs reads cadence and skip options", () => {
  const args = parseArgs([
    "--loop",
    "--force",
    "--continue-on-failure",
    "--intervalMs=900000",
    "--stale-hours=26",
    "--max-experiments=42",
    "--skip-score",
    "--skip-research-board",
    "--skip-deterministic-candidates",
  ]);

  assert.equal(args.loop, true);
  assert.equal(args.force, true);
  assert.equal(args.continueOnFailure, true);
  assert.equal(args.intervalMs, 900000);
  assert.equal(args.staleHours, 26);
  assert.equal(args.maxExperiments, 42);
  assert.equal(args.skipScore, true);
  assert.equal(args.skipResearchBoard, true);
  assert.equal(args.skipDeterministicCandidates, true);
});

test("auto research refresh plan includes downstream artifact refresh after research run", () => {
  const args = parseArgs([]);
  const plan = buildAutoResearchRefreshPlan({ args, runResearch: true });
  assert.deepEqual(plan.map((step) => step.name), [
    "research_daily",
    "research_score",
    "strategy_research_board",
    "deterministic_strategy_candidates",
  ]);
  assert.deepEqual(plan[0].args, ["--daily", "--max-experiments=100"]);
  assert.deepEqual(plan[1].args, ["--no-emit-intents"]);
  assert.deepEqual(plan[2].args, ["--write"]);
  assert.deepEqual(plan[3].args, ["--write"]);
});

test("auto research refresh staleness guard triggers only when latest run is old enough", () => {
  assert.equal(isResearchRefreshDue({ latestRunAt: null, staleHours: 20, now: Date.parse("2026-04-27T00:00:00.000Z") }), true);
  assert.equal(
    isResearchRefreshDue({
      latestRunAt: "2026-04-26T10:30:00.000Z",
      staleHours: 20,
      now: Date.parse("2026-04-27T00:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    isResearchRefreshDue({
      latestRunAt: "2026-04-25T23:00:00.000Z",
      staleHours: 20,
      now: Date.parse("2026-04-27T00:00:00.000Z"),
    }),
    true,
  );
});
