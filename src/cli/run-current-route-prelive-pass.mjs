#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import {
  buildCurrentRoutePrelivePass,
  buildCurrentRoutePrelivePassSummary,
  executeCurrentRoutePrelivePass,
  persistCurrentRoutePrelivePassRun,
} from "../prelive/current-route-prelive-pass.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    execute: flags.has("--execute"),
    continueOnFailure: flags.has("--continue-on-failure"),
    simulationLimit: options["simulation-limit"] ? Number(options["simulation-limit"]) : options.limit ? Number(options.limit) : null,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const initialContext = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const pass = buildCurrentRoutePrelivePass({ context: initialContext, simulationLimit: args.simulationLimit });
  const record = await executeCurrentRoutePrelivePass({
    pass,
    initialContext,
    buildContext: async () => buildCurrentDashboardContext({ dataDir: config.dataDir }),
    execute: args.execute,
    simulationLimit: args.simulationLimit,
    stopOnFailure: !args.continueOnFailure,
  });

  let summary = buildCurrentRoutePrelivePassSummary([record]);
  if (args.write || args.execute) {
    const persisted = await persistCurrentRoutePrelivePassRun({
      dataDir: config.dataDir,
      record,
      writeSummary: false,
    });
    summary = persisted || summary;
  }

  if (args.write || args.execute) {
    const outputPath = join(config.dataDir, "current-route-prelive-pass-summary.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  const activePass = record.finalPass || pass;
  const output = {
    record,
    pass: activePass,
    summary,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`mode=${record.mode}`);
  console.log(`passStatus=${activePass?.status || "none"}`);
  console.log(`route=${activePass?.route?.routeLabel || activePass?.route?.routeKey || "none"}`);
  console.log(`connectedRefreshRequired=${activePass?.connectedRefresh?.requiredRefreshCount ?? 0}`);
  console.log(`economicStatus=${activePass?.exactRouteFork?.economicStatus || "none"}`);
  console.log(
    `simulationProgress=${activePass?.exactRouteFork?.simulationSuccessCount ?? 0}/${activePass?.exactRouteFork?.simulationTargetCount ?? 0}`,
  );
  console.log(
    `forkProgress=${activePass?.exactRouteFork?.forkConfirmedCount ?? 0}/${activePass?.exactRouteFork?.forkTargetCount ?? 0}`,
  );
  console.log(`nextAction=${activePass?.nextAction?.code || "none"}`);
  console.log(`executionStatus=${record.executionStatus}`);
  console.log(`finalStatus=${record.finalStatus || "none"}`);
  console.log(`stopReason=${record.stopReason || "none"}`);
  console.log(`submitCommand=${record.submitCommand || activePass?.exactRouteFork?.submitCommand || "none"}`);
  for (const stage of activePass?.steps || []) {
    console.log(`passStep code=${stage.code} status=${stage.status} reason=${stage.reason || "none"}${stage.command ? ` command=${stage.command}` : ""}`);
  }
  console.log(
    `passSummary runs=${summary.runCount} preview=${summary.previewCount} readyForSigner=${summary.readyForSignerCount} proven=${summary.provenCount} blocked=${summary.blockedCount} partial=${summary.partialCount} failed=${summary.failureCount}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
