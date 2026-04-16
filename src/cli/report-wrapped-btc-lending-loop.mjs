#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  buildDefaultWrappedBtcLendingLoopConfig,
  buildWrappedBtcLendingLoopScaffold,
} from "../strategy/wrapped-btc-lending-loop-slice.mjs";

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
    write: flags.has("--write"),
    protocol: options.protocol || null,
    chain: options.chain || null,
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategyConfig = buildDefaultWrappedBtcLendingLoopConfig();
  if (args.protocol) strategyConfig.protocol = args.protocol;
  if (args.chain) strategyConfig.chain = args.chain;
  const dryRunReceipts = await readJsonl(config.dataDir, "wrapped-btc-loop-dry-runs");

  const report = buildWrappedBtcLendingLoopScaffold({ strategyConfig, dryRunReceipts });

  if (args.write) {
    const outputPath = join(config.dataDir, "wrapped-btc-lending-loop-slice.json");
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

  console.log(`strategy=${report.strategy.id}`);
  console.log(`protocol=${report.strategy.protocol} chain=${report.strategy.chain}`);
  console.log(
    `assets=collateral:${report.strategy.collateralAsset} borrow:${report.strategy.borrowAsset} authoritativeMarkets=${report.bindingSupport?.marketResolution?.allAuthoritativeMarketsResolved ? "resolved" : "incomplete"}`,
  );
  console.log(
    `bindingStatus=${report.bindingSupport?.status || "n/a"} bindingBlockers=${report.bindingSupport?.blockers?.join(",") || "none"}`,
  );
  console.log(`adapter=${report.protocolAdapter?.id || "n/a"} executionActions=${report.executionPlan?.actionCount ?? 0}`);
  console.log(`readyForDryRun=${report.readiness.readyForDryRun}`);
  console.log(
    `watcherStatus=${report.watcherRuntime?.status || "n/a"} unwindPlan=${report.emergencyUnwindExecution?.status || "n/a"} unwindActions=${report.unwindPlan?.actions?.length ?? 0}`,
  );
  console.log(`dryRunReceipts=${report.dryRunSummary?.runCount ?? 0} passed=${report.dryRunSummary?.passedCount ?? 0}`);
  console.log(
    `loop exposure=${report.entryPlan.loopedExposureMultiple ?? "n/a"}x healthFactor=${report.entryPlan.projectedHealthFactor ?? "n/a"} bufferPct=${report.entryPlan.projectedLiquidationBufferPct ?? "n/a"}`,
  );
  console.log(`paperAnnualNetCarryUsd=${report.pnl.paper.annualNetCarryUsd ?? "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
