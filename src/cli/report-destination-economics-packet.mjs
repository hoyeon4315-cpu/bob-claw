#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDestinationEconomicsPacketSnapshot } from "../strategy/destination-economics-snapshot.mjs";

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

async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const admissionChecklist = await readJson(join(config.dataDir, "destination-admission-checklist.json"));
  const overrides = await readJson(join(config.dataDir, "destination-input-overrides.json"));
  const freshnessAudit = await readJson(join(config.dataDir, "destination-evidence-freshness-audit.json"));
  const observations = await readJson(join(config.dataDir, "destination-economics-observations.json"));
  const blockers = await readJsonIfExists(join(config.dataDir, "destination-economics-blockers.json"));
  const { economicsPacket: report } = buildDestinationEconomicsPacketSnapshot({
    admissionChecklist,
    overrides,
    freshnessAudit,
    observations,
    blockers,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "destination-economics-packet.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`items=${report.summary.itemCount}`);
  console.log("");
  console.log("Measurement modes:");
  for (const item of report.summary.byMeasurementMode) {
    console.log(`- ${item.mode}: ${item.count}`);
  }
  console.log("");
  console.log("Top packet items:");
  for (const item of report.summary.topPacketItems) {
    console.log(`- ${item.chain}: ${item.label} [${item.measurementMode} missing=${item.missingFieldCount}]`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
