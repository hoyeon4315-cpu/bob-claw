#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

function parseCsv(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const familyIdsArg = argv.find((arg) => arg.startsWith("--family-ids="));
  const categoriesArg = argv.find((arg) => arg.startsWith("--categories="));
  const sourceNameArg = argv.find((arg) => arg.startsWith("--source-name="));
  const sourceTypeArg = argv.find((arg) => arg.startsWith("--source-type="));
  const lastVerifiedAtArg = argv.find((arg) => arg.startsWith("--last-verified-at="));

  return {
    write: argv.includes("--write"),
    familyIds: parseCsv(familyIdsArg ? familyIdsArg.slice("--family-ids=".length) : ""),
    categories: parseCsv(categoriesArg ? categoriesArg.slice("--categories=".length) : ""),
    sourceName: sourceNameArg ? sourceNameArg.slice("--source-name=".length) : null,
    sourceType: sourceTypeArg ? sourceTypeArg.slice("--source-type=".length) : null,
    lastVerifiedAt: lastVerifiedAtArg ? lastVerifiedAtArg.slice("--last-verified-at=".length) : null,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function matches(item, args) {
  const familyMatch = args.familyIds.length === 0 || args.familyIds.includes(item.familyId);
  const categoryMatch = args.categories.length === 0 || args.categories.includes(item.category);
  return familyMatch && categoryMatch;
}

function upsertOverride(existingEntries, item, args) {
  const index = existingEntries.findIndex((entry) => entry.templateId === item.templateId);
  const existing =
    index >= 0
      ? existingEntries[index]
      : {
          templateId: item.templateId,
          chain: item.chain,
          familyId: item.familyId,
          label: item.label,
          status: "stub",
          values: {},
          notes: [],
        };

  const next = {
    ...existing,
    status: "partially_seeded",
    values: {
      ...(existing.values || {}),
      sourceName: args.sourceName ?? existing.values?.sourceName ?? null,
      sourceType: args.sourceType ?? existing.values?.sourceType ?? null,
      lastVerifiedAt: args.lastVerifiedAt ?? existing.values?.lastVerifiedAt ?? null,
    },
  };

  if (index >= 0) {
    existingEntries[index] = next;
  } else {
    existingEntries.push(next);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sourceName || !args.sourceType || !args.lastVerifiedAt) {
    throw new Error("Missing required source metadata arguments");
  }

  const workbenchPath = join(config.dataDir, "destination-input-workbench.json");
  const overridesPath = join(config.dataDir, "destination-input-overrides.json");
  const workbench = await readJson(workbenchPath);
  const overrides = await readJson(overridesPath);

  const entries = [...(overrides.entries || [])];
  const matched = (workbench.workItems || []).filter((item) => matches(item, args));

  for (const item of matched) {
    upsertOverride(entries, item, args);
  }

  const updated = {
    ...overrides,
    generatedAt: new Date().toISOString(),
    entries,
  };

  if (args.write) {
    await writeTextIfChanged(overridesPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  console.log(`matched=${matched.length}`);
  console.log(`entries=${updated.entries.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
