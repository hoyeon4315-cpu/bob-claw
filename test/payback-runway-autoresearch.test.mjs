import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildPaybackRunwayAutoResearchPlan,
  runPaybackRunwayAutoResearch,
} from "../src/research/payback-runway-autoresearch.mjs";

function tempRoot(name) {
  return mkdtempSync(join(tmpdir(), `bob-claw-${name}-`));
}

function fakeStepRunner({ paybackRunwayStatus = "profit_creation_required" } = {}) {
  const calls = [];
  const runner = async (step) => {
    calls.push(step);
    if (step.name === "research_score") {
      return {
        name: step.name,
        script: step.script,
        args: step.args,
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdoutTail: "",
        stderrTail: "",
        json: {
          observedAt: "2026-05-07T00:00:00.000Z",
          scannedRunCount: 2,
          candidateCount: 2,
          promotionIntentCount: 0,
          candidates: [
            { candidateName: "weak", passed: false, blockers: ["negative_oos"] },
            { candidateName: "also-weak", passed: false, blockers: ["overfit_guard"] },
          ],
        },
      };
    }
    if (step.name === "payback_status") {
      return {
        name: step.name,
        script: step.script,
        args: step.args,
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdoutTail: "",
        stderrTail: "",
        json: {
          payback: {
            grossProfitSatsPeriod: 601,
            scheduler: {
              status: "carry",
              reason: "planned_payback_below_minimum",
            },
          },
          runway: {
            status: paybackRunwayStatus,
          },
        },
      };
    }
    return {
      name: step.name,
      script: step.script,
      args: step.args,
      ok: true,
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdoutTail: "",
      stderrTail: "",
      json: null,
    };
  };
  return { calls, runner };
}

test("payback runway autoresearch plan clamps to at least 20 preview-only research iterations", () => {
  const plan = buildPaybackRunwayAutoResearchPlan({
    iterations: 3,
    maxExperiments: 1,
    rootDir: "/tmp/payback-autoresearch-test",
    runId: "unit-test",
  });

  assert.equal(plan.iterations, 20);
  assert.equal(plan.steps.filter((step) => step.name === "research_run").length, 20);
  assert.equal(plan.steps.filter((step) => step.name === "research_score").length, 20);
  assert.equal(
    plan.steps.every((step) => step.name !== "research_score" || step.args.includes("--no-emit-intents")),
    true,
  );
  const allChainStep = plan.finalSteps.find((step) => step.name === "all_chain_autopilot");
  assert.deepEqual(allChainStep.args, ["--json", "--write"]);
});

test("payback runway autoresearch run aggregates 20 isolated iterations and preserves preview mode", async () => {
  const { calls, runner } = fakeStepRunner();
  const report = await runPaybackRunwayAutoResearch({
    iterations: 20,
    maxExperiments: 2,
    rootDir: tempRoot("payback-autoresearch"),
    runId: "stubbed-run",
    now: "2026-05-07T00:00:00.000Z",
    stepRunner: runner,
    persist: false,
  });

  assert.equal(report.summary.minimumResearchIterationsPassed, true);
  assert.equal(report.summary.iterationCount, 20);
  assert.equal(report.summary.candidateCount, 40);
  assert.equal(report.summary.passedCount, 0);
  assert.equal(report.summary.liveExecutionAttempted, false);
  assert.equal(report.summary.liveExecutionMode, "preview_only");
  assert.equal(report.summary.finalRunwayStatus, "profit_creation_required");
  assert.equal(report.summary.finalPaybackReason, "planned_payback_below_minimum");
  assert.equal(report.summary.nextAction, "create_payback_eligible_realized_pnl");
  assert.equal(calls.filter((step) => step.name === "research_run").length, 20);
  assert.equal(
    calls.filter((step) => step.name === "research_score").every((step) => step.args.includes("--no-emit-intents")),
    true,
  );
});

test("payback runway autoresearch ignores live execution requests and stays preview-only", () => {
  const plan = buildPaybackRunwayAutoResearchPlan({
    iterations: 20,
    allowLiveExecute: true,
    rootDir: "/tmp/payback-autoresearch-test",
    runId: "live-guard",
  });
  const allChainStep = plan.finalSteps.find((step) => step.name === "all_chain_autopilot");

  assert.deepEqual(allChainStep.args, ["--json", "--write"]);
  assert.equal(plan.allowLiveExecute, false);
});

test("payback runway autoresearch points to scheduler execution when runway is ready", async () => {
  const { runner } = fakeStepRunner({ paybackRunwayStatus: "payback_delivery_ready" });
  const report = await runPaybackRunwayAutoResearch({
    iterations: 20,
    rootDir: tempRoot("payback-autoresearch-ready"),
    runId: "ready-run",
    now: "2026-05-07T00:00:00.000Z",
    stepRunner: runner,
    persist: false,
  });

  assert.equal(report.summary.finalRunwayStatus, "payback_delivery_ready");
  assert.equal(report.summary.nextAction, "run_payback_scheduler_execute");
});

test("payback runway autoresearch CLI args default to 20 preview-only iterations", async () => {
  const { parseArgs } = await import("../src/cli/run-payback-runway-autoresearch.mjs");
  const args = parseArgs(["--json", "--iterations=5", "--max-experiments=2", "--continue-on-failure"]);

  assert.equal(args.json, true);
  assert.equal(args.iterations, 20);
  assert.equal(args.maxExperiments, 2);
  assert.equal(args.continueOnFailure, true);
  assert.equal(args.includeFinalPreview, true);
  assert.equal(args.allowLiveExecute, false);
});

test("payback runway autoresearch CLI rejects live execution mode", async () => {
  const { parseArgs } = await import("../src/cli/run-payback-runway-autoresearch.mjs");

  assert.throws(
    () => parseArgs(["--allow-live-execute"]),
    /autoresearch_live_execute_not_supported/,
  );
});
