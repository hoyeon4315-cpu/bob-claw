#!/usr/bin/env node

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { exitIfDevLocked } from "../runtime/dev-lock.mjs";
import {
  buildDevAgentAutomationBridge,
  summarizeDevAgentAutomationBridge,
} from "../strategy/dev-agent-automation-bridge.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    limit: entries.limit ? Number(entries.limit) : null,
    boardInput: entries.board ? resolve(entries.board) : null,
    remediationInput: entries.remediation ? resolve(entries.remediation) : null,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function loadInputs(args) {
  const [autonomousDiscoveryBoard, routeRemediation] = await Promise.all([
    readJsonIfExists(args.boardInput || join(config.dataDir, "autonomous-discovery-board.json")),
    readJsonIfExists(args.remediationInput || join(config.dataDir, "route-remediation-autopilot.json")),
  ]);
  return { autonomousDiscoveryBoard, routeRemediation };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.write && exitIfDevLocked({ cliName: "report-dev-agent-automation-bridge" })) {
    return;
  }

  const inputs = await loadInputs(args);
  const report = buildDevAgentAutomationBridge({
    autonomousDiscoveryBoard: inputs.autonomousDiscoveryBoard,
    routeRemediation: inputs.routeRemediation,
    limit: args.limit,
  });
  const summary = summarizeDevAgentAutomationBridge(report);

  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "dev-agent-automation-bridge.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      {
        normalize: (contents) => {
          if (!contents) return contents;
          return JSON.stringify(stripVolatile(JSON.parse(contents)));
        },
      },
    );
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`mode=${report.mode}`);
  console.log(`tasks=${summary.taskCount}`);
  console.log(`ready=${summary.readyTaskCount}`);
  console.log(`rejected=${summary.rejectedCount}`);
  console.log(`liveExecutable=${summary.liveExecutableTaskCount}`);
  console.log(`kinds=${Object.entries(summary.kindCounts).map(([key, value]) => `${key}:${value}`).join(",") || "none"}`);
  console.log(`runtimeAuthority=${summary.modelPolicy.runtimeAuthority}`);
  console.log(`llmMaySign=${summary.modelPolicy.llmMaySign}`);
  if (summary.topTask) {
    console.log(`top=${summary.topTask.id} kind=${summary.topTask.kind} score=${summary.topTask.score ?? "n/a"}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
