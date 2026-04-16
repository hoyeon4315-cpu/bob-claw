#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildSecondaryStrategyScaffolds } from "../strategy/secondary-strategy-scaffolds.mjs";

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
  const laneReclassification = await readJsonIfExists(join(config.dataDir, "lane-reclassification.json"));
  const report = buildSecondaryStrategyScaffolds({ laneReclassification });

  if (args.write) {
    const outputPath = join(config.dataDir, "secondary-strategy-scaffolds.json");
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

  console.log(`scaffoldCount=${report.summary?.scaffoldCount ?? 0}`);
  console.log(`leverageCount=${report.summary?.leverageCount ?? 0}`);
  console.log(`topScaffold=${report.summary?.topScaffoldId || "n/a"}`);
  console.log(`nextAction=${report.summary?.nextAction?.code || "n/a"}`);
  for (const item of report.scaffolds) {
    console.log(`${item.rank}. ${item.id} status=${item.status} blockers=${item.blockers.length}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
