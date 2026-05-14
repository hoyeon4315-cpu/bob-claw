import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildExecutorLaunchAgentSpecs,
  buildDashboardLaunchAgentSpecs,
  buildLiveAutomationLaunchAgentSpecs,
  buildResearchLaunchAgentSpecs,
  buildStrategyAutomationLaunchAgentSpecs,
  parseLaunchctlPrint,
  readLaunchAgentStatus,
  renderLaunchAgentPlist,
} from "../src/runtime/launchd.mjs";
import { resolveDefaultHeartbeatPath, resolveDefaultSignerSocketPath } from "../src/executor/runtime-paths.mjs";
import { resolveNodeExecutable } from "../src/runtime/node-path.mjs";

test("resolveNodeExecutable prefers stable Homebrew node symlink over stale Cellar paths", () => {
  const existing = new Set(["/opt/homebrew/bin/node", "/opt/homebrew/Cellar/node/25.6.1/bin/node"]);
  const resolved = resolveNodeExecutable({
    pathEnv: "/opt/homebrew/bin:/usr/bin:/bin",
    fileExists: (path) => existing.has(path),
  });

  assert.equal(resolved, "/opt/homebrew/bin/node");
});

test("resolveNodeExecutable honors explicit operator node path", () => {
  const resolved = resolveNodeExecutable({
    requestedPath: "/custom/node",
    fileExists: () => false,
  });

  assert.equal(resolved, "/custom/node");
});

test("buildExecutorLaunchAgentSpecs wires executor launch agents", () => {
  const specs = buildExecutorLaunchAgentSpecs({
    rootDir: "/repo",
    nodePath: "/usr/local/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: "/repo/logs/launchd",
    homeDir: "/Users/test",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  assert.deepEqual(
    specs.map((spec) => spec.id),
    ["daemon", "watchdog"],
  );
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

test("buildExecutorLaunchAgentSpecs uses short runtime paths for long worktree roots", () => {
  const rootDir = "/Users/test/.config/superpowers/worktrees/BOB Claw/codex-all-source-deployment-selector";
  const specs = buildExecutorLaunchAgentSpecs({
    rootDir,
    nodePath: "/usr/local/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: `${rootDir}/logs/launchd`,
    homeDir: "/Users/test",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  const daemon = specs.find((spec) => spec.id === "daemon");
  const watchdog = specs.find((spec) => spec.id === "watchdog");
  const expectedSocketPath = resolveDefaultSignerSocketPath({ cwd: rootDir, homeDir: "/Users/test" });
  const expectedHeartbeatPath = resolveDefaultHeartbeatPath({ cwd: rootDir, homeDir: "/Users/test" });

  assert.equal(daemon.environmentVariables.EXECUTOR_SIGNER_SOCKET_PATH, expectedSocketPath);
  assert.equal(daemon.environmentVariables.EXECUTOR_HEARTBEAT_PATH, expectedHeartbeatPath);
  assert.equal(watchdog.environmentVariables.EXECUTOR_SIGNER_SOCKET_PATH, expectedSocketPath);
  assert.equal(watchdog.environmentVariables.EXECUTOR_HEARTBEAT_PATH, expectedHeartbeatPath);
  assert.equal(expectedSocketPath.startsWith("/Users/test/.bob-claw/runtime/"), true);
});

test("launchd specs never embed Cloudflare API token values", () => {
  process.env.CLOUDFLARE_API_TOKEN = "should-not-be-rendered";
  try {
    const specs = buildStrategyAutomationLaunchAgentSpecs({
      rootDir: "/repo",
      nodePath: "/usr/local/bin/node",
      launchAgentsDir: "/Users/test/Library/LaunchAgents",
      logDir: "/repo/logs/launchd",
      homeDir: "/Users/test",
      pathEnv: "/usr/local/bin:/usr/bin:/bin",
    });
    const rendered = specs.map(renderLaunchAgentPlist).join("\n");

    assert.equal(
      specs.some((spec) => "CLOUDFLARE_API_TOKEN" in spec.environmentVariables),
      false,
    );
    assert.doesNotMatch(rendered, /CLOUDFLARE_API_TOKEN/);
    assert.doesNotMatch(rendered, /should-not-be-rendered/);
  } finally {
    delete process.env.CLOUDFLARE_API_TOKEN;
  }
});

test("launchd specs limit signer key paths to signer daemon", () => {
  process.env.BURNER_EVM_KEY_PATH = "/keys/evm";
  process.env.BURNER_BTC_KEY_PATH = "/keys/btc";
  try {
    const specs = [
      ...buildExecutorLaunchAgentSpecs({
        rootDir: "/repo",
        nodePath: "/usr/local/bin/node",
        launchAgentsDir: "/Users/test/Library/LaunchAgents",
        logDir: "/repo/logs/launchd",
        homeDir: "/Users/test",
        pathEnv: "/usr/local/bin:/usr/bin:/bin",
      }),
      ...buildLiveAutomationLaunchAgentSpecs({
        rootDir: "/repo",
        nodePath: "/usr/local/bin/node",
        launchAgentsDir: "/Users/test/Library/LaunchAgents",
        logDir: "/repo/logs/launchd",
        homeDir: "/Users/test",
        pathEnv: "/usr/local/bin:/usr/bin:/bin",
      }),
      ...buildDashboardLaunchAgentSpecs({
        rootDir: "/repo",
        nodePath: "/usr/local/bin/node",
        launchAgentsDir: "/Users/test/Library/LaunchAgents",
        logDir: "/repo/logs/launchd",
        homeDir: "/Users/test",
        pathEnv: "/usr/local/bin:/usr/bin:/bin",
      }),
    ];

    const daemon = specs.find((spec) => spec.id === "daemon");
    assert.equal(daemon.environmentVariables.BURNER_EVM_KEY_PATH, "/keys/evm");
    assert.equal(daemon.environmentVariables.BURNER_BTC_KEY_PATH, "/keys/btc");
    for (const spec of specs.filter((item) => item.id !== "daemon")) {
      assert.equal("BURNER_EVM_KEY_PATH" in spec.environmentVariables, false);
      assert.equal("BURNER_BTC_KEY_PATH" in spec.environmentVariables, false);
    }
  } finally {
    delete process.env.BURNER_EVM_KEY_PATH;
    delete process.env.BURNER_BTC_KEY_PATH;
  }
});

test("readLaunchAgentStatus reports forbidden keys retained in stale plist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-launchd-forbidden-"));
  const plistPath = join(dir, "com.bobclaw.dashboard-public-live.plist");
  await writeFile(
    plistPath,
    [
      "<plist>",
      "<dict>",
      "<key>EnvironmentVariables</key>",
      "<dict>",
      "<key>PATH</key>",
      "<string>/usr/bin:/bin</string>",
      "<key>CLOUDFLARE_API_TOKEN</key>",
      "<string>redacted</string>",
      "<key>BURNER_EVM_KEY_PATH</key>",
      "<string>/keys/evm</string>",
      "</dict>",
      "</dict>",
      "</plist>",
      "",
    ].join("\n"),
    "utf8",
  );

  const status = await readLaunchAgentStatus(
    {
      id: "public-live",
      label: "com.bobclaw.dashboard-public-live",
      plistPath,
      environmentVariables: {
        PATH: "/usr/bin:/bin",
      },
      forbiddenEnvironmentKeys: ["CLOUDFLARE_API_TOKEN", "BURNER_EVM_KEY_PATH"],
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

  assert.deepEqual(status.unexpectedForbiddenEnvironmentKeys, ["CLOUDFLARE_API_TOKEN", "BURNER_EVM_KEY_PATH"]);
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

  assert.deepEqual(
    specs.map((spec) => spec.id),
    ["gate-self-heal", "all-chain-autopilot"],
  );
  assert.equal(specs[0].scriptPath, "/repo/src/cli/run-gate-self-heal.mjs");
  assert.ok(specs[0].programArguments.includes("--loop"));
  assert.equal(specs[1].scriptPath, "/repo/src/cli/run-all-chain-autopilot.mjs");
  assert.ok(specs[1].programArguments.includes("--write"));
  assert.ok(specs[1].programArguments.includes("--execute"));
  assert.ok("PATH" in specs[0].environmentVariables);
  assert.ok("HOME" in specs[0].environmentVariables);
});

test("buildResearchLaunchAgentSpecs wires stale-aware research and auto-coder agents", () => {
  const specs = buildResearchLaunchAgentSpecs({
    rootDir: "/repo",
    nodePath: "/usr/local/bin/node",
    launchAgentsDir: "/Users/test/Library/LaunchAgents",
    logDir: "/repo/logs/launchd",
    homeDir: "/Users/test",
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
  });

  assert.equal(specs.length, 2);
  assert.equal(specs[0].id, "daily");
  assert.equal(specs[0].scriptPath, "/repo/src/cli/run-auto-research-refresh.mjs");
  assert.ok(specs[0].programArguments.includes("--stale-hours=20"));
  assert.ok(specs[0].programArguments.includes("--max-experiments=100"));
  assert.equal(specs[0].runAtLoad, false);
  assert.equal(specs[0].keepAlive, false);
  assert.equal(specs[1].id, "auto-coder");
  assert.equal(specs[1].scriptPath, "/repo/src/cli/auto-research-pipeline.mjs");
  assert.ok(specs[1].programArguments.includes("--json"));
  assert.equal(specs[1].runAtLoad, false);
  assert.equal(specs[1].keepAlive, false);
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

test("readLaunchAgentStatus reports environment keys missing from a stale plist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-launchd-env-"));
  const plistPath = join(dir, "com.bobclaw.executor-daemon.plist");
  await writeFile(
    plistPath,
    [
      "<plist>",
      "<dict>",
      "<key>EnvironmentVariables</key>",
      "<dict>",
      "<key>PATH</key>",
      "<string>/usr/bin:/bin</string>",
      "</dict>",
      "</dict>",
      "</plist>",
      "",
    ].join("\n"),
    "utf8",
  );

  const status = await readLaunchAgentStatus(
    {
      id: "daemon",
      label: "com.bobclaw.executor-daemon",
      plistPath,
      environmentVariables: {
        PATH: "/usr/bin:/bin",
        BURNER_EVM_KEY_PATH: "/keys/evm",
        BURNER_BTC_KEY_PATH: "/keys/btc",
      },
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

  assert.equal(status.status, "loaded_running");
  assert.deepEqual(status.missingEnvironmentKeys, ["BURNER_EVM_KEY_PATH", "BURNER_BTC_KEY_PATH"]);
});
