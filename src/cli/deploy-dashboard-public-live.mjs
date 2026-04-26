#!/usr/bin/env node

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import { dashboardRuntimeStatePath, readDashboardRuntimeState } from "../dashboard/live-server.mjs";
import { config } from "../config/env.mjs";

function parseArgs(argv) {
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

async function waitForPublicUrl(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = await readDashboardRuntimeState(path);
    if (runtime?.publicUrl) return runtime;
    await delay(3000);
  }
  throw new Error(`Timed out waiting for dashboard public URL in ${path}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runNode("src/cli/manage-dashboard-live-launchd.mjs", ["--install"]);
  const runtime = await waitForPublicUrl(args.runtimeStatePath, args.timeoutMs);
  console.log(`dashboardPublic=${runtime.publicUrl}`);
  console.log(`dashboardLocal=${runtime.localUrl}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
