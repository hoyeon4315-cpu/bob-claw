import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGitCommitMessage,
  buildGitOpsPlan,
  parseGitStatus,
} from "../src/session/git-ops-automation.mjs";

test("git ops plan excludes generated dashboard artifacts by default", () => {
  const plan = buildGitOpsPlan({
    branch: "main",
    statusEntries: parseGitStatus([
      " M dashboard/public/dashboard-status.json",
      " M dashboard/public/auto-kill-events.json",
      " M dashboard/public/strategy-tick-status.json",
      " M src/strategy/autonomous-discovery-board.mjs",
      "?? src/cli/run-gateway-update-autopilot.mjs",
    ].join("\n")),
  });

  assert.equal(plan.commitReady, true);
  assert.deepEqual(plan.includedPaths, [
    "src/strategy/autonomous-discovery-board.mjs",
    "src/cli/run-gateway-update-autopilot.mjs",
  ]);
  assert.deepEqual(plan.excludedPaths, [
    "dashboard/public/dashboard-status.json",
    "dashboard/public/auto-kill-events.json",
    "dashboard/public/strategy-tick-status.json",
  ]);
  assert.deepEqual(plan.generatedArtifactPaths, [
    "dashboard/public/dashboard-status.json",
    "dashboard/public/auto-kill-events.json",
    "dashboard/public/strategy-tick-status.json",
  ]);
});

test("git ops plan can be scoped to explicit include paths", () => {
  const plan = buildGitOpsPlan({
    branch: "feature/autonomous-rollout",
    includePaths: ["src/executor/all-chain-autopilot.mjs"],
    statusEntries: parseGitStatus([
      " M src/executor/all-chain-autopilot.mjs",
      " M src/status/current-dashboard-context.mjs",
    ].join("\n")),
  });

  assert.deepEqual(plan.includedPaths, ["src/executor/all-chain-autopilot.mjs"]);
  assert.equal(plan.excludedPathCount, 0);
});

test("git commit message appends coauthor trailer once", () => {
  const message = buildGitCommitMessage("Ship autonomous optimization rollout");
  assert.equal(message.includes("Ship autonomous optimization rollout"), true);
  assert.equal(message.includes("Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"), true);
  assert.equal(buildGitCommitMessage(message), message);
});
