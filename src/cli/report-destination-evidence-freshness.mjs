#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationEvidenceFreshnessAudit } from "../strategy/destination-evidence-freshness-audit.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workbench = await readJson(join(config.dataDir, "destination-input-workbench.json"));
  const evidencePolicy = await readJson(join(config.dataDir, "destination-evidence-policy.json"));
  const report = buildDestinationEvidenceFreshnessAudit({ workbench, evidencePolicy, now: new Date() });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-evidence-freshness-audit.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`items=${report.summary.itemCount}`);
  console.log(`fresh=${report.summary.freshCount}`);
  console.log(`stale=${report.summary.staleCount}`);
  console.log(`missing=${report.summary.missingCount}`);
  console.log("");
  console.log("Top stale or missing:");
  for (const item of report.summary.topStaleOrMissing) {
    console.log(`- ${item.chain}: ${item.label} [${item.freshnessStatus}]`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
