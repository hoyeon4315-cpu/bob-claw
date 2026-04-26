import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { getEnv } from "../config/env.mjs";

const DEFAULT_PATH_ENV = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function launchdSafeEnvironment() {
  const values = {
    BURNER_EVM_KEY_PATH: getEnv("BURNER_EVM_KEY_PATH", getEnv("BURNER_PRIVATE_KEY_PATH", null)),
    BURNER_PRIVATE_KEY_PATH: getEnv("BURNER_PRIVATE_KEY_PATH", getEnv("BURNER_EVM_KEY_PATH", null)),
    BURNER_BTC_KEY_PATH: getEnv("BURNER_BTC_KEY_PATH", null),
    KILL_SWITCH_PATH: getEnv("KILL_SWITCH_PATH", null),
    CLOUDFLARE_API_TOKEN: getEnv("CLOUDFLARE_API_TOKEN", null),
    CLOUDFLARE_ACCOUNT_ID: getEnv("CLOUDFLARE_ACCOUNT_ID", null),
    BOB_CLAW_CF_PAGES_PROJECT: getEnv("BOB_CLAW_CF_PAGES_PROJECT", null),
    BOB_CLAW_CF_PRODUCTION_BRANCH: getEnv("BOB_CLAW_CF_PRODUCTION_BRANCH", null),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}

function researchLaunchdSafeEnvironment() {
  const values = {
    DEV_LOCK_PATH: getEnv("DEV_LOCK_PATH", null),
    RESEARCH_AGENT_CMD: getEnv("RESEARCH_AGENT_CMD", null),
    RESEARCH_AGENT_ARGS: getEnv("RESEARCH_AGENT_ARGS", null),
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("RESEARCH_ARCHIVE_RPC_")) continue;
    if (value) values[key] = value;
  }
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}

function strategyAutomationLaunchdSafeEnvironment() {
  const values = {
    ...launchdSafeEnvironment(),
    ...researchLaunchdSafeEnvironment(),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}

export const EXECUTOR_LAUNCHD_LABELS = Object.freeze({
  daemon: "com.bobclaw.executor-daemon",
  watchdog: "com.bobclaw.executor-watchdog",
});

export const LIVE_AUTOMATION_LAUNCHD_LABELS = Object.freeze({
  gateSelfHeal: "com.bobclaw.gate-self-heal",
  allChainAutopilot: "com.bobclaw.all-chain-autopilot",
});

export const DASHBOARD_LAUNCHD_LABELS = Object.freeze({
  publicLive: "com.bobclaw.dashboard-public-live",
});

export const RESEARCH_LAUNCHD_LABELS = Object.freeze({
  daily: "com.bobclaw.research-daily",
});

export const STRATEGY_AUTOMATION_LAUNCHD_LABELS = Object.freeze({
  evidenceRefresh: "com.bobclaw.strategy-evidence-refresh",
});

export function defaultLaunchAgentsDir(homeDir = process.env.HOME || homedir()) {
  return join(homeDir, "Library", "LaunchAgents");
}

export function defaultLaunchdLogDir(rootDir = process.cwd()) {
  return resolve(rootDir, "logs", "launchd");
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderPlistValue(value, indent = "  ") {
  if (typeof value === "string") return `${indent}<string>${xmlEscape(value)}</string>`;
  if (typeof value === "number") return `${indent}<integer>${value}</integer>`;
  if (typeof value === "boolean") return `${indent}<${value ? "true" : "false"}/>`;
  if (Array.isArray(value)) {
    const lines = value.map((item) => renderPlistValue(item, `${indent}  `));
    return [`${indent}<array>`, ...lines, `${indent}</array>`].join("\n");
  }
  if (value && typeof value === "object") {
    const lines = [];
    for (const [key, entry] of Object.entries(value)) {
      lines.push(`${indent}  <key>${xmlEscape(key)}</key>`);
      lines.push(renderPlistValue(entry, `${indent}  `));
    }
    return [`${indent}<dict>`, ...lines, `${indent}</dict>`].join("\n");
  }
  return `${indent}<string></string>`;
}

export function buildExecutorLaunchAgentSpecs({
  rootDir = process.cwd(),
  nodePath = process.execPath,
  launchAgentsDir = defaultLaunchAgentsDir(),
  logDir = defaultLaunchdLogDir(rootDir),
  pathEnv = process.env.PATH || DEFAULT_PATH_ENV,
  homeDir = process.env.HOME || homedir(),
} = {}) {
  const resolvedRootDir = resolve(rootDir);
  const resolvedNodePath = resolve(nodePath);
  const resolvedLaunchAgentsDir = resolve(launchAgentsDir);
  const resolvedLogDir = resolve(logDir);
  const sharedEnvironment = {
    PATH: pathEnv,
    HOME: homeDir,
    ...launchdSafeEnvironment(),
  };
  return [
    {
      id: "daemon",
      label: EXECUTOR_LAUNCHD_LABELS.daemon,
      description: "BOB Claw executor signer daemon",
      scriptPath: resolve(resolvedRootDir, "src/executor/signer/daemon.mjs"),
      plistPath: join(resolvedLaunchAgentsDir, `${EXECUTOR_LAUNCHD_LABELS.daemon}.plist`),
      stdoutPath: join(resolvedLogDir, "executor-daemon.out.log"),
      stderrPath: join(resolvedLogDir, "executor-daemon.err.log"),
      workingDirectory: resolvedRootDir,
      programArguments: [resolvedNodePath, resolve(resolvedRootDir, "src/executor/signer/daemon.mjs")],
      environmentVariables: sharedEnvironment,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 10,
      processType: "Background",
    },
    {
      id: "watchdog",
      label: EXECUTOR_LAUNCHD_LABELS.watchdog,
      description: "BOB Claw executor watchdog",
      scriptPath: resolve(resolvedRootDir, "src/cli/run-executor-watchdog.mjs"),
      plistPath: join(resolvedLaunchAgentsDir, `${EXECUTOR_LAUNCHD_LABELS.watchdog}.plist`),
      stdoutPath: join(resolvedLogDir, "executor-watchdog.out.log"),
      stderrPath: join(resolvedLogDir, "executor-watchdog.err.log"),
      workingDirectory: resolvedRootDir,
      programArguments: [resolvedNodePath, resolve(resolvedRootDir, "src/cli/run-executor-watchdog.mjs")],
      environmentVariables: sharedEnvironment,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 10,
      processType: "Background",
    },
  ];
}

export function buildLiveAutomationLaunchAgentSpecs({
  rootDir = process.cwd(),
  nodePath = process.execPath,
  launchAgentsDir = defaultLaunchAgentsDir(),
  logDir = defaultLaunchdLogDir(rootDir),
  pathEnv = process.env.PATH || DEFAULT_PATH_ENV,
  homeDir = process.env.HOME || homedir(),
} = {}) {
  const resolvedRootDir = resolve(rootDir);
  const resolvedNodePath = resolve(nodePath);
  const resolvedLaunchAgentsDir = resolve(launchAgentsDir);
  const resolvedLogDir = resolve(logDir);
  const sharedEnvironment = {
    PATH: pathEnv,
    HOME: homeDir,
    ...launchdSafeEnvironment(),
  };
  return [
    {
      id: "gate-self-heal",
      label: LIVE_AUTOMATION_LAUNCHD_LABELS.gateSelfHeal,
      description: "BOB Claw gate self-heal loop (clears benign dashboard blockers)",
      scriptPath: resolve(resolvedRootDir, "src/cli/run-gate-self-heal.mjs"),
      plistPath: join(resolvedLaunchAgentsDir, `${LIVE_AUTOMATION_LAUNCHD_LABELS.gateSelfHeal}.plist`),
      stdoutPath: join(resolvedLogDir, "gate-self-heal.out.log"),
      stderrPath: join(resolvedLogDir, "gate-self-heal.err.log"),
      workingDirectory: resolvedRootDir,
      programArguments: [
        resolvedNodePath,
        resolve(resolvedRootDir, "src/cli/run-gate-self-heal.mjs"),
        "--loop",
        "--intervalMs=1800000",
      ],
      environmentVariables: sharedEnvironment,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 30,
      processType: "Background",
    },
    {
      id: "all-chain-autopilot",
      label: LIVE_AUTOMATION_LAUNCHD_LABELS.allChainAutopilot,
      description: "BOB Claw multichain autopilot loop",
      scriptPath: resolve(resolvedRootDir, "src/cli/run-all-chain-autopilot.mjs"),
      plistPath: join(resolvedLaunchAgentsDir, `${LIVE_AUTOMATION_LAUNCHD_LABELS.allChainAutopilot}.plist`),
      stdoutPath: join(resolvedLogDir, "all-chain-autopilot.out.log"),
      stderrPath: join(resolvedLogDir, "all-chain-autopilot.err.log"),
      workingDirectory: resolvedRootDir,
      programArguments: [
        resolvedNodePath,
        resolve(resolvedRootDir, "src/cli/run-all-chain-autopilot.mjs"),
        "--loop",
        "--write",
        "--execute",
      ],
      environmentVariables: sharedEnvironment,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 30,
      processType: "Background",
    },
  ];
}

export function buildDashboardLaunchAgentSpecs({
  rootDir = process.cwd(),
  nodePath = process.execPath,
  launchAgentsDir = defaultLaunchAgentsDir(),
  logDir = defaultLaunchdLogDir(rootDir),
  pathEnv = process.env.PATH || DEFAULT_PATH_ENV,
  homeDir = process.env.HOME || homedir(),
} = {}) {
  const resolvedRootDir = resolve(rootDir);
  const resolvedNodePath = resolve(nodePath);
  const resolvedLaunchAgentsDir = resolve(launchAgentsDir);
  const resolvedLogDir = resolve(logDir);
  const sharedEnvironment = {
    PATH: pathEnv,
    HOME: homeDir,
    ...launchdSafeEnvironment(),
  };
  return [
    {
      id: "public-live",
      label: DASHBOARD_LAUNCHD_LABELS.publicLive,
      description: "BOB Claw public live dashboard runtime",
      scriptPath: resolve(resolvedRootDir, "src/cli/run-dashboard-public-live.mjs"),
      plistPath: join(resolvedLaunchAgentsDir, `${DASHBOARD_LAUNCHD_LABELS.publicLive}.plist`),
      stdoutPath: join(resolvedLogDir, "dashboard-public-live.out.log"),
      stderrPath: join(resolvedLogDir, "dashboard-public-live.err.log"),
      workingDirectory: resolvedRootDir,
      programArguments: [resolvedNodePath, resolve(resolvedRootDir, "src/cli/run-dashboard-public-live.mjs")],
      environmentVariables: sharedEnvironment,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 10,
      processType: "Background",
    },
  ];
}

export function buildResearchLaunchAgentSpecs({
  rootDir = process.cwd(),
  nodePath = process.execPath,
  launchAgentsDir = defaultLaunchAgentsDir(),
  logDir = defaultLaunchdLogDir(rootDir),
  pathEnv = process.env.PATH || DEFAULT_PATH_ENV,
  homeDir = process.env.HOME || homedir(),
} = {}) {
  const resolvedRootDir = resolve(rootDir);
  const resolvedNodePath = resolve(nodePath);
  const resolvedLaunchAgentsDir = resolve(launchAgentsDir);
  const resolvedLogDir = resolve(logDir);
  const sharedEnvironment = {
    PATH: pathEnv,
    HOME: homeDir,
    ...researchLaunchdSafeEnvironment(),
  };
  return [
    {
      id: "daily",
      label: RESEARCH_LAUNCHD_LABELS.daily,
      description: "BOB Claw auto research refresh sidecar",
      scriptPath: resolve(resolvedRootDir, "src", "cli", "run-auto-research-refresh.mjs"),
      plistPath: join(resolvedLaunchAgentsDir, `${RESEARCH_LAUNCHD_LABELS.daily}.plist`),
      stdoutPath: join(resolvedLogDir, "research-daily.out.log"),
      stderrPath: join(resolvedLogDir, "research-daily.err.log"),
      workingDirectory: resolvedRootDir,
      programArguments: [
        resolvedNodePath,
        resolve(resolvedRootDir, "src", "cli", "run-auto-research-refresh.mjs"),
        "--continue-on-failure",
        "--stale-hours=20",
        "--max-experiments=100",
      ],
      environmentVariables: sharedEnvironment,
      runAtLoad: false,
      keepAlive: false,
      startInterval: 86_400,
      throttleInterval: 10,
      processType: "Background",
    },
  ];
}

export function buildStrategyAutomationLaunchAgentSpecs({
  rootDir = process.cwd(),
  nodePath = process.execPath,
  launchAgentsDir = defaultLaunchAgentsDir(),
  logDir = defaultLaunchdLogDir(rootDir),
  pathEnv = process.env.PATH || DEFAULT_PATH_ENV,
  homeDir = process.env.HOME || homedir(),
} = {}) {
  const resolvedRootDir = resolve(rootDir);
  const resolvedNodePath = resolve(nodePath);
  const resolvedLaunchAgentsDir = resolve(launchAgentsDir);
  const resolvedLogDir = resolve(logDir);
  const sharedEnvironment = {
    PATH: pathEnv,
    HOME: homeDir,
    ...strategyAutomationLaunchdSafeEnvironment(),
  };
  return [
    {
      id: "strategy-evidence-refresh",
      label: STRATEGY_AUTOMATION_LAUNCHD_LABELS.evidenceRefresh,
      description: "BOB Claw strategy evidence refresh loop",
      scriptPath: resolve(resolvedRootDir, "src/cli/run-strategy-evidence-refresh.mjs"),
      plistPath: join(resolvedLaunchAgentsDir, `${STRATEGY_AUTOMATION_LAUNCHD_LABELS.evidenceRefresh}.plist`),
      stdoutPath: join(resolvedLogDir, "strategy-evidence-refresh.out.log"),
      stderrPath: join(resolvedLogDir, "strategy-evidence-refresh.err.log"),
      workingDirectory: resolvedRootDir,
      programArguments: [
        resolvedNodePath,
        resolve(resolvedRootDir, "src/cli/run-strategy-evidence-refresh.mjs"),
        "--loop",
        "--continue-on-failure",
        "--intervalMs=1800000",
      ],
      environmentVariables: sharedEnvironment,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 30,
      processType: "Background",
    },
  ];
}

export function renderLaunchAgentPlist(spec) {
  const payload = {
    Label: spec.label,
    WorkingDirectory: spec.workingDirectory,
    ProgramArguments: spec.programArguments,
    EnvironmentVariables: spec.environmentVariables,
    RunAtLoad: spec.runAtLoad,
    KeepAlive: spec.keepAlive,
    ...(Number.isInteger(spec.startInterval) ? { StartInterval: spec.startInterval } : {}),
    ThrottleInterval: spec.throttleInterval,
    ProcessType: spec.processType,
    StandardOutPath: spec.stdoutPath,
    StandardErrorPath: spec.stderrPath,
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    ...Object.entries(payload).flatMap(([key, value]) => [
      `  <key>${xmlEscape(key)}</key>`,
      renderPlistValue(value, "  "),
    ]),
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export async function writeExecutorLaunchAgents(options = {}) {
  const specs = buildExecutorLaunchAgentSpecs(options);
  const writes = await Promise.all(
    specs.map(async (spec) => ({
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      stdoutPath: spec.stdoutPath,
      stderrPath: spec.stderrPath,
      ...(await writeTextIfChanged(spec.plistPath, renderLaunchAgentPlist(spec))),
    })),
  );
  return {
    specs,
    writes,
  };
}

export async function writeLiveAutomationLaunchAgents(options = {}) {
  const specs = buildLiveAutomationLaunchAgentSpecs(options);
  const writes = await Promise.all(
    specs.map(async (spec) => ({
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      stdoutPath: spec.stdoutPath,
      stderrPath: spec.stderrPath,
      ...(await writeTextIfChanged(spec.plistPath, renderLaunchAgentPlist(spec))),
    })),
  );
  return {
    specs,
    writes,
  };
}

export async function writeDashboardLaunchAgents(options = {}) {
  const specs = buildDashboardLaunchAgentSpecs(options);
  const writes = await Promise.all(
    specs.map(async (spec) => ({
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      stdoutPath: spec.stdoutPath,
      stderrPath: spec.stderrPath,
      ...(await writeTextIfChanged(spec.plistPath, renderLaunchAgentPlist(spec))),
    })),
  );
  return {
    specs,
    writes,
  };
}

export async function writeResearchLaunchAgents(options = {}) {
  const specs = buildResearchLaunchAgentSpecs(options);
  const writes = await Promise.all(
    specs.map(async (spec) => ({
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      stdoutPath: spec.stdoutPath,
      stderrPath: spec.stderrPath,
      ...(await writeTextIfChanged(spec.plistPath, renderLaunchAgentPlist(spec))),
    })),
  );
  return {
    specs,
    writes,
  };
}

export async function writeStrategyAutomationLaunchAgents(options = {}) {
  const specs = buildStrategyAutomationLaunchAgentSpecs(options);
  const writes = await Promise.all(
    specs.map(async (spec) => ({
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      stdoutPath: spec.stdoutPath,
      stderrPath: spec.stderrPath,
      ...(await writeTextIfChanged(spec.plistPath, renderLaunchAgentPlist(spec))),
    })),
  );
  return {
    specs,
    writes,
  };
}

async function fileExists(path, accessImpl = access) {
  try {
    await accessImpl(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function defaultLaunchctlRunner(args) {
  const result = spawnSync("launchctl", args, {
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
  };
}

export function parseLaunchctlPrint(output = "") {
  const pidMatch = output.match(/\bpid = (\d+)/u);
  const stateMatch = output.match(/\bstate = ([^\n]+)/u);
  const lastExitCodeMatch = output.match(/\blast exit code = (\d+)/u);
  return {
    pid: pidMatch ? Number(pidMatch[1]) : null,
    state: stateMatch ? stateMatch[1].trim() : null,
    lastExitCode: lastExitCodeMatch ? Number(lastExitCodeMatch[1]) : null,
  };
}

export async function readLaunchAgentStatus(
  spec,
  {
    uid = typeof process.getuid === "function" ? process.getuid() : null,
    launchctlRunner = defaultLaunchctlRunner,
    fileExistsImpl = fileExists,
  } = {},
) {
  const plistPresent = await fileExistsImpl(spec.plistPath);
  if (!Number.isInteger(uid)) {
    return {
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      plistPresent,
      loaded: false,
      running: false,
      pid: null,
      state: null,
      lastExitCode: null,
      status: plistPresent ? "configured_not_loaded" : "missing_plist",
      reason: "uid_unavailable",
      launchctlError: null,
    };
  }

  const result = launchctlRunner(["print", `gui/${uid}/${spec.label}`]);
  if (result.error) {
    return {
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      plistPresent,
      loaded: false,
      running: false,
      pid: null,
      state: null,
      lastExitCode: null,
      status: plistPresent ? "configured_not_loaded" : "missing_plist",
      reason: "launchctl_unavailable",
      launchctlError: result.error.message,
    };
  }

  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.status !== 0) {
    return {
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      plistPresent,
      loaded: false,
      running: false,
      pid: null,
      state: null,
      lastExitCode: null,
      status: plistPresent ? "configured_not_loaded" : "missing_plist",
      reason: plistPresent ? "service_not_loaded" : "plist_missing",
      launchctlError: combinedOutput || null,
    };
  }

  const parsed = parseLaunchctlPrint(result.stdout);
  const running = Number.isInteger(parsed.pid) || parsed.state === "running";
  return {
    id: spec.id,
    label: spec.label,
    plistPath: spec.plistPath,
    plistPresent,
    loaded: true,
    running,
    pid: parsed.pid,
    state: parsed.state,
    lastExitCode: parsed.lastExitCode,
    status: running ? "loaded_running" : "loaded_waiting",
    reason: null,
    launchctlError: null,
  };
}
