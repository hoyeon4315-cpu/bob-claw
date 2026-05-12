import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectExecutorRuntimeReadiness, maskBitcoinAddress } from "../src/runtime/executor-runtime-readiness.mjs";

test("runtime readiness points to env configuration before launchd or process checks", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-runtime-readiness-missing-"));
  const report = await collectExecutorRuntimeReadiness({
    cwd,
    env: {},
    launchdSpecBuilder: () => [
      { id: "daemon", label: "daemon", plistPath: join(cwd, "daemon.plist") },
      { id: "watchdog", label: "watchdog", plistPath: join(cwd, "watchdog.plist") },
    ],
    launchdStatusReader: async (spec) => ({
      ...spec,
      plistPresent: false,
      loaded: false,
      running: false,
      pid: null,
      state: null,
      lastExitCode: null,
      status: "missing_plist",
      reason: "plist_missing",
      launchctlError: null,
    }),
    runtimeLoader: async () => ({
      available: false,
      runtimeStatus: "missing",
      signerStatus: "missing_socket",
      signerSocketPresent: false,
      watchdog: { status: "missing" },
    }),
  });

  assert.equal(report.summary.ready, false);
  assert.equal(report.summary.nextActionCode, "configure_runtime_env");
  assert.deepEqual(
    [...report.summary.missingEnv].sort(),
    ["BURNER_BTC_KEY_PATH", "BURNER_EVM_KEY_PATH", "KILL_SWITCH_PATH", "PAYBACK_BTC_DEST_ADDR"].sort(),
  );
});

test("runtime readiness reports healthy when env, launchd, and runtime are all ready", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-runtime-readiness-ready-"));
  const evmKeyPath = join(cwd, "evm.key");
  const btcKeyPath = join(cwd, "btc.wif");
  const killSwitchPath = join(cwd, ".killswitch");
  await writeFile(evmKeyPath, "0xabc\n", "utf8");
  await writeFile(btcKeyPath, "L1btcWifExample\n", "utf8");
  await chmod(evmKeyPath, 0o600);
  await chmod(btcKeyPath, 0o400);

  const report = await collectExecutorRuntimeReadiness({
    cwd,
    env: {
      PAYBACK_BTC_DEST_ADDR: "bc1qexample0000000000000000000000000000000",
      BURNER_EVM_KEY_PATH: evmKeyPath,
      BURNER_BTC_KEY_PATH: btcKeyPath,
      KILL_SWITCH_PATH: killSwitchPath,
    },
    launchdSpecBuilder: () => [
      { id: "daemon", label: "daemon", plistPath: join(cwd, "daemon.plist") },
      { id: "watchdog", label: "watchdog", plistPath: join(cwd, "watchdog.plist") },
    ],
    launchdStatusReader: async (spec) => ({
      ...spec,
      plistPresent: true,
      loaded: true,
      running: true,
      pid: 123,
      state: "running",
      lastExitCode: 0,
      status: "loaded_running",
      reason: null,
      launchctlError: null,
    }),
    runtimeLoader: async () => ({
      available: true,
      runtimeStatus: "healthy",
      signerStatus: "listening",
      signerSocketPresent: true,
      watchdog: { status: "healthy" },
    }),
  });

  assert.equal(report.summary.ready, true);
  assert.equal(report.summary.nextActionCode, "ready");
  assert.equal(report.summary.insecureFiles.length, 0);
  assert.equal(report.env.required.evmKeyPath.securePermissions, true);
  assert.equal(report.env.required.btcKeyPath.securePermissions, true);
  assert.equal(maskBitcoinAddress("bc1qexample0000000000000000000000000000000"), "bc1qex…0000");
});

test("runtime readiness blocks when installed launchd plist is missing required key path env", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-runtime-readiness-launchd-env-"));
  const evmKeyPath = join(cwd, "evm.key");
  const btcKeyPath = join(cwd, "btc.wif");
  const killSwitchPath = join(cwd, ".killswitch");
  await writeFile(evmKeyPath, "0xabc\n", "utf8");
  await writeFile(btcKeyPath, "L1btcWifExample\n", "utf8");
  await chmod(evmKeyPath, 0o600);
  await chmod(btcKeyPath, 0o400);

  const report = await collectExecutorRuntimeReadiness({
    cwd,
    env: {
      PAYBACK_BTC_DEST_ADDR: "bc1qexample0000000000000000000000000000000",
      BURNER_EVM_KEY_PATH: evmKeyPath,
      BURNER_BTC_KEY_PATH: btcKeyPath,
      KILL_SWITCH_PATH: killSwitchPath,
    },
    launchdSpecBuilder: () => [
      {
        id: "daemon",
        label: "daemon",
        plistPath: join(cwd, "daemon.plist"),
        environmentVariables: {
          BURNER_EVM_KEY_PATH: evmKeyPath,
          BURNER_BTC_KEY_PATH: btcKeyPath,
          KILL_SWITCH_PATH: killSwitchPath,
        },
      },
    ],
    launchdStatusReader: async (spec) => ({
      ...spec,
      plistPresent: true,
      loaded: true,
      running: true,
      pid: 123,
      state: "running",
      lastExitCode: 0,
      status: "loaded_running",
      reason: null,
      launchctlError: null,
      missingEnvironmentKeys: ["BURNER_EVM_KEY_PATH", "BURNER_BTC_KEY_PATH"],
    }),
    runtimeLoader: async () => ({
      available: true,
      runtimeStatus: "healthy",
      signerStatus: "listening",
      signerSocketPresent: true,
      watchdog: { status: "healthy" },
    }),
  });

  assert.equal(report.summary.ready, false);
  assert.equal(report.summary.launchdEnvReady, false);
  assert.equal(report.summary.nextActionCode, "install_launchd_agents");
  assert.deepEqual(report.summary.launchdMissingEnv, ["daemon:BURNER_EVM_KEY_PATH", "daemon:BURNER_BTC_KEY_PATH"]);
});
