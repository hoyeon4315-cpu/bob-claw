import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { DEFAULT_SIGNER_SOCKET_PATH } from "../executor/signer/client.mjs";
import { loadExecutorRuntime } from "../status/executor-runtime.mjs";
import { buildExecutorLaunchAgentSpecs, readLaunchAgentStatus } from "./launchd.mjs";

const DEFAULT_HEARTBEAT_PATH = "./state/executor-heartbeat.json";
const DEFAULT_WATCHDOG_TTL_MS = 60_000;

function envValue(env, name, fallback = undefined) {
  const value = env?.[name];
  return value === undefined || value === "" ? fallback : value;
}

async function pathExists(path, accessImpl = access) {
  try {
    await accessImpl(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function statOrNull(path, statImpl = stat) {
  try {
    return await statImpl(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function formatDisplayPath(path, { homeDir = process.env.HOME || homedir() } = {}) {
  if (!path) return null;
  const resolved = resolve(path);
  return homeDir && resolved.startsWith(homeDir) ? `~${resolved.slice(homeDir.length)}` : resolved;
}

export function formatFileMode(mode) {
  if (!Number.isInteger(mode)) return null;
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

export function hasOwnerOnlyPermissions(mode) {
  if (!Number.isInteger(mode)) return null;
  return (mode & 0o077) === 0;
}

export function maskBitcoinAddress(address) {
  if (!address) return null;
  const normalized = String(address).trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

async function inspectSecretFile(name, value, { statImpl = stat } = {}) {
  if (!value) {
    return {
      name,
      present: false,
      path: null,
      pathDisplay: null,
      fileExists: false,
      mode: null,
      securePermissions: null,
    };
  }
  const resolvedPath = resolve(value);
  const fileStat = await statOrNull(resolvedPath, statImpl);
  return {
    name,
    present: true,
    path: resolvedPath,
    pathDisplay: formatDisplayPath(resolvedPath),
    fileExists: Boolean(fileStat),
    mode: formatFileMode(fileStat?.mode),
    securePermissions: fileStat ? hasOwnerOnlyPermissions(fileStat.mode) : null,
  };
}

async function inspectKillSwitch(name, value, { accessImpl = access } = {}) {
  if (!value) {
    return {
      name,
      present: false,
      path: null,
      pathDisplay: null,
      parentDir: null,
      parentDirPresent: false,
      filePresent: false,
    };
  }
  const resolvedPath = resolve(value);
  const parentDir = dirname(resolvedPath);
  return {
    name,
    present: true,
    path: resolvedPath,
    pathDisplay: formatDisplayPath(resolvedPath),
    parentDir,
    parentDirDisplay: formatDisplayPath(parentDir),
    parentDirPresent: await pathExists(parentDir, accessImpl),
    filePresent: await pathExists(resolvedPath, accessImpl),
  };
}

export async function inspectExecutorRuntimeEnv({
  cwd = process.cwd(),
  env = process.env,
  accessImpl = access,
  statImpl = stat,
} = {}) {
  const resolvedCwd = resolve(cwd);
  const envFilePath = resolve(resolvedCwd, ".env");
  const heartbeatPath = envValue(env, "EXECUTOR_HEARTBEAT_PATH", DEFAULT_HEARTBEAT_PATH);
  const signerSocketPath = envValue(env, "EXECUTOR_SIGNER_SOCKET_PATH", DEFAULT_SIGNER_SOCKET_PATH);
  const paybackDestination = envValue(env, "PAYBACK_BTC_DEST_ADDR", null);
  const evmKeyPath = envValue(env, "BURNER_EVM_KEY_PATH", envValue(env, "BURNER_PRIVATE_KEY_PATH", null));
  const btcKeyPath = envValue(env, "BURNER_BTC_KEY_PATH", null);
  const killSwitchPath = envValue(env, "KILL_SWITCH_PATH", null);
  return {
    envFile: {
      path: envFilePath,
      pathDisplay: formatDisplayPath(envFilePath),
      present: await pathExists(envFilePath, accessImpl),
    },
    required: {
      paybackDestination: {
        name: "PAYBACK_BTC_DEST_ADDR",
        present: Boolean(paybackDestination),
        maskedValue: maskBitcoinAddress(paybackDestination),
      },
      evmKeyPath: await inspectSecretFile("BURNER_EVM_KEY_PATH", evmKeyPath, { statImpl }),
      btcKeyPath: await inspectSecretFile("BURNER_BTC_KEY_PATH", btcKeyPath, { statImpl }),
      killSwitchPath: await inspectKillSwitch("KILL_SWITCH_PATH", killSwitchPath, { accessImpl }),
    },
    derived: {
      heartbeatPath: {
        name: "EXECUTOR_HEARTBEAT_PATH",
        path: resolve(resolvedCwd, heartbeatPath),
        pathDisplay: formatDisplayPath(resolve(resolvedCwd, heartbeatPath)),
      },
      signerSocketPath: {
        name: "EXECUTOR_SIGNER_SOCKET_PATH",
        path: resolve(resolvedCwd, signerSocketPath),
        pathDisplay: formatDisplayPath(resolve(resolvedCwd, signerSocketPath)),
      },
      watchdogTtlMs: Number(envValue(env, "EXECUTOR_WATCHDOG_TTL_MS", DEFAULT_WATCHDOG_TTL_MS)),
    },
  };
}

export function summarizeExecutorRuntimeReadiness({
  envStatus,
  launchdStatuses,
  runtime,
} = {}) {
  const missingEnv = [];
  const insecureFiles = [];
  if (!envStatus?.required?.paybackDestination?.present) {
    missingEnv.push(envStatus.required.paybackDestination.name);
  }
  if (!envStatus?.required?.evmKeyPath?.present || !envStatus.required.evmKeyPath.fileExists) {
    missingEnv.push(envStatus?.required?.evmKeyPath?.name || "BURNER_EVM_KEY_PATH");
  } else if (envStatus.required.evmKeyPath.securePermissions === false) {
    insecureFiles.push(envStatus.required.evmKeyPath.name);
  }
  if (!envStatus?.required?.btcKeyPath?.present || !envStatus.required.btcKeyPath.fileExists) {
    missingEnv.push(envStatus?.required?.btcKeyPath?.name || "BURNER_BTC_KEY_PATH");
  } else if (envStatus.required.btcKeyPath.securePermissions === false) {
    insecureFiles.push(envStatus.required.btcKeyPath.name);
  }
  if (!envStatus?.required?.killSwitchPath?.present || !envStatus.required.killSwitchPath.parentDirPresent) {
    missingEnv.push(envStatus?.required?.killSwitchPath?.name || "KILL_SWITCH_PATH");
  }

  const envReady = missingEnv.length === 0 && insecureFiles.length === 0;
  const launchdConfigured = launchdStatuses.every((status) => status.plistPresent);
  const launchdLoaded = launchdStatuses.every((status) => status.loaded);
  const runtimeHealthy = runtime?.available === true && runtime?.runtimeStatus === "healthy";

  let nextActionCode = "ready";
  let nextActionCommand = null;
  if (!envReady) {
    nextActionCode = "configure_runtime_env";
  } else if (!launchdConfigured) {
    nextActionCode = "write_launchd_agents";
    nextActionCommand = "npm run ops:launchd:write";
  } else if (!launchdLoaded) {
    nextActionCode = "install_launchd_agents";
    nextActionCommand = "npm run ops:launchd:install";
  } else if (!runtimeHealthy) {
    nextActionCode = "restart_executor_runtime";
    nextActionCommand = "npm run ops:runtime-readiness -- --strict";
  }

  return {
    ready: envReady && launchdConfigured && launchdLoaded && runtimeHealthy,
    envReady,
    launchdConfigured,
    launchdLoaded,
    runtimeHealthy,
    missingEnv,
    insecureFiles,
    nextActionCode,
    nextActionCommand,
    policyNote: "liveTrading=ALLOWED only means the policy gate passed. daemon/watchdog runtime is a separate check.",
  };
}

export async function collectExecutorRuntimeReadiness({
  cwd = process.cwd(),
  env = process.env,
  now = new Date().toISOString(),
  accessImpl = access,
  statImpl = stat,
  runtimeLoader = loadExecutorRuntime,
  launchdSpecBuilder = buildExecutorLaunchAgentSpecs,
  launchdStatusReader = readLaunchAgentStatus,
} = {}) {
  const envStatus = await inspectExecutorRuntimeEnv({
    cwd,
    env,
    accessImpl,
    statImpl,
  });
  const launchdSpecs = launchdSpecBuilder({ rootDir: cwd });
  const launchdStatuses = await Promise.all(
    launchdSpecs.map((spec) => launchdStatusReader(spec)),
  );
  const runtime = await runtimeLoader({
    now,
    heartbeatPath: envStatus.derived.heartbeatPath.path,
    signerSocketPath: envStatus.derived.signerSocketPath.path,
    ttlMs: envStatus.derived.watchdogTtlMs,
  });
  return {
    schemaVersion: 1,
    checkedAt: now,
    repoRoot: resolve(cwd),
    env: envStatus,
    launchd: launchdStatuses,
    runtime,
    summary: summarizeExecutorRuntimeReadiness({
      envStatus,
      launchdStatuses,
      runtime,
    }),
  };
}
