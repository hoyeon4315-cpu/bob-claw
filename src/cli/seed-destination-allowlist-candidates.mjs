#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

function parseArgs(argv) {
  const chainsArg = argv.find((arg) => arg.startsWith("--chains="));
  const categoriesArg = argv.find((arg) => arg.startsWith("--categories="));
  return {
    write: argv.includes("--write"),
    chains: chainsArg ? chainsArg.slice("--chains=".length).split(",").map((item) => item.trim()).filter(Boolean) : [],
    categories: categoriesArg
      ? categoriesArg
          .slice("--categories=".length)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function matches(item, args) {
  const chainMatch = args.chains.length === 0 || args.chains.includes(item.chain);
  const categoryMatch = args.categories.length === 0 || args.categories.includes(item.category);
  return chainMatch && categoryMatch;
}

function eligible(item) {
  return item.recommendation?.status === "candidate_for_allowlist_review";
}

function upsert(entries, item) {
  const index = entries.findIndex((entry) => entry.templateId === item.templateId);
  const existing =
    index >= 0
      ? entries[index]
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
      allowlistDecision: existing.values?.allowlistDecision ?? "candidate_for_review",
      allowlistNote: existing.values?.allowlistNote ?? "Auto-seeded from allowlist board candidate status",
    },
  };

  if (index >= 0) entries[index] = next;
  else entries.push(next);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const board = await readJson(join(config.dataDir, "destination-allowlist-board.json"));
  const overridesPath = join(config.dataDir, "destination-input-overrides.json");
  const overrides = await readJson(overridesPath);

  const candidates = (board.items || []).filter((item) => eligible(item) && matches(item, args));
  const entries = [...(overrides.entries || [])];

  for (const item of candidates) {
    upsert(entries, item);
  }

  const updated = {
    ...overrides,
    generatedAt: new Date().toISOString(),
    entries,
  };

  if (args.write) {
    await writeTextIfChanged(overridesPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  console.log(`matched=${candidates.length}`);
  console.log(`entries=${updated.entries.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
