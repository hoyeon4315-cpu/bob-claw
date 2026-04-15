#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

function parseValue(raw) {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseArgs(argv) {
  const templateIdArg = argv.find((arg) => arg.startsWith("--template-id="));
  const setArgs = argv.filter((arg) => arg.startsWith("--set="));
  const setJsonArg = argv.find((arg) => arg.startsWith("--set-json="));
  return {
    write: argv.includes("--write"),
    templateId: templateIdArg ? templateIdArg.slice("--template-id=".length) : null,
    sets: [
      ...setArgs.map((arg) => {
        const body = arg.slice("--set=".length);
        const index = body.indexOf("=");
        if (index === -1) throw new Error(`Invalid --set argument: ${arg}`);
        return {
          key: body.slice(0, index),
          value: parseValue(body.slice(index + 1)),
        };
      }),
      ...Object.entries(setJsonArg ? JSON.parse(setJsonArg.slice("--set-json=".length)) : {}).map(([key, value]) => ({
        key,
        value,
      })),
    ],
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function upsertEntry(overrides, templateId, sets) {
  const entries = [...(overrides.entries || [])];
  const index = entries.findIndex((entry) => entry.templateId === templateId);
  const existing =
    index >= 0
      ? entries[index]
      : {
          templateId,
          status: "stub",
          values: {},
          notes: [],
        };

  const next = {
    ...existing,
    status: "partially_seeded",
    values: {
      ...(existing.values || {}),
    },
  };

  for (const item of sets) {
    next.values[item.key] = item.value;
  }

  if (index >= 0) {
    entries[index] = next;
  } else {
    entries.push(next);
  }

  return {
    ...overrides,
    generatedAt: new Date().toISOString(),
    entries,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.templateId) throw new Error("Missing --template-id");
  if (args.sets.length === 0) throw new Error("At least one --set=field=value is required");

  const overridesPath = join(config.dataDir, "destination-input-overrides.json");
  const overrides = await readJson(overridesPath);
  const updated = upsertEntry(overrides, args.templateId, args.sets);

  if (args.write) {
    await writeTextIfChanged(overridesPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  console.log(`templateId=${args.templateId}`);
  console.log(`fieldCount=${args.sets.length}`);
  console.log(`entryCount=${updated.entries.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
