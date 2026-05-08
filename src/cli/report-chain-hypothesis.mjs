#!/usr/bin/env node

import { buildChainHypothesisReport } from "../strategy/chain-hypothesis-evaluator.mjs";

function parseArgs(argv = []) {
  const flags = new Set(argv);
  const nowArg = argv.find((arg) => arg.startsWith("--now="));
  return {
    json: flags.has("--json"),
    now: nowArg ? nowArg.slice("--now=".length) : new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildChainHypothesisReport({ now: args.now });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`generatedAt=${report.generatedAt}`);
  console.log(`expiredStrategyPrimary=${report.summary.expiredStrategyPrimaryCount}`);
  console.log(`reserveProofGaps=${report.summary.reserveProofGapCount}`);
  for (const item of report.strategyPrimaryHypotheses) {
    console.log(`- ${item.chain}: ${item.status} expiresAt=${item.expiresAt}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
