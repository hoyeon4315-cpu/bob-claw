#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config/env.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { syncMerklQueueToRadar } from "../strategy/radar/merkl-queue-sync.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
    } else if (!next || next.startsWith("--")) {
      args[rawKey] = true;
    } else {
      args[rawKey] = next;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const dataDir = resolve(args["data-dir"] || config.dataDir || "data");
  const inputPath = resolve(args.input || "data/merkl-canary-queue.json");
  const merklQueue = JSON.parse(await readFile(inputPath, "utf8"));
  const result = await syncMerklQueueToRadar({ dataDir, merklQueue });
  if (args.json) {
    console.log(safeJsonStringify(result, 2));
  } else {
    console.log(`status=${result.status}`);
    console.log(`observed=${result.observedCount} written=${result.observationsWritten}`);
    console.log(`candidates=${result.candidateCount} written=${result.candidatesWritten}`);
    console.log(`skipped=${result.skippedCandidates.length}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
