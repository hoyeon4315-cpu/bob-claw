#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function latestByTemplateAndField(entries = []) {
  const map = new Map();
  for (const entry of entries || []) {
    const key = `${entry.templateId}::${entry.field}`;
    const current = map.get(key);
    const currentTime = current ? new Date(current.observedAt).getTime() : -Infinity;
    const nextTime = new Date(entry.observedAt).getTime();
    if (!current || nextTime >= currentTime) {
      map.set(key, entry);
    }
  }
  return map;
}

async function main() {
  const write = process.argv.slice(2).includes("--write");
  const observationsPath = join(config.dataDir, "destination-economics-observations.json");
  const overridesPath = join(config.dataDir, "destination-input-overrides.json");

  const observations = await readJson(observationsPath);
  const overrides = await readJson(overridesPath);
  const latest = latestByTemplateAndField(observations.entries || []);

  const entries = [...(overrides.entries || [])];
  for (const observation of latest.values()) {
    const index = entries.findIndex((entry) => entry.templateId === observation.templateId);
    const existing =
      index >= 0
        ? entries[index]
        : {
            templateId: observation.templateId,
            status: "partially_seeded",
            values: {},
            notes: [],
          };

    const next = {
      ...existing,
      status: "partially_seeded",
      values: {
        ...(existing.values || {}),
        [observation.field]: observation.value,
      },
    };

    if (index >= 0) entries[index] = next;
    else entries.push(next);
  }

  const updated = {
    ...overrides,
    generatedAt: new Date().toISOString(),
    entries,
  };

  if (write) {
    await writeTextIfChanged(overridesPath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  console.log(`syncedFields=${latest.size}`);
  console.log(`entryCount=${updated.entries.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
