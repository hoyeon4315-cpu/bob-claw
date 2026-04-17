import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLiveReadinessRefreshPlan,
  runLiveReadinessRefreshPlan,
  summarizeLiveReadinessRefreshPlan,
} from "../src/session/live-readiness-refresh.mjs";

test("live readiness refresh plan rebuilds the full wrapped-loop packet in order", () => {
  const plan = buildLiveReadinessRefreshPlan();
  assert.deepEqual(
    plan.map((step) => step.script),
    [
      "src/cli/run-current-route-prelive-pass.mjs",
      "src/cli/report-strategy-snapshot.mjs",
      "src/cli/report-phase3-strategy-validation.mjs",
      "src/cli/report-allocator-core.mjs",
      "src/cli/report-protocol-market-watchers.mjs",
      "src/cli/validate-prelive-readiness.mjs",
      "src/cli/build-prelive-review-package.mjs",
      "src/cli/report-prelive-readiness.mjs",
      "src/cli/report-btc-only-e2e-dry-run.mjs",
      "src/cli/report-tiny-live-canary-rollout.mjs",
      "src/cli/report-live-ops-handoff.mjs",
      "src/cli/report-final-operator-explainer.mjs",
      "src/cli/write-session-handoff.mjs",
    ],
  );
  assert.deepEqual(plan[0].args, ["--execute", "--continue-on-failure"]);
  assert.deepEqual(plan[1].args, ["--write"]);
  assert.deepEqual(plan[2].args, ["--write"]);
  assert.deepEqual(plan.at(-1).args, []);
  assert.equal(
    summarizeLiveReadinessRefreshPlan(plan)[0],
    "node src/cli/run-current-route-prelive-pass.mjs --execute --continue-on-failure",
  );
});

test("live readiness refresh runner executes each step in order", () => {
  const seen = [];
  const results = runLiveReadinessRefreshPlan({
    plan: [
      { script: "src/cli/first.mjs", args: ["--write"] },
      { script: "src/cli/second.mjs", args: [] },
    ],
    runStep: (step) => {
      seen.push(step.script);
      return {
        stdout: `${step.script}:ok`,
        stderr: "",
      };
    },
  });

  assert.deepEqual(seen, ["src/cli/first.mjs", "src/cli/second.mjs"]);
  assert.equal(results[0].stdout, "src/cli/first.mjs:ok");
  assert.equal(results[1].stdout, "src/cli/second.mjs:ok");
});
