#!/usr/bin/env node

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dashboardRuntimeStatePath, readDashboardRuntimeState } from "../dashboard/live-server.mjs";
import { config } from "../config/env.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

export function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...parts] = item.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    runtimeStatePath: options["runtime-state-path"] || dashboardRuntimeStatePath(config.dataDir),
    timeoutMs: options.timeout ? Number(options.timeout) : 120000,
  };
}

async function runNode(script, args = []) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", rejectPromise);
    child.on("exit", (status) => {
      if (status === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${script} exited with code ${status ?? 1}`));
    });
  });
}

export function runtimeHasFreshPublicUrl(runtime, { minStartedAtMs = 0, requirePagesSync = true } = {}) {
  if (!runtime?.publicUrl) return false;
  const startedAtMs = Date.parse(runtime.startedAt || "");
  if (!Number.isFinite(startedAtMs) || startedAtMs < minStartedAtMs) return false;
  if (runtime.tunnelStatus !== "ready") return false;
  if (requirePagesSync && runtime.pagesOriginSync?.succeeded !== true) return false;
  return true;
}

export async function waitForPublicUrl(path, timeoutMs, {
  minStartedAtMs = 0,
  pollMs = 3000,
  requirePagesSync = true,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = await readDashboardRuntimeState(path);
    if (runtimeHasFreshPublicUrl(runtime, { minStartedAtMs, requirePagesSync })) return runtime;
    await delay(pollMs);
  }
  throw new Error(`Timed out waiting for dashboard public URL in ${path}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const minStartedAtMs = Date.now();
  await runNode("src/cli/manage-dashboard-live-launchd.mjs", ["--install"]);
  const runtime = await waitForPublicUrl(args.runtimeStatePath, args.timeoutMs, { minStartedAtMs });
  console.log(`dashboardPublic=${runtime.publicUrl}`);
  console.log(`dashboardLocal=${runtime.localUrl}`);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
