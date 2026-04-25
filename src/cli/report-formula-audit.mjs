#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildFormulaAudit } from "../research/formula-audit.mjs";

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
  const report = buildFormulaAudit();

  if (args.write) {
    const outputPath = join(config.dataDir, "formula-audit.json");
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

  console.log(`entries=${report.summary.entryCount}`);
  console.log(`implemented=${report.summary.implementedCount}`);
  console.log(`partial=${report.summary.partialCount}`);
  console.log(`missing=${report.summary.missingCount}`);
  console.log(`mismatches=${report.summary.mismatchCount}`);
  console.log(`topGap=${report.summary.topGap?.id || "n/a"} status=${report.summary.topGap?.status || "n/a"}`);
  for (const mismatch of report.mismatches.slice(0, 3)) {
    console.log(`mismatch ${mismatch.id} severity=${mismatch.severity}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
