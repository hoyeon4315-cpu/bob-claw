import assert from "node:assert/strict";
import { test } from "node:test";
import { buildResearchLaunchAgentSpecs, RESEARCH_LAUNCHD_LABELS } from "../src/runtime/launchd.mjs";

test("research launchd spec stays isolated from signer key env and runs research sidecars", () => {
  const specs = buildResearchLaunchAgentSpecs({
    rootDir: "/repo",
    nodePath: "/opt/homebrew/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: "/repo/logs/launchd",
    homeDir: "/Users/test",
    pathEnv: "/opt/homebrew/bin:/usr/bin:/bin",
  });
  const [spec, autoCoder] = specs;

  assert.equal(spec.label, RESEARCH_LAUNCHD_LABELS.daily);
  assert.deepEqual(spec.programArguments, [
    "/opt/homebrew/bin/node",
    "/repo/src/cli/run-auto-research-refresh.mjs",
    "--continue-on-failure",
    "--stale-hours=20",
    "--max-experiments=100",
  ]);
  assert.equal(spec.stdoutPath, "/repo/logs/launchd/research-daily.out.log");
  assert.equal(spec.stderrPath, "/repo/logs/launchd/research-daily.err.log");
  assert.equal(spec.startInterval, 86_400);
  assert.equal("BURNER_EVM_KEY_PATH" in spec.environmentVariables, false);
  assert.equal("BURNER_BTC_KEY_PATH" in spec.environmentVariables, false);
  assert.equal(autoCoder.label, RESEARCH_LAUNCHD_LABELS.autoCoder);
  assert.deepEqual(autoCoder.programArguments, [
    "/opt/homebrew/bin/node",
    "/repo/src/cli/auto-research-pipeline.mjs",
    "--json",
  ]);
  assert.equal(autoCoder.stdoutPath, "/repo/logs/launchd/research-autocoder.out.log");
  assert.equal(autoCoder.stderrPath, "/repo/logs/launchd/research-autocoder.err.log");
  assert.equal(autoCoder.startInterval, 86_400);
  assert.equal("BURNER_EVM_KEY_PATH" in autoCoder.environmentVariables, false);
  assert.equal("BURNER_BTC_KEY_PATH" in autoCoder.environmentVariables, false);
});
