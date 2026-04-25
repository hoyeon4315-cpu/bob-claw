#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildSearchComplexityBudgets } from "../strategy/search-complexity-budgets.mjs";

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
  const secondaryStrategyScaffolds = await readJsonIfExists(join(config.dataDir, "secondary-strategy-scaffolds.json"));
  const report = buildSearchComplexityBudgets({ secondaryStrategyScaffolds });
  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "search-complexity-budgets.json"), `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`itemCount=${report.summary.itemCount}`);
  console.log(`recordedCount=${report.summary.recordedCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
