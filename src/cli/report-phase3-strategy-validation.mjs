#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildPhase3StrategyValidation } from "../strategy/phase3-strategy-validation.mjs";
import { buildSearchComplexityBudgets, resolveSearchComplexityBudget } from "../strategy/search-complexity-budgets.mjs";
import { resolveTrustTierDecision } from "../strategy/protocol-trust-tiers.mjs";

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
  const [laneReclassification, wrappedBtcLendingLoopSlice, wrappedBtcLoopDryRun, wrappedBtcLoopOosEvidence, secondaryStrategyScaffolds, protocolTrustTiers] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "lane-reclassification.json")),
    readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json")),
    readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-dry-run-latest.json")),
    readJsonIfExists(join(config.dataDir, "wrapped-btc-loop-oos-evidence.json")),
    readJsonIfExists(join(config.dataDir, "secondary-strategy-scaffolds.json")),
    readJsonIfExists(join(config.dataDir, "protocol-trust-tiers.json")),
  ]);
  const searchComplexityBudgets = buildSearchComplexityBudgets({ secondaryStrategyScaffolds });
  const report = buildPhase3StrategyValidation({
    laneReclassification,
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRun,
    wrappedBtcLoopOosEvidence,
    secondaryStrategyScaffolds,
    protocolTrustTiers,
    resolveTrustTierDecision,
    searchComplexityBudgets,
    resolveSearchComplexityBudget,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "phase3-strategy-validation.json");
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

  console.log(`validationCount=${report.summary?.validationCount ?? 0}`);
  console.log(`passedCount=${report.summary?.passedCount ?? 0}`);
  console.log(`topBlocked=${report.summary?.topBlockedId || "n/a"}`);
  console.log(`nextAction=${report.summary?.nextAction?.code || "n/a"}`);
  for (const item of report.validations ?? []) {
    console.log(`${item.id} status=${item.overallStatus} blockers=${item.blockers.length}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
