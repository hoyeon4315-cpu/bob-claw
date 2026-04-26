import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardLaunchAgentSpecs, DASHBOARD_LAUNCHD_LABELS } from "../src/runtime/launchd.mjs";

test("dashboard live launchd spec points at the public live controller", () => {
  const [spec] = buildDashboardLaunchAgentSpecs({
    rootDir: "/repo",
    nodePath: "/opt/homebrew/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: "/repo/logs/launchd",
    homeDir: "/Users/test",
    pathEnv: "/opt/homebrew/bin:/usr/bin:/bin",
  });
  assert.equal(spec.label, DASHBOARD_LAUNCHD_LABELS.publicLive);
  assert.deepEqual(spec.programArguments, [
    "/opt/homebrew/bin/node",
    "/repo/src/cli/run-dashboard-public-live.mjs",
  ]);
  assert.equal(spec.stdoutPath, "/repo/logs/launchd/dashboard-public-live.out.log");
  assert.equal(spec.stderrPath, "/repo/logs/launchd/dashboard-public-live.err.log");
});
