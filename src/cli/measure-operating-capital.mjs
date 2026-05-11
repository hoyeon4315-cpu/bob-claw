#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { loadUnifiedOperatingCapital } from "../lib/unified-nav-reader.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(2, index), item.slice(index + 1)];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    out: entries.out || null,
    threshold: entries.threshold ? Number(entries.threshold) : undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const unified = await loadUnifiedOperatingCapital({
    dataDir: config.dataDir,
    discrepancyThresholdPct: args.threshold,
  });

  if (args.write) {
    const ts = unified.generatedAt.replace(/[:.]/g, "-");
    const outPath = args.out || join(config.dataDir, `aggressive-yield-baseline-${ts}.json`);
    const abs = resolve(outPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(unified, null, 2)}\n`);
    if (!args.json) console.log(`wrote ${abs}`);
  }

  if (args.json) {
    console.log(JSON.stringify(unified, null, 2));
    return;
  }

  console.log(`unifiedNavUsd=${unified.unifiedNavUsd}`);
  console.log(`evmAggregateUsd=${unified.evmAggregateUsd}`);
  console.log(`btcL1Usd=${unified.btcL1Usd}`);
  console.log(`protocolMarksUsd=${unified.protocolMarksUsd}`);
  console.log(`evmDiscrepancyPct=${unified.evmDiscrepancyPct}`);
  console.log(`flags=${unified.flags.join(",") || "none"}`);
  console.log(`halt=${unified.halt}`);
  console.log("breakdown:");
  for (const [key, slice] of Object.entries(unified.breakdown)) {
    console.log(`  ${key}: ${slice.valueUsd} (source=${slice.source})`);
  }
  if (unified.halt) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
