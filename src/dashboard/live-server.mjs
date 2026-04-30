import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import process from "node:process";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCapitalSummarySlice } from "../status/capital-summary-slice.mjs";
import { buildLiveYieldSlice, liveYieldMetricFields } from "../status/live-yield-slice.mjs";

export const DEFAULT_PORT = 8787;
export const DEFAULT_STREAM_MS = 1500;
export const DEFAULT_SNAPSHOT_CACHE_MS = 750;
export const DEFAULT_REFRESH_TICK_MS = 2000;
export const DEFAULT_WHOLE_WALLET_REFRESH_MS = 8000;
export const DEFAULT_TREASURY_REFRESH_MS = 20000;
export const DEFAULT_STATUS_SNAPSHOT_REFRESH_MS = 300_000;
export const DEFAULT_STRATEGY_TICK_REFRESH_MS = 4000;
export const DEFAULT_AUTO_KILL_REFRESH_MS = 5000;
export const DEFAULT_STATUS_BUILD_TIMEOUT_MS = 3500;
export const DEFAULT_REFRESH_TASK_TIMEOUT_MS = 120_000;

function finiteInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function dashboardRuntimeStatePath(dataDir = config.dataDir) {
  return resolve(dataDir, "dashboard-live-runtime.json");
}

export async function readDashboardRuntimeState(path = dashboardRuntimeStatePath()) {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeDashboardRuntimeState(state, path = dashboardRuntimeStatePath()) {
  return writeTextIfChanged(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function extractQuickTunnelUrl(output = "") {
  return String(output || "").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu)?.[0] || null;
}

export function parseDashboardLiveArgs(argv, env = process.env) {
  const flags = new Set(argv.filter((item) => item.startsWith("--") && !item.includes("=")));
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...parts] = item.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    rootDir: resolve(options["root-dir"] || env.BOB_CLAW_DASHBOARD_PUBLIC_DIR || "dashboard/public"),
    port: finiteInteger(options.port || env.BOB_CLAW_DASHBOARD_LIVE_PORT, DEFAULT_PORT),
    streamMs: finiteInteger(options["stream-ms"] || env.BOB_CLAW_DASHBOARD_LIVE_STREAM_MS, DEFAULT_STREAM_MS),
    dataDir: options["data-dir"] || env.BOB_CLAW_DATA_DIR || config.dataDir,
    address: options.address || null,
    corsOrigin: options["cors-origin"] || env.BOB_CLAW_DASHBOARD_CORS_ORIGIN || "*",
    snapshotCacheMs: finiteInteger(
      options["snapshot-cache-ms"] || env.BOB_CLAW_DASHBOARD_SNAPSHOT_CACHE_MS,
      DEFAULT_SNAPSHOT_CACHE_MS,
    ),
    refreshEnabled: !flags.has("--no-refresh"),
    refreshTickMs: finiteInteger(
      options["refresh-tick-ms"] || env.BOB_CLAW_DASHBOARD_REFRESH_TICK_MS,
      DEFAULT_REFRESH_TICK_MS,
    ),
    wholeWalletRefreshMs: finiteInteger(
      options["whole-wallet-refresh-ms"] || env.BOB_CLAW_DASHBOARD_WHOLE_WALLET_REFRESH_MS,
      DEFAULT_WHOLE_WALLET_REFRESH_MS,
    ),
    treasuryRefreshMs: finiteInteger(
      options["treasury-refresh-ms"] || env.BOB_CLAW_DASHBOARD_TREASURY_REFRESH_MS,
      DEFAULT_TREASURY_REFRESH_MS,
    ),
    strategyTickRefreshMs: finiteInteger(
      options["strategy-tick-refresh-ms"] || env.BOB_CLAW_DASHBOARD_STRATEGY_TICK_REFRESH_MS,
      DEFAULT_STRATEGY_TICK_REFRESH_MS,
    ),
    autoKillRefreshMs: finiteInteger(
      options["auto-kill-refresh-ms"] || env.BOB_CLAW_DASHBOARD_AUTO_KILL_REFRESH_MS,
      DEFAULT_AUTO_KILL_REFRESH_MS,
    ),
    statusSnapshotRefreshMs: finiteInteger(
      options["status-refresh-ms"] || env.BOB_CLAW_DASHBOARD_STATUS_REFRESH_MS,
      DEFAULT_STATUS_SNAPSHOT_REFRESH_MS,
    ),
    statusBuildTimeoutMs: finiteInteger(
      options["status-build-timeout-ms"] || env.BOB_CLAW_DASHBOARD_STATUS_BUILD_TIMEOUT_MS,
      DEFAULT_STATUS_BUILD_TIMEOUT_MS,
    ),
    refreshTaskTimeoutMs: finiteInteger(
      options["refresh-task-timeout-ms"] || env.BOB_CLAW_DASHBOARD_REFRESH_TASK_TIMEOUT_MS,
      DEFAULT_REFRESH_TASK_TIMEOUT_MS,
    ),
  };
}

function contentTypeFor(path) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jsx": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  })[extname(path).toLowerCase()] || "application/octet-stream";
}

function resolveStaticPath(rootDir, requestPath = "/") {
  const path = requestPath.split("?")[0] || "/";
  const relative = path === "/" ? "/index.html" : path;
  const resolved = resolve(rootDir, `.${relative}`);
  if (!resolved.startsWith(rootDir)) return null;
  return resolved;
}

async function loadDashboardStatusSnapshot({ rootDir, dataDir }) {
  const candidates = [
    join(rootDir, "dashboard-status.json"),
    join(dataDir, "dashboard-status.json"),
  ];
  let lastError = null;
  for (const path of candidates) {
    try {
      const text = await readFile(path, "utf8");
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("dashboard-status.json not found");
}

async function loadJsonFromCandidates(paths = []) {
  for (const path of paths) {
    try {
      const text = await readFile(path, "utf8");
      return JSON.parse(text);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function applyLiveSliceOverlay(status, { rootDir, dataDir, servedAt }) {
  let nextStatus = status;
  const walletHoldings = await loadJsonFromCandidates([
    join(rootDir, "wallet-holdings.json"),
    join(dataDir, "wallet-holdings.json"),
  ]);
  if (walletHoldings && walletHoldings.pending !== true && Array.isArray(walletHoldings.items)) {
    const currentWalletAt = status?.walletHoldings?.generatedAt || status?.walletHoldings?.observedAt || null;
    const incomingWalletAt = walletHoldings.generatedAt || walletHoldings.observedAt || null;
    if (timestampMs(incomingWalletAt) >= timestampMs(currentWalletAt)) {
      const capitalSummary = buildCapitalSummarySlice({
        walletHoldings,
        merklActivePositions: status?.strategy?.merklActivePositions || null,
        executorEstimatedAssetValueUsd: status?.capitalSummary?.executorEstimatedTotalUsd ?? null,
        generatedAt: incomingWalletAt || servedAt,
      });

      nextStatus = {
        ...status,
        walletHoldings,
        capitalSummary,
        liveOverlay: {
          ...(status.liveOverlay || {}),
          walletHoldings: {
            source: "wallet-holdings.json",
            generatedAt: walletHoldings.generatedAt || null,
            observedAt: walletHoldings.observedAt || null,
            appliedAt: servedAt,
          },
        },
      };
    }
  }

  const liveYield = buildLiveYieldSlice({
    merklActivePositions: nextStatus?.strategy?.merklActivePositions || null,
    btcUsd: nextStatus?.market?.btcUsd ?? null,
    generatedAt: servedAt,
  });
  return {
    ...nextStatus,
    flow: {
      ...(nextStatus?.flow || {}),
      liveYield,
      metrics: {
        ...(nextStatus?.flow?.metrics || {}),
        ...liveYieldMetricFields(liveYield),
      },
    },
  };
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms).unref?.();
  });
}

function apiHeaders(corsOrigin, extraHeaders = {}) {
  return {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders,
  };
}

function commandSummary(result = {}) {
  return {
    status: result.status ?? null,
    stdout: String(result.stdout || "").trim().split(/\r?\n/u).slice(-12),
    stderr: String(result.stderr || "").trim().split(/\r?\n/u).slice(-12),
    observedAt: new Date().toISOString(),
  };
}

export function createDashboardLiveServer(rawOptions = {}) {
  const options = {
    ...parseDashboardLiveArgs([], process.env),
    ...rawOptions,
    rootDir: resolve(rawOptions.rootDir || parseDashboardLiveArgs([], process.env).rootDir),
  };
  const tasks = {
    wholeWallet: {
      id: "wholeWallet",
      label: "whole-wallet inventory",
      script: "src/cli/inventory-whole-wallet.mjs",
      intervalMs: options.wholeWalletRefreshMs,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastError: null,
      lastResult: null,
      running: false,
    },
    treasury: {
      id: "treasury",
      label: "treasury inventory",
      script: "src/cli/inventory-treasury.mjs",
      intervalMs: options.treasuryRefreshMs,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastError: null,
      lastResult: null,
      running: false,
    },
    walletHoldingsSlice: {
      id: "walletHoldingsSlice",
      label: "wallet holdings slice",
      script: "src/cli/report-wallet-holdings-slice.mjs",
      intervalMs: options.wholeWalletRefreshMs,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastError: null,
      lastResult: null,
      running: false,
    },
    strategyTickStatus: {
      id: "strategyTickStatus",
      label: "strategy tick status",
      script: "src/cli/report-strategy-tick-slice.mjs",
      args: ["--quiet"],
      intervalMs: options.strategyTickRefreshMs,
      timeoutMs: options.refreshTaskTimeoutMs,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastError: null,
      lastResult: null,
      running: false,
    },
    autoKillEvents: {
      id: "autoKillEvents",
      label: "auto-kill event summary",
      script: "src/cli/report-auto-kill-events.mjs",
      args: ["--write"],
      intervalMs: options.autoKillRefreshMs,
      timeoutMs: options.refreshTaskTimeoutMs,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastError: null,
      lastResult: null,
      running: false,
    },
    statusSnapshot: {
      id: "statusSnapshot",
      label: "dashboard snapshot",
      script: "src/cli/status-dashboard.mjs",
      intervalMs: options.statusSnapshotRefreshMs,
      timeoutMs: options.refreshTaskTimeoutMs,
      deferInitialRun: true,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastError: null,
      lastResult: null,
      running: false,
    },
  };
  const taskOrder = [
    tasks.wholeWallet,
    tasks.treasury,
    tasks.walletHoldingsSlice,
    tasks.strategyTickStatus,
    tasks.autoKillEvents,
    tasks.statusSnapshot,
  ];
  let refreshTimer = null;
  let statusWarmTimer = null;
  let refreshPromise = null;
  let statusPromise = null;
  let statusBuildPromise = null;
  let lastStatusPayload = null;
  let lastStatusBuiltAtMs = 0;
  let shuttingDown = false;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  for (const task of [tasks.wholeWallet, tasks.treasury, tasks.walletHoldingsSlice]) {
    task.timeoutMs = options.refreshTaskTimeoutMs;
  }

  async function runNodeScript(script, args = [], { timeoutMs = options.refreshTaskTimeoutMs } = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [resolve(process.cwd(), script), ...args], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let killTimer = null;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        fn(value);
      };
      const timer = Number.isInteger(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            const result = { status: null, stdout, stderr };
            const error = new Error(`node ${script} timed out after ${timeoutMs}ms`);
            error.result = result;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
            killTimer.unref?.();
            settle(rejectPromise, error);
          }, timeoutMs)
        : null;
      timer?.unref?.();
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => settle(rejectPromise, error));
      child.on("exit", (status) => {
        const result = { status: status ?? 1, stdout, stderr };
        if (status === 0) {
          settle(resolvePromise, result);
          return;
        }
        const error = new Error(`node ${script} failed with code ${status ?? 1}`);
        error.result = result;
        settle(rejectPromise, error);
      });
    });
  }

  const injectedRunNodeScript = typeof rawOptions.runNodeScript === "function" ? rawOptions.runNodeScript : null;

  async function runNodeScriptForTask(task) {
    if (!injectedRunNodeScript) {
      return runNodeScript(task.script, task.args || [], { timeoutMs: task.timeoutMs });
    }
    return Promise.race([
      injectedRunNodeScript(task.script, task.args || []),
      timeoutAfter(task.timeoutMs, `node ${task.script} timed out after ${task.timeoutMs}ms`),
    ]);
  }

  async function runTask(task) {
    task.running = true;
    task.lastStartedAt = new Date().toISOString();
    try {
      const result = await runNodeScriptForTask(task);
      task.lastResult = commandSummary(result);
      task.lastSucceededAt = task.lastResult.observedAt;
      task.lastError = null;
      lastStatusPayload = null;
      lastStatusBuiltAtMs = 0;
      return result;
    } catch (error) {
      task.lastError = {
        message: error.message,
        observedAt: new Date().toISOString(),
      };
      task.lastFailedAt = task.lastError.observedAt;
      task.lastResult = commandSummary(error.result);
      const stderrTail = (error.result?.stderr || "").trim().split(/\r?\n/u).slice(-6).join(" | ");
      console.error(`[dashboard-live] ${task.label} failed: ${error.message}${stderrTail ? ` | stderr: ${stderrTail}` : ""}`);
      throw error;
    } finally {
      task.running = false;
      task.lastFinishedAt = new Date().toISOString();
    }
  }

  function taskDue(task) {
    if (!task.intervalMs || task.running) return false;
    const lastFinishedAtMs = task.lastFinishedAt ? new Date(task.lastFinishedAt).getTime() : 0;
    if (!lastFinishedAtMs && task.deferInitialRun) return Date.now() - startedAtMs >= task.intervalMs;
    return Date.now() - lastFinishedAtMs >= task.intervalMs;
  }

  async function maybeRunRefreshCycle() {
    if (!options.refreshEnabled || shuttingDown || refreshPromise) return refreshPromise;
    const dueTasks = taskOrder.filter(taskDue);
    if (dueTasks.length === 0) return null;
    refreshPromise = (async () => {
      await Promise.all(dueTasks.map(async (task) => {
        try {
          await runTask(task);
        } catch {
          // Task failure is already recorded in the task state and surfaced via health/runtime endpoints.
        }
      }));
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function snapshotTaskState(task) {
    return Object.freeze({
      id: task.id,
      label: task.label,
      intervalMs: task.intervalMs,
      deferInitialRun: task.deferInitialRun === true,
      running: task.running,
      lastStartedAt: task.lastStartedAt,
      lastFinishedAt: task.lastFinishedAt,
      lastSucceededAt: task.lastSucceededAt,
      lastFailedAt: task.lastFailedAt,
      lastError: task.lastError ? Object.freeze({ ...task.lastError }) : null,
      lastResult: task.lastResult ? Object.freeze({ ...task.lastResult }) : null,
    });
  }

  function runtimeState() {
    return Object.freeze({
      startedAt,
      localUrl: `http://127.0.0.1:${options.port}`,
      rootDir: options.rootDir,
      dataDir: options.dataDir,
      refreshEnabled: options.refreshEnabled,
      streamMs: options.streamMs,
      snapshotCacheMs: options.snapshotCacheMs,
      tasks: Object.freeze(Object.fromEntries(Object.values(tasks).map((task) => [task.id, snapshotTaskState(task)]))),
      lastStatusBuiltAt: lastStatusPayload?.liveTransport?.servedAt || null,
      liveMode: lastStatusPayload?.liveTransport?.mode || null,
    });
  }

  async function computeLiveStatusPayload() {
    void maybeRunRefreshCycle();
    const servedAt = new Date().toISOString();
    const dashboardStatus = await applyLiveSliceOverlay(await loadDashboardStatusSnapshot({
      rootDir: options.rootDir,
      dataDir: options.dataDir,
    }), {
      rootDir: options.rootDir,
      dataDir: options.dataDir,
      servedAt,
    });
    return {
      ...dashboardStatus,
      liveTransport: {
        mode: "live_api",
        source: "live-api",
        snapshotPath: "/api/live-status",
        eventsPath: "/api/live-events",
        refreshIntervalMs: options.streamMs,
        servedAt,
      },
      liveRuntime: runtimeState(),
    };
  }

  async function buildStaticFallbackPayload(errorMessage = null) {
    const servedAt = new Date().toISOString();
    const fallback = await applyLiveSliceOverlay(await loadDashboardStatusSnapshot({
      rootDir: options.rootDir,
      dataDir: options.dataDir,
    }), {
      rootDir: options.rootDir,
      dataDir: options.dataDir,
      servedAt,
    });
    return {
      ...fallback,
      liveTransport: {
        mode: "static_fallback",
        source: "dashboard-status.json",
        snapshotPath: "/api/live-status",
        eventsPath: "/api/live-events",
        refreshIntervalMs: options.streamMs,
        servedAt,
        error: errorMessage,
      },
      liveRuntime: runtimeState(),
    };
  }

  function startStatusBuild() {
    if (statusBuildPromise) return statusBuildPromise;
    statusBuildPromise = (async () => {
      try {
        const payload = await computeLiveStatusPayload();
        lastStatusPayload = payload;
        lastStatusBuiltAtMs = Date.now();
        return payload;
      } catch (error) {
        const fallback = await buildStaticFallbackPayload(error.message);
        lastStatusPayload = fallback;
        lastStatusBuiltAtMs = Date.now();
        return fallback;
      } finally {
        statusBuildPromise = null;
      }
    })();
    return statusBuildPromise;
  }

  async function buildTimedFallback(error) {
    if (lastStatusPayload) {
      return {
        ...lastStatusPayload,
        liveTransport: {
          ...(lastStatusPayload.liveTransport || {}),
          servedAt: new Date().toISOString(),
          warning: error.message,
        },
        liveRuntime: runtimeState(),
      };
    }
    return buildStaticFallbackPayload(error.message);
  }

  async function buildLiveStatus({ force = false } = {}) {
    if (!force && lastStatusPayload && Date.now() - lastStatusBuiltAtMs < options.snapshotCacheMs) {
      return lastStatusPayload;
    }
    if (statusPromise) return statusPromise;
    statusPromise = (async () => {
      const build = startStatusBuild();
      try {
        return await Promise.race([
          build,
          timeoutAfter(options.statusBuildTimeoutMs, `live status build timed out after ${options.statusBuildTimeoutMs}ms`),
        ]);
      } catch (error) {
        return buildTimedFallback(error);
      }
    })().finally(() => {
      statusPromise = null;
    });
    return statusPromise;
  }

  async function serveSnapshot(res) {
    const status = await buildLiveStatus();
    res.writeHead(200, apiHeaders(options.corsOrigin, {
      "Content-Type": "application/json; charset=utf-8",
    }));
    res.end(JSON.stringify(status));
  }

  async function serveHealth(res, { ready = false } = {}) {
    const status = await buildLiveStatus({ force: ready });
    const payload = {
      ok: true,
      ready,
      observedAt: new Date().toISOString(),
      liveMode: status.liveTransport?.mode || null,
      tasks: runtimeState().tasks,
    };
    res.writeHead(200, apiHeaders(options.corsOrigin, {
      "Content-Type": "application/json; charset=utf-8",
    }));
    res.end(JSON.stringify(payload));
  }

  async function serveRuntime(res) {
    res.writeHead(200, apiHeaders(options.corsOrigin, {
      "Content-Type": "application/json; charset=utf-8",
    }));
    res.end(JSON.stringify(runtimeState()));
  }

  function serveEvents(req, res) {
    res.writeHead(200, apiHeaders(options.corsOrigin, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    }));
    res.write(`retry: ${options.streamMs}\n\n`);
    let closed = false;
    let inFlight = false;

    const sendSnapshot = async () => {
      if (closed || inFlight) return;
      inFlight = true;
      try {
        const status = await buildLiveStatus({ force: true });
        res.write(`event: snapshot\ndata: ${JSON.stringify(status)}\n\n`);
      } catch (error) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      } finally {
        inFlight = false;
      }
    };

    const tick = setInterval(sendSnapshot, options.streamMs);
    const heartbeat = setInterval(() => {
      if (!closed) res.write(`: keepalive ${Date.now()}\n\n`);
    }, 15000);

    void sendSnapshot();
    req.on("close", () => {
      closed = true;
      clearInterval(tick);
      clearInterval(heartbeat);
    });
  }

  async function serveStatic(res, path) {
    try {
      const body = await readFile(path);
      res.writeHead(200, {
        "Content-Type": contentTypeFor(path),
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      throw error;
    }
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, apiHeaders(options.corsOrigin));
        res.end();
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method not allowed");
        return;
      }
      const url = req.url || "/";
      if (url.startsWith("/api/live-status")) {
        await serveSnapshot(res);
        return;
      }
      if (url.startsWith("/api/live-events")) {
        serveEvents(req, res);
        return;
      }
      if (url.startsWith("/api/runtime")) {
        await serveRuntime(res);
        return;
      }
      if (url.startsWith("/healthz")) {
        await serveHealth(res, { ready: false });
        return;
      }
      if (url.startsWith("/readyz")) {
        await serveHealth(res, { ready: true });
        return;
      }
      const path = resolveStaticPath(options.rootDir, url);
      if (!path) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid path");
        return;
      }
      await serveStatic(res, path);
    } catch (error) {
      res.writeHead(500, apiHeaders(options.corsOrigin, {
        "Content-Type": "application/json; charset=utf-8",
      }));
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  return {
    options,
    runtimeState,
    buildLiveStatus,
    async start() {
      await new Promise((resolvePromise) => server.listen(options.port, resolvePromise));
      if (options.refreshEnabled) {
        void maybeRunRefreshCycle();
        refreshTimer = setInterval(() => {
          void maybeRunRefreshCycle();
        }, options.refreshTickMs);
      }
      await buildLiveStatus({ force: true });
      statusWarmTimer = setInterval(() => {
        void buildLiveStatus({ force: true }).catch(() => {});
      }, Math.max(options.streamMs, options.snapshotCacheMs));
      return {
        localUrl: `http://127.0.0.1:${options.port}`,
        snapshotUrl: `http://127.0.0.1:${options.port}/api/live-status`,
        eventsUrl: `http://127.0.0.1:${options.port}/api/live-events`,
      };
    },
    async close() {
      shuttingDown = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (statusWarmTimer) clearInterval(statusWarmTimer);
      if (server.listening) {
        await new Promise((resolvePromise, rejectPromise) =>
          server.close((error) => (error ? rejectPromise(error) : resolvePromise())),
        );
      }
    },
  };
}
