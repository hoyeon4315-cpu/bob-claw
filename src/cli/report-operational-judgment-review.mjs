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
  const report = context.operationalJudgmentReview;

  if (args.write) {
    const outputPath = join(config.dataDir, "operational-judgment-review.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`status=${report?.status || "n/a"}`);
  console.log(`issues=${report?.issueCount ?? 0}`);
  console.log(`highSeverity=${report?.highSeverityCount ?? 0}`);
  console.log(`nextAction=${report?.nextAction?.code || "n/a"} command=${report?.nextAction?.command || "n/a"}`);
  for (const entry of report?.issues || []) {
    console.log(`issue=${entry.code} severity=${entry.severity} headline=${entry.headline}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
