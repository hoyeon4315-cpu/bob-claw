#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

function parseValue(raw) {
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseArgs(argv) {
  const templateIdArg = argv.find((arg) => arg.startsWith("--template-id="));
  const fieldArg = argv.find((arg) => arg.startsWith("--field="));
  const valueArg = argv.find((arg) => arg.startsWith("--value="));
  const sourceNameArg = argv.find((arg) => arg.startsWith("--source-name="));
  const sourceTypeArg = argv.find((arg) => arg.startsWith("--source-type="));
  const observedAtArg = argv.find((arg) => arg.startsWith("--observed-at="));
  const noteArg = argv.find((arg) => arg.startsWith("--note="));

  return {
    write: argv.includes("--write"),
    templateId: templateIdArg ? templateIdArg.slice("--template-id=".length) : null,
    field: fieldArg ? fieldArg.slice("--field=".length) : null,
    value: valueArg ? parseValue(valueArg.slice("--value=".length)) : undefined,
    sourceName: sourceNameArg ? sourceNameArg.slice("--source-name=".length) : null,
    sourceType: sourceTypeArg ? sourceTypeArg.slice("--source-type=".length) : null,
    observedAt: observedAtArg ? observedAtArg.slice("--observed-at=".length) : null,
    note: noteArg ? noteArg.slice("--note=".length) : null,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.templateId) throw new Error("Missing --template-id");
  if (!args.field) throw new Error("Missing --field");
  if (args.value === undefined) throw new Error("Missing --value");
  if (!args.sourceName) throw new Error("Missing --source-name");
  if (!args.sourceType) throw new Error("Missing --source-type");
  if (!args.observedAt) throw new Error("Missing --observed-at");

  const observationsPath = join(config.dataDir, "destination-economics-observations.json");
  const observations = await readJson(observationsPath);

  const updated = {
    ...observations,
    generatedAt: new Date().toISOString(),
    entries: [
      ...(observations.entries || []),
      {
        templateId: args.templateId,
        field: args.field,
        value: args.value,
        sourceName: args.sourceName,
        sourceType: args.sourceType,
        observedAt: args.observedAt,
        note: args.note ?? null,
      },
    ],
  };

  if (args.write) {
    await writeTextIfChanged(observationsPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  console.log(`templateId=${args.templateId}`);
  console.log(`field=${args.field}`);
  console.log(`entryCount=${updated.entries.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
