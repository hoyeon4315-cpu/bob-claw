#!/usr/bin/env node

import { buildDashboardPublic } from "./build-dashboard-public.mjs";
import { createDashboardLiveServer, parseDashboardLiveArgs } from "../dashboard/live-server.mjs";

async function main() {
  const options = parseDashboardLiveArgs(process.argv.slice(2));
  await buildDashboardPublic({ publicDir: options.rootDir });
  const server = createDashboardLiveServer(options);
  const started = await server.start();
  console.log(`dashboardLive=${started.localUrl}`);
  console.log(`snapshot=${started.snapshotUrl}`);
  console.log(`events=${started.eventsUrl}`);
  console.log(`health=${started.localUrl}/healthz`);
  console.log(`ready=${started.localUrl}/readyz`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
