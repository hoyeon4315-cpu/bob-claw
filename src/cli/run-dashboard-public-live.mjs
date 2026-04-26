#!/usr/bin/env node

import { spawn } from "node:child_process";
import readline from "node:readline";
import process from "node:process";
import {
  createDashboardLiveServer,
  dashboardRuntimeStatePath,
  extractQuickTunnelUrl,
  parseDashboardLiveArgs,
  writeDashboardRuntimeState,
} from "../dashboard/live-server.mjs";

function parseArgs(argv, env = process.env) {
  const base = parseDashboardLiveArgs(argv, env);
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
    ...base,
    publicTunnel: flags.has("--no-public-tunnel") ? "none" : (options["public-tunnel"] || env.BOB_CLAW_DASHBOARD_PUBLIC_TUNNEL || "quick"),
    runtimeStatePath: options["runtime-state-path"] || env.BOB_CLAW_DASHBOARD_RUNTIME_STATE_PATH || dashboardRuntimeStatePath(base.dataDir),
    cloudflaredPath: options["cloudflared-path"] || env.BOB_CLAW_CLOUDFLARED_PATH || "cloudflared",
    syncPagesOrigin: !flags.has("--no-sync-pages-origin"),
  };
}

function spawnLoggedProcess(command, args, { onLine = () => {} } = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    const rl = readline.createInterface({ input: stream });
    rl.on("line", (line) => onLine(line));
  }
  return child;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = createDashboardLiveServer(args);
  const startedAt = new Date().toISOString();
  const local = await server.start();
  let publicUrl = null;
  let tunnelStatus = "disabled";
  let pagesSync = {
    attempted: false,
    succeeded: false,
    lastAttemptAt: null,
    lastError: null,
  };
  let tunnelChild = null;
  let shuttingDown = false;

  const writeState = async () => {
    await writeDashboardRuntimeState({
      startedAt,
      localUrl: local.localUrl,
      snapshotUrl: local.snapshotUrl,
      eventsUrl: local.eventsUrl,
      publicUrl,
      tunnelStatus,
      pagesOriginSync: pagesSync,
      runtime: server.runtimeState(),
    }, args.runtimeStatePath);
  };

  const syncPagesOrigin = async (origin) => {
    pagesSync = {
      attempted: true,
      succeeded: false,
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
    };
    await writeState();
    await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [
        "src/cli/deploy-dashboard-cloudflare.mjs",
        "--skip-status",
        `--live-origin=${origin}`,
      ], {
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
        rejectPromise(new Error(`deploy-dashboard-cloudflare exited with code ${status ?? 1}`));
      });
    });
    pagesSync = {
      attempted: true,
      succeeded: true,
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
    };
    await writeState();
  };

  await writeState();
  console.log(`dashboardLocal=${local.localUrl}`);
  console.log(`dashboardHealth=${local.localUrl}/healthz`);
  console.log(`dashboardReady=${local.localUrl}/readyz`);

  if (args.publicTunnel === "quick") {
    tunnelStatus = "starting";
    await writeState();
    tunnelChild = spawnLoggedProcess(
      args.cloudflaredPath,
      ["tunnel", "--url", local.localUrl, "--loglevel", "info", "--no-autoupdate"],
      {
        onLine: async (line) => {
          console.log(`[cloudflared] ${line}`);
          const url = extractQuickTunnelUrl(line);
          if (url && url !== publicUrl) {
            publicUrl = url;
            tunnelStatus = "ready";
            console.log(`dashboardPublic=${publicUrl}`);
            await writeState();
            if (args.syncPagesOrigin) {
              try {
                await syncPagesOrigin(publicUrl);
              } catch (error) {
                pagesSync = {
                  attempted: true,
                  succeeded: false,
                  lastAttemptAt: new Date().toISOString(),
                  lastError: error.message,
                };
                await writeState();
                console.error(`[dashboard-live] pages origin sync failed: ${error.message}`);
              }
            }
          }
        },
      },
    );
    tunnelChild.on("exit", async (status) => {
      if (shuttingDown) return;
      tunnelStatus = "stopped";
      await writeState();
      console.error(`[dashboard-live] cloudflared exited with code ${status ?? 1}`);
      process.exit(status ?? 1);
    });
  } else {
    tunnelStatus = "disabled";
    await writeState();
  }

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    tunnelStatus = signal || "stopping";
    await writeState();
    if (tunnelChild && !tunnelChild.killed) {
      tunnelChild.kill("SIGTERM");
    }
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
