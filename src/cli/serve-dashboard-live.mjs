#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDashboardPublic } from "./build-dashboard-public.mjs";
import { createDashboardLiveServer, parseDashboardLiveArgs } from "../dashboard/live-server.mjs";

function buildPublicLiveRuntime({ enabled, origin, statusUrl, eventsUrl }) {
  return JSON.stringify({
    enabled,
    origin: origin || null,
    statusUrl: statusUrl || null,
    eventsUrl: eventsUrl || null,
    updatedAt: new Date().toISOString(),
  }, null, 2) + "\n";
}

async function writePublicLiveRuntime(publicDir, payload) {
  await writeFile(join(publicDir, "live-runtime.json"), payload, "utf8");
}

async function main() {
  const options = parseDashboardLiveArgs(process.argv.slice(2));
  await buildDashboardPublic({ publicDir: options.rootDir });
  const server = createDashboardLiveServer(options);
  const started = await server.start();

  await writePublicLiveRuntime(options.rootDir, buildPublicLiveRuntime({
    enabled: true,
    origin: started.localUrl,
    statusUrl: started.snapshotUrl,
    eventsUrl: started.eventsUrl,
  }));

  console.log(`dashboardLive=${started.localUrl}`);
  console.log(`snapshot=${started.snapshotUrl}`);
  console.log(`events=${started.eventsUrl}`);
  console.log(`health=${started.localUrl}/healthz`);
  console.log(`ready=${started.localUrl}/readyz`);
  console.log(`live-runtime.json updated: enabled=true`);

  async function shutdown() {
    await writePublicLiveRuntime(options.rootDir, buildPublicLiveRuntime({
      enabled: false,
      origin: null,
      statusUrl: null,
      eventsUrl: null,
    }));
    await server.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
