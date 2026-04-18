#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildProtocolMarketWatchers } from "../strategy/protocol-market-watchers.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [dashboardStatus, quoteLagLatest, dexSpreadLatest, wrappedBtcLendingLoopSlice, recursiveWrappedBtcLoop, recursiveStablecoinLoop, phase3Validation, protocolTrustTiers, secondaryStrategyScaffolds] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "dashboard-status.json")),
    readJsonIfExists(join(config.dataDir, "quote-lag-latest.json")),
    readJsonIfExists(join(config.dataDir, "dex-spread-latest.json")),
    readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "recursive_stablecoin_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "phase3-strategy-validation.json")),
    readJsonIfExists(join(config.dataDir, "protocol-trust-tiers.json")),
    readJsonIfExists(join(config.dataDir, "secondary-strategy-scaffolds.json")),
  ]);
  const report = buildProtocolMarketWatchers({
    dashboardStatus,
    quoteLagLatest,
    dexSpreadLatest,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    phase3Validation,
    protocolTrustTiers,
    secondaryStrategyScaffolds,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "protocol-market-watchers.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`watchers=${report.summary?.watcherCount ?? 0}`);
  console.log(`blocked=${report.summary?.blockedCount ?? 0}`);
  console.log(`observe=${report.summary?.observeCount ?? 0}`);
  console.log(`topBlocked=${report.summary?.topBlockedId || "n/a"}`);
  console.log(`nextAction=${report.summary?.nextAction?.code || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
