import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildExecutorLaunchAgentSpecs,
  buildLiveAutomationLaunchAgentSpecs,
  buildResearchLaunchAgentSpecs,
  buildStrategyAutomationLaunchAgentSpecs,
  parseLaunchctlPrint,
  readLaunchAgentStatus,
  renderLaunchAgentPlist,
} from "../src/runtime/launchd.mjs";

test("buildExecutorLaunchAgentSpecs wires executor launch agents", () => {
  const specs = buildExecutorLaunchAgentSpecs({
    rootDir: "/repo",
    nodePath: "/usr/local/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: "/repo/logs/launchd",
    homeDir: "/Users/test",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  assert.deepEqual(specs.map((spec) => spec.id), ["daemon", "watchdog"]);
  assert.equal(specs[0].programArguments[0], "/usr/local/bin/node");
  assert.equal(specs[0].scriptPath, "/repo/src/executor/signer/daemon.mjs");
  assert.equal(specs[1].scriptPath, "/repo/src/cli/run-executor-watchdog.mjs");
  assert.ok("PATH" in specs[0].environmentVariables);
  assert.ok("HOME" in specs[0].environmentVariables);

  const daemonPlist = renderLaunchAgentPlist(specs[0]);
  assert.match(daemonPlist, /com\.bobclaw\.executor-daemon/);
  assert.match(daemonPlist, /\/repo\/src\/executor\/signer\/daemon\.mjs/);
  assert.match(daemonPlist, /\/repo\/logs\/launchd\/executor-daemon\.out\.log/);
});

test("buildLiveAutomationLaunchAgentSpecs wires gate self-heal and all-chain autopilot agents", () => {
  const specs = buildLiveAutomationLaunchAgentSpecs({
    rootDir: "/repo",
    nodePath: "/usr/local/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: "/repo/logs/launchd",
    homeDir: "/Users/test",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  assert.deepEqual(specs.map((spec) => spec.id), ["gate-self-heal", "all-chain-autopilot"]);
  assert.equal(specs[0].scriptPath, "/repo/src/cli/run-gate-self-heal.mjs");
  assert.ok(specs[0].programArguments.includes("--loop"));
  assert.equal(specs[1].scriptPath, "/repo/src/cli/run-all-chain-autopilot.mjs");
  assert.ok(specs[1].programArguments.includes("--write"));
  assert.ok(specs[1].programArguments.includes("--execute"));
  assert.ok("PATH" in specs[0].environmentVariables);
  assert.ok("HOME" in specs[0].environmentVariables);
});

test("buildResearchLaunchAgentSpecs wires stale-aware auto research refresh agent", () => {
  const specs = buildResearchLaunchAgentSpecs({
    rootDir: "/repo",
    nodePath: "/usr/local/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: "/repo/logs/launchd",
    homeDir: "/Users/test",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  assert.equal(specs.length, 1);
  assert.equal(specs[0].id, "daily");
  assert.equal(specs[0].scriptPath, "/repo/src/cli/run-auto-research-refresh.mjs");
  assert.ok(specs[0].programArguments.includes("--stale-hours=20"));
  assert.ok(specs[0].programArguments.includes("--max-experiments=100"));
  assert.equal(specs[0].runAtLoad, false);
  assert.equal(specs[0].keepAlive, false);
});

test("buildStrategyAutomationLaunchAgentSpecs wires strategy evidence refresh agent", () => {
  const specs = buildStrategyAutomationLaunchAgentSpecs({
    rootDir: "/repo",
    nodePath: "/usr/local/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: "/repo/logs/launchd",
    homeDir: "/Users/test",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  assert.equal(specs.length, 1);
  assert.equal(specs[0].id, "strategy-evidence-refresh");
  assert.equal(specs[0].scriptPath, "/repo/src/cli/run-strategy-evidence-refresh.mjs");
  assert.ok(specs[0].programArguments.includes("--loop"));
  assert.ok(specs[0].programArguments.includes("--continue-on-failure"));
  assert.ok("PATH" in specs[0].environmentVariables);
  assert.ok("HOME" in specs[0].environmentVariables);
});

test("parseLaunchctlPrint extracts pid, state, and exit code", () => {
  const parsed = parseLaunchctlPrint(`
system service = {
  state = running
  pid = 12345
  last exit code = 0
}
`);
  assert.equal(parsed.pid, 12345);
  assert.equal(parsed.state, "running");
  assert.equal(parsed.lastExitCode, 0);
});

test("readLaunchAgentStatus distinguishes configured services from loaded services", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-launchd-"));
  const plistPath = join(dir, "com.bobclaw.executor-daemon.plist");
  await writeFile(plistPath, "<plist/>", "utf8");

  const configuredOnly = await readLaunchAgentStatus(
    {
      id: "daemon",
      label: "com.bobclaw.executor-daemon",
      plistPath,
    },
    {
      uid: 501,
      launchctlRunner: () => ({
        status: 113,
        stdout: "",
        stderr: "Could not find service",
        error: null,
      }),
    },
  );
  assert.equal(configuredOnly.status, "configured_not_loaded");
  assert.equal(configuredOnly.plistPresent, true);
  assert.equal(configuredOnly.loaded, false);

  const loaded = await readLaunchAgentStatus(
    {
      id: "daemon",
      label: "com.bobclaw.executor-daemon",
      plistPath,
    },
    {
      uid: 501,
      launchctlRunner: () => ({
        status: 0,
        stdout: "state = running\npid = 4242\nlast exit code = 0\n",
        stderr: "",
        error: null,
      }),
    },
  );
  assert.equal(loaded.status, "loaded_running");
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.running, true);
  assert.equal(loaded.pid, 4242);
});
