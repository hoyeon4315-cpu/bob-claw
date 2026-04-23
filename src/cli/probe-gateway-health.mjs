#!/usr/bin/env node
// Gateway health probe.
//
// Pings `GET /v1/get-routes` on the configured Gateway API and maintains
// the runtime availability signal at `state/gateway.disabled`. On
// consecutive failures (>= GATEWAY_POLICY.consecutiveFailuresToDisable)
// the file is created. On first success after a pause it is removed.
//
// Usage:
//   node src/cli/probe-gateway-health.mjs            # single probe
//   node src/cli/probe-gateway-health.mjs --watch    # continuous loop
//
// Output: JSON line per probe with { observedAt, ok, latencyMs, reason,
// stateFileChanged }. Exit code 0 on success, 1 on pause-triggering
// failure (so cron / CI can escalate).

import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { GATEWAY_POLICY } from "../config/gateway.mjs";
import { GatewayClient } from "../gateway/client.mjs";

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureDisabledFile(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${body}\n`, "utf8");
}

async function clearDisabledFile(path) {
  try {
    await rm(path, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function parseArgs(argv) {
  return {
    watch: argv.includes("--watch"),
    intervalSeconds: (() => {
      const idx = argv.indexOf("--interval");
      if (idx < 0) return null;
      const value = Number(argv[idx + 1]);
      return Number.isFinite(value) && value > 0 ? value : null;
    })(),
    baseUrl: (() => {
      const idx = argv.indexOf("--base-url");
      return idx >= 0 ? argv[idx + 1] : null;
    })(),
  };
}

async function probe({ client, policy, statePath, consecutiveFailures }) {
  const observedAt = new Date().toISOString();
  try {
    const startedAt = Date.now();
    const { body } = await client.getRoutes();
    const latencyMs = Date.now() - startedAt;
    const routeCount = Array.isArray(body) ? body.length : Array.isArray(body?.routes) ? body.routes.length : null;
    const wasDisabled = await fileExists(statePath);
    if (wasDisabled) await clearDisabledFile(statePath);
    return {
      observedAt,
      ok: true,
      latencyMs,
      routeCount,
      stateFileChanged: wasDisabled ? "cleared" : null,
      consecutiveFailures: 0,
    };
  } catch (error) {
    const nextFailures = consecutiveFailures + 1;
    const threshold = policy.consecutiveFailuresToDisable || 2;
    let stateFileChanged = null;
    if (nextFailures >= threshold) {
      const alreadyDisabled = await fileExists(statePath);
      if (!alreadyDisabled) {
        await ensureDisabledFile(
          statePath,
          JSON.stringify({
            observedAt,
            reason: "gateway_probe_failure_threshold",
            consecutiveFailures: nextFailures,
            errorName: error.name || null,
            errorMessage: error.message || null,
            status: error.details?.status || null,
          }),
        );
        stateFileChanged = "created";
      }
    }
    return {
      observedAt,
      ok: false,
      reason: error.name || "GatewayProbeError",
      errorMessage: error.message || null,
      status: error.details?.status || null,
      stateFileChanged,
      consecutiveFailures: nextFailures,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = GATEWAY_POLICY;
  const baseUrl = args.baseUrl || policy.apiBase;
  const statePath = resolve(process.cwd(), policy.stateFile);
  const client = new GatewayClient({ baseUrl });
  let consecutiveFailures = 0;
  const intervalMs = (args.intervalSeconds ?? policy.healthProbeIntervalSeconds ?? 300) * 1000;
  do {
    const result = await probe({ client, policy, statePath, consecutiveFailures });
    consecutiveFailures = result.consecutiveFailures;
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok && result.stateFileChanged === "created") {
      if (!args.watch) process.exitCode = 1;
    }
    if (!args.watch) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  } while (args.watch);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(2);
});
