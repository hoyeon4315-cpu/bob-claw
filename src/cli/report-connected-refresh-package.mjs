#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const report = context.connectedRefreshPackage;

  if (args.write) {
    const outputPath = join(config.dataDir, "connected-refresh-package.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`status=${report?.status || "n/a"}`);
  console.log(`route=${report?.currentRoute?.routeLabel || report?.currentRoute?.routeKey || "n/a"}`);
  console.log(`requiredRefreshes=${report?.summary?.requiredRefreshCount ?? 0}`);
  console.log(`nextAction=${report?.summary?.nextActionCode || "n/a"} command=${report?.summary?.nextActionCommand || "n/a"}`);
  console.log(`runner=${report?.summary?.runnerExecuteCommand || report?.runner?.execute || "n/a"}`);
  console.log(`fullCommandChain=${report?.summary?.fullCommandChain || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
