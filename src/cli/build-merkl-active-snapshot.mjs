#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { buildMerklActivePositions } from "../status/merkl-active-slice.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SRC = resolve(ROOT, "data/merkl-portfolio-positions.jsonl");
const DEFAULT_OUT = resolve(ROOT, "dashboard/public/merkl-active.json");
const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

export function loadMerklPositionEvents(path = DEFAULT_SRC) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function writeMerklActiveSnapshot({
  src = DEFAULT_SRC,
  out = DEFAULT_OUT,
  generatedAt = new Date().toISOString(),
} = {}) {
  const payload = buildMerklActivePositions(loadMerklPositionEvents(src), { generatedAt });
  await writeTextIfChanged(out, `${safeJsonStringify(payload, 2)}\n`);
  return payload;
}

async function main() {
  const payload = await writeMerklActiveSnapshot();
  process.stdout.write(`merkl-active.json: ${payload.activeCount} active positions\n`);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
