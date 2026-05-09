#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ingestOpportunityObservation } from "../strategy/radar/observation-ingest.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    args[rawKey] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const dataDir = resolve(args["data-dir"] || "data");
  const inputPath = args.input ? resolve(args.input) : null;
  if (!inputPath) {
    const result = {
      status: "no_input",
      wrote: false,
      blockers: [],
      reason: "no_input_observation",
    };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log("status=no_input");
    return;
  }
  const observation = JSON.parse(await readFile(inputPath, "utf8"));
  const result = await ingestOpportunityObservation({ dataDir, observation });
  if (args.json) {
    console.log(JSON.stringify({ status: result.wrote ? "completed" : "blocked", ...result }, null, 2));
  } else {
    console.log(`wrote=${result.wrote}`);
    if (result.blockers.length > 0) console.log(`blockers=${result.blockers.join(",")}`);
  }
  if (!result.wrote) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
