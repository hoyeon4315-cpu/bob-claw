#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildProtocolTrustTiers } from "../strategy/protocol-trust-tiers.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return { json: flags.has("--json"), write: flags.has("--write") };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [wrappedBtcLendingLoopSlice, recursiveWrappedBtcLoop, recursiveStablecoinLoop, secondaryStrategyScaffolds] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "recursive_stablecoin_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "secondary-strategy-scaffolds.json")),
  ]);
  const report = buildProtocolTrustTiers({ wrappedBtcLendingLoopSlice, recursiveWrappedBtcLoop, recursiveStablecoinLoop, secondaryStrategyScaffolds });
  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "protocol-trust-tiers.json"), `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`items=${report.summary.itemCount}`);
  console.log(`recorded=${report.summary.recordedCount}`);
  console.log(`reviewRequired=${report.summary.reviewRequiredCount}`);
  console.log(`nextAction=${report.summary.nextAction?.code || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
