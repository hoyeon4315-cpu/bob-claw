#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildAllocatorCore } from "../strategy/allocator-core.mjs";
import { buildIndirectStablecoinLaneInventory } from "../strategy/indirect-stablecoin-lane-inventory.mjs";

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
  const [strategySnapshot, phase3Validation, wrappedBtcLendingLoopSlice, recursiveWrappedBtcLoop, recursiveStablecoinLoop, secondaryStrategyScaffolds, destinationPromotionGate, destinationStrategyRegistry] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "strategy-snapshot.json")),
    readJsonIfExists(join(config.dataDir, "phase3-strategy-validation.json")),
    readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "recursive_stablecoin_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "secondary-strategy-scaffolds.json")),
    readJsonIfExists(join(config.dataDir, "destination-promotion-gate.json")),
    readJsonIfExists(join(config.dataDir, "destination-strategy-registry.json")),
  ]);
  const indirectStablecoinLaneInventory = buildIndirectStablecoinLaneInventory();
  const report = buildAllocatorCore({
    strategySnapshot,
    phase3Validation,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    secondaryStrategyScaffolds,
    destinationPromotionGate,
    destinationStrategyRegistry,
    indirectStablecoinLaneInventory,
  });

  if (args.write) {
    const outputPath = join(config.dataDir, "allocator-core.json");
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

  console.log(`candidates=${report.summary.candidateCount}`);
  console.log(`activeAllocations=${report.summary.activeAllocationCount}`);
  console.log(`activeReadyCandidates=${report.summary.activeReadyCandidateCount}`);
  console.log(`planningCandidates=${report.summary.planningCandidateCount}`);
  console.log(`topActiveReady=${report.summary.topActiveReadyCandidateId || "n/a"}`);
  console.log(`topPlanning=${report.summary.topPlanningCandidateId || "n/a"}`);
  console.log(`nextAction=${report.summary.nextAction?.code || "n/a"}`);
  console.log(`priorityActiveReadyChains=${(report.summary.priorityExpansionActiveReadyChains || []).join(",") || "none"}`);
  console.log(`priorityReviewOnlyChains=${(report.summary.priorityExpansionReviewOnlyChains || []).join(",") || "none"}`);
  console.log(`portfolioDraftActive=${report.diversifiedPortfolioDraft?.summary?.activeDraftCount ?? 0}`);
  console.log(`portfolioDraftReview=${report.diversifiedPortfolioDraft?.summary?.reviewQueueCount ?? 0}`);
  if (report.chainCoverage) {
    console.log("");
    console.log("chainCoverage:");
    console.log(`  tier1_active_ready=${(report.summary.tier1ActiveReadyChains || []).join(",") || "n/a"}`);
    console.log(`  tier2_review_only=${(report.summary.tier2ReviewOnlyChains || []).join(",") || "n/a"}`);
    console.log(`  tier3_blocked_only=${(report.summary.tier3BlockedOnlyChains || []).join(",") || "n/a"}`);
    console.log(`  tier4_template_only=${(report.summary.tier4TemplateOnlyChains || []).join(",") || "n/a"}`);
    console.log(`  templateMissingCells=${report.summary.templateMissingCellCount ?? 0}`);
    console.log(`  stablecoinGatewayArrivalMissing=${(report.summary.stablecoinGatewayArrivalMissingChains || []).join(",") || "none"}`);
    console.log(`  stablecoinIndirectViaWrappedBtc=${(report.summary.stablecoinIndirectViaWrappedBtcChains || []).join(",") || "none"}`);
  }
  if (report.summary.indirectStableDirectChains?.length > 0 || report.summary.indirectStableReviewChains?.length > 0) {
    console.log("");
    console.log("indirectStableLane:");
    console.log(`  directStable=${(report.summary.indirectStableDirectChains || []).join(",") || "none"}`);
    console.log(`  indirectStableReview=${(report.summary.indirectStableReviewChains || []).join(",") || "none"}`);
    console.log(`  dexVenueCount=${report.summary.indirectStableDexVenueCount ?? 0}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
