#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { runV1InfraDrillSuite } from "../prelive/v1-infra-drills.mjs";

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
  const report = await runV1InfraDrillSuite();

  if (args.write) {
    const outputPath = join(config.dataDir, "v1-infra-drills.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`status=${report.summary?.status || "n/a"}`);
  console.log(`drillCount=${report.summary?.drillCount ?? 0}`);
  console.log(`passedCount=${report.summary?.passedCount ?? 0}`);
  console.log(`topFailed=${report.summary?.topFailedDrillId || "n/a"}`);
  console.log(`nextAction=${report.summary?.nextAction?.code || "n/a"}`);
  for (const drill of report.drills || []) {
    console.log(`${drill.id} status=${drill.status} blockers=${drill.blockers.length}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
