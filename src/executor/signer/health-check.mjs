import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { MempoolClient } from "../../bitcoin/fees.mjs";
import { getBitcoinChainConfig, getEvmChainConfig, listEvmChains } from "../../config/chains.mjs";
import { rpc } from "../../evm/json-rpc.mjs";
import {
  DEFAULT_HEARTBEAT_RELATIVE_PATH,
  resolveDefaultHeartbeatPath,
  resolveDefaultSignerSocketPath,
} from "../runtime-paths.mjs";
import { evaluateWatchdogHeartbeat, readHeartbeat } from "../watchdog/heartbeat.mjs";
import { readSignerAuditLog } from "./audit-log.mjs";
import { DEFAULT_SIGNER_SOCKET_PATH, readSignerHealth } from "./client.mjs";

const execFile = promisify(execFileCallback);

export const DEFAULT_HEARTBEAT_PATH = DEFAULT_HEARTBEAT_RELATIVE_PATH;
export const DEFAULT_HEARTBEAT_TTL_MS = 60_000;
export const DEFAULT_RPC_TIMEOUT_MS = 3_500;
export const DEFAULT_BTC_RPC_BASE_URL = "https://mempool.space/api";

const PROCESS_CHECKS = Object.freeze({
  daemon: Object.freeze(["executor:daemon", "src/executor/signer/daemon.mjs"]),
  watchdog: Object.freeze(["executor:watchdog", "src/cli/run-executor-watchdog.mjs"]),
});

function envValue(env, name, fallback = undefined) {
  const value = env?.[name];
  return value === undefined || value === "" ? fallback : value;
}

function resolvePathFromCwd(path, cwd) {
  if (!path) return null;
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function errorPayload(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
  };
}

function parsePgrepOutput(stdout) {
  return String(stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, ...commandParts] = line.split(/\s+/u);
      return {
        pid: Number(pid),
        command: commandParts.join(" "),
      };
    })
    .filter((item) => Number.isInteger(item.pid) && item.command);
}

function parsePsOutput(stdout) {
  return String(stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/u);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        command: match[2],
      };
    })
    .filter((item) => item && Number.isInteger(item.pid) && item.command);
}

async function pgrep(pattern, { execFileImpl = execFile } = {}) {
  try {
    const result = await execFileImpl("pgrep", ["-fl", pattern]);
    return parsePgrepOutput(result.stdout);
  } catch (error) {
    if (error?.code === 1) return [];
    throw error;
  }
}

async function processListFromPs({ execFileImpl = execFile } = {}) {
  const result = await execFileImpl("ps", ["-axo", "pid=,command="]);
  return parsePsOutput(result.stdout);
}

function matchesAny(command, patterns) {
  return patterns.some((pattern) => command.includes(pattern));
}

export async function checkSignerProcesses({ execFileImpl = execFile } = {}) {
  let daemonMatches = [];
  let watchdogMatches = [];
  let method = "pgrep";
  try {
    for (const pattern of PROCESS_CHECKS.daemon) {
      daemonMatches.push(...(await pgrep(pattern, { execFileImpl })));
    }
    for (const pattern of PROCESS_CHECKS.watchdog) {
      watchdogMatches.push(...(await pgrep(pattern, { execFileImpl })));
    }
  } catch (error) {
    method = "pgrep+ps";
    try {
      const rows = await processListFromPs({ execFileImpl });
      daemonMatches = rows.filter((item) => matchesAny(item.command, PROCESS_CHECKS.daemon));
      watchdogMatches = rows.filter((item) => matchesAny(item.command, PROCESS_CHECKS.watchdog));
    } catch (fallbackError) {
      return {
        method,
        unavailable: true,
        daemonRunning: null,
        watchdogRunning: null,
        matches: [],
        error: errorPayload(fallbackError),
      };
    }
  }
  return {
    method,
    daemonRunning: daemonMatches.length > 0,
    watchdogRunning: watchdogMatches.length > 0,
    matches: [
      ...daemonMatches.map((item) => ({ role: "daemon", ...item })),
      ...watchdogMatches.map((item) => ({ role: "watchdog", ...item })),
    ],
  };
}

export async function pingEvmChain(chain, { timeoutMs = DEFAULT_RPC_TIMEOUT_MS, rpcImpl = rpc } = {}) {
  const config = getEvmChainConfig(chain);
  if (!config) {
    return {
      chain,
      ok: false,
      error: { name: "UnsupportedChain", message: `Unsupported EVM chain: ${chain}` },
    };
  }
  const startedAt = Date.now();
  let lastError = null;
  for (const url of config.rpcUrls || [config.rpcUrl].filter(Boolean)) {
    try {
      const chainIdHex = await rpcImpl(url, "eth_chainId", [], { timeoutMs });
      const chainId = Number.parseInt(String(chainIdHex), 16);
      if (chainId !== config.chainId) {
        return {
          chain,
          ok: false,
          url,
          chainId: chainIdHex,
          expectedChainId: config.chainId,
          latencyMs: Date.now() - startedAt,
          error: {
            name: "ChainIdMismatch",
            message: `expected ${config.chainId}, got ${chainIdHex}`,
          },
        };
      }
      return {
        chain,
        ok: true,
        url,
        chainId: chainIdHex,
        expectedChainId: config.chainId,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    chain,
    ok: false,
    expectedChainId: config.chainId,
    latencyMs: Date.now() - startedAt,
    error: errorPayload(lastError),
  };
}

export async function pingAllEvmChains(options = {}) {
  const chains = await Promise.all(listEvmChains().map((chain) => pingEvmChain(chain, options)));
  return { chains };
}

export async function pingBitcoinRpc({ baseUrl = DEFAULT_BTC_RPC_BASE_URL, client = null } = {}) {
  const bitcoinConfig = getBitcoinChainConfig("bitcoin");
  const startedAt = Date.now();
  const mempoolClient = client || new MempoolClient({ baseUrl });
  try {
    const result = await mempoolClient.getRecommendedFees();
    return {
      chain: bitcoinConfig?.chain || "bitcoin",
      ok: true,
      source: baseUrl,
      status: result.status,
      latencyMs: result.latencyMs ?? Date.now() - startedAt,
    };
  } catch (error) {
    return {
      chain: bitcoinConfig?.chain || "bitcoin",
      ok: false,
      source: baseUrl,
      latencyMs: Date.now() - startedAt,
      error: errorPayload(error),
    };
  }
}

function summarizeHeartbeat({ heartbeat, path, now, ttlMs }) {
  const state = evaluateWatchdogHeartbeat({ heartbeat, now, ttlMs });
  return {
    path,
    present: Boolean(heartbeat),
    updatedAt: heartbeat?.updatedAt || null,
    pid: heartbeat?.pid ?? null,
    socketPath: heartbeat?.socketPath || null,
    status: state.status,
    stale: state.stale === true,
    ageMs: state.ageMs,
    ttlMs: state.ttlMs,
    lastCommand: heartbeat?.lastCommand || null,
  };
}

function summarizeSocketResult(result) {
  const nonceManagers = result?.nonceManagers || {
    ok: true,
    status: "not_reported_by_running_daemon",
    chains: [],
  };
  return {
    ok: result?.status === "ok",
    status: result?.status || "error",
    pid: result?.pid ?? null,
    socketPath: result?.socketPath || null,
    addresses: result?.addresses || null,
    addressTypes: result?.addressTypes || null,
    nonceManagers,
  };
}

async function summarizeSignerAudit({ rootDir }) {
  const records = await readSignerAuditLog({ rootDir });
  const last = records.at(-1) || null;
  return {
    path: "logs/signer-audit.jsonl",
    count: records.length,
    lastTimestamp: last?.timestamp || null,
    lastStage: last?.lifecycle?.stage || null,
    lastPolicyVerdict: last?.policyVerdict || null,
    lastStrategyId: last?.strategyId || null,
    lastChain: last?.chain || null,
  };
}

export function classifySignerHealth(report = {}) {
  if (report.process?.daemonRunning === false) return "process_down";
  if (report.heartbeat?.stale === true) return "heartbeat_stale";
  if (report.socket?.ok !== true) return "socket_unreachable";
  const failedRpc = (report.rpc?.chains || []).find((item) => item.ok !== true);
  if (failedRpc?.chain) return `rpc_unreachable_${failedRpc.chain}`;
  if (report.btcRpc?.ok !== true) return "btc_rpc_unreachable";
  if (report.nonceManagers?.ok === false) return "nonce_manager_error";
  return "clean";
}

export function buildSignerHealthReadiness(report = {}) {
  const hardCause = classifySignerHealth(report);
  const limitations = [];
  if (report.process?.unavailable === true) {
    limitations.push("process_check_unavailable");
  }
  if (report.nonceManagers?.status === "not_reported_by_running_daemon") {
    limitations.push("nonce_manager_state_not_reported_by_running_daemon");
  }
  return {
    schemaVersion: 1,
    hardCause,
    clean: hardCause === "clean",
    telemetryComplete: limitations.length === 0,
    readyForBroadcast: hardCause === "clean" && limitations.length === 0,
    limitations,
    authority: "diagnostic_preflight_policy_engine_still_authoritative",
  };
}

export async function diagnoseSignerHealth({
  cwd = process.cwd(),
  env = process.env,
  now = new Date().toISOString(),
  heartbeatTtlMs = Number(envValue(env, "EXECUTOR_WATCHDOG_TTL_MS", DEFAULT_HEARTBEAT_TTL_MS)),
  heartbeatPath = envValue(env, "EXECUTOR_HEARTBEAT_PATH", resolveDefaultHeartbeatPath({ cwd })),
  socketPath = envValue(env, "EXECUTOR_SIGNER_SOCKET_PATH", resolveDefaultSignerSocketPath({ cwd })),
  processChecker = checkSignerProcesses,
  heartbeatReader = readHeartbeat,
  signerHealthReader = readSignerHealth,
  evmRpcPinger = pingAllEvmChains,
  btcRpcPinger = pingBitcoinRpc,
  signerAuditReader = summarizeSignerAudit,
} = {}) {
  const resolvedHeartbeatPath = resolvePathFromCwd(heartbeatPath, cwd);
  const resolvedSocketPath = resolvePathFromCwd(socketPath, cwd);
  const process = await processChecker();
  const heartbeat = summarizeHeartbeat({
    heartbeat: await heartbeatReader(resolvedHeartbeatPath),
    path: resolvedHeartbeatPath,
    now,
    ttlMs: heartbeatTtlMs,
  });
  const effectiveSocketPath = heartbeat.socketPath || resolvedSocketPath;
  let socket = null;
  try {
    socket = summarizeSocketResult(
      await signerHealthReader({
        socketPath: effectiveSocketPath,
        timeoutMs: Math.min(heartbeatTtlMs, 5_000),
      }),
    );
  } catch (error) {
    socket = {
      ok: false,
      status: "error",
      socketPath: effectiveSocketPath,
      error: errorPayload(error),
      nonceManagers: {
        ok: false,
        error: errorPayload(error),
        chains: [],
      },
    };
  }

  const [rpc, btcRpc, signerAudit] = await Promise.all([
    evmRpcPinger(),
    btcRpcPinger(),
    signerAuditReader({ rootDir: cwd }),
  ]);
  const report = {
    schemaVersion: 1,
    checkedAt: now,
    process,
    heartbeat,
    socket,
    rpc,
    btcRpc,
    nonceManagers: socket.nonceManagers,
    signerAudit,
  };
  return {
    ...report,
    cause: classifySignerHealth(report),
    readiness: buildSignerHealthReadiness(report),
  };
}
