#!/usr/bin/env node

import process from "node:process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { executorStrategyBindingsPath } from "../executor/strategies/wrapped-btc-loop-live.mjs";
import { inspectWrappedBtcLoopBindingsDocument } from "../strategy/wrapped-btc-loop-bindings.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    path: options.path || executorStrategyBindingsPath(),
    scenarioId: options.scenario || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bindingsDocument = JSON.parse(await readFile(resolve(args.path), "utf8"));
  const inspection = inspectWrappedBtcLoopBindingsDocument({
    bindingsDocument,
    scenarioId: args.scenarioId,
  });

  if (args.json) {
    console.log(JSON.stringify({
      path: resolve(args.path),
      ...inspection,
    }, null, 2));
    return;
  }

  console.log(`path=${resolve(args.path)}`);
  console.log(`ok=${inspection.ok}`);
  console.log(`scenarioIds=${inspection.scenarioIds.join(",") || "none"}`);
  if (inspection.warnings.length > 0) {
    console.log(`warnings=${inspection.warnings.join(" | ")}`);
  }
  if (inspection.errors.length > 0) {
    console.log(`errors=${inspection.errors.join(" | ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
