#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

function parseArgs(argv) {
  const topArg = argv.find((arg) => arg.startsWith("--top="));
  return {
    write: argv.includes("--write"),
    top: topArg ? Number(topArg.slice("--top=".length)) : 10,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function seedEntries(workbench, existingOverrides, top) {
  const existingIds = new Set((existingOverrides.entries || []).map((entry) => entry.templateId));
  const newEntries = [];

  for (const item of workbench.workItems || []) {
    if (newEntries.length >= top) break;
    if (existingIds.has(item.templateId)) continue;

    newEntries.push({
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId,
      label: item.label,
      status: "stub",
      values: {},
      notes: [
        `Fill the required fields for ${item.label}.`,
        `Current missing field count: ${item.missingFields.length}.`,
      ],
    });
  }

  return {
    ...existingOverrides,
    generatedAt: new Date().toISOString(),
    entries: [...(existingOverrides.entries || []), ...newEntries],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workbenchPath = join(config.dataDir, "destination-input-workbench.json");
  const overridesPath = join(config.dataDir, "destination-input-overrides.json");
  const workbench = await readJson(workbenchPath);
  const overrides = await readJson(overridesPath);
  const seeded = seedEntries(workbench, overrides, args.top);

  if (args.write) {
    await writeTextIfChanged(overridesPath, `${JSON.stringify(seeded, null, 2)}\n`);
  }

  console.log(`existingEntries=${(overrides.entries || []).length}`);
  console.log(`seededEntries=${(seeded.entries || []).length}`);
  console.log(`top=${args.top}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
