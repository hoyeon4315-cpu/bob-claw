#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";
import { buildDefaultWrappedBtcLendingLoopConfig } from "../strategy/wrapped-btc-lending-loop-slice.mjs";
import {
  buildWrappedBtcLoopBindingsTemplate,
  resolveWrappedBtcLoopBindingSupport,
} from "../strategy/wrapped-btc-loop-bindings.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

const DEFAULT_OUTPUT_PATH = "./state/executor-strategy-bindings.template.json";

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
    write: !flags.has("--no-write"),
    outputPath: options["output-path"] || DEFAULT_OUTPUT_PATH,
    scenarioId: options.scenario || "healthy_baseline",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategyConfig = buildDefaultWrappedBtcLendingLoopConfig();
  const support = resolveWrappedBtcLoopBindingSupport({
    strategyId: strategyConfig.id,
    strategyConfig,
  });
  const template = buildWrappedBtcLoopBindingsTemplate({
    strategyId: strategyConfig.id,
    strategyConfig,
    scenarioId: args.scenarioId,
  });

  if (args.write) {
    await writeTextIfChanged(resolve(args.outputPath), `${JSON.stringify(template, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify({
      outputPath: resolve(args.outputPath),
      writeRequested: args.write,
      support,
      template,
    }, null, 2));
    return;
  }

  console.log(`outputPath=${resolve(args.outputPath)}`);
  console.log(`writeRequested=${args.write}`);
  console.log(
    `requestedVenue=${strategyConfig.chain}:${strategyConfig.protocol} collateral=${strategyConfig.collateralAsset} borrow=${strategyConfig.borrowAsset}`,
  );
  console.log(`authoritativeMarketsResolved=${support.marketResolution?.allAuthoritativeMarketsResolved === true}`);
  console.log(`bindingStatus=${support.status}`);
  console.log(`executableFromRepo=${support.executableFromRepo}`);
  console.log(`blockers=${(support.blockers ?? []).join(",") || "none"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
