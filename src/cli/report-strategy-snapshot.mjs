#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

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

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const report = context.strategySnapshot;

  if (args.write) {
    const outputPath = join(config.dataDir, "strategy-snapshot.json");
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

  const summary = report?.summary || {};
  const topStrategy = context.dashboardStatus?.strategy?.strategySnapshot?.topImplementedStrategy || null;
  const topPivot = context.dashboardStatus?.strategy?.strategySnapshot?.topPivot || null;
  const topAction = context.dashboardStatus?.strategy?.strategySnapshot?.topAction || null;
  const capitalExpansion = context.dashboardStatus?.strategy?.strategySnapshot?.capitalExpansionReview || null;
  const phase1Revalidation = context.dashboardStatus?.strategy?.strategySnapshot?.phase1Revalidation || null;
  const researchBoard = context.dashboardStatus?.strategy?.strategySnapshot?.researchBoard || null;
  const secondaryScaffolds = context.dashboardStatus?.strategy?.strategySnapshot?.secondaryStrategyScaffolds || null;
  const deterministicCandidates = context.dashboardStatus?.strategy?.strategySnapshot?.deterministicCandidates || null;
  const phase3Validation = context.dashboardStatus?.strategy?.strategySnapshot?.phase3StrategyValidation || null;
  const allocatorCore = context.dashboardStatus?.strategy?.strategySnapshot?.allocatorCore || null;
  const protocolTrustTiers = context.dashboardStatus?.strategy?.strategySnapshot?.protocolTrustTiers || null;
  const protocolMarketWatchers = context.dashboardStatus?.strategy?.strategySnapshot?.protocolMarketWatchers || null;
  const formulaAudit = context.dashboardStatus?.strategy?.strategySnapshot?.formulaAudit || null;
  const milestoneValidation = context.dashboardStatus?.strategy?.strategySnapshot?.milestoneValidationGates || null;
  const productCoverage = context.dashboardStatus?.strategy?.strategySnapshot?.productCoverage || null;

  console.log(`implementedStrategies=${summary.implementedStrategyCount ?? 0}`);
  console.log(`candidateForValidation=${summary.candidateForValidationCount ?? 0}`);
  console.log(`measuredBelowPolicy=${summary.measuredBelowPolicyCount ?? 0}`);
  console.log("capitalMode=per_strategy_caps");
  if (Number.isFinite(report?.currentSystem?.activeBudgetUsd)) {
    console.log(`activeBudgetUsd=${money(report?.currentSystem?.activeBudgetUsd)}`);
  }
  if (Number.isFinite(summary.planningBudgetUsd)) {
    console.log(`planningBudgetUsd=${money(summary.planningBudgetUsd)}`);
  }
  if (capitalExpansion) {
    if (Number.isFinite(capitalExpansion.activeLaneBudgetUsd) || Number.isFinite(capitalExpansion.planningLaneBudgetUsd)) {
      console.log(
        `capitalLanes=active:${money(capitalExpansion.activeLaneBudgetUsd)} planning:${money(capitalExpansion.planningLaneBudgetUsd)} approvalRequired=${capitalExpansion.approvalRequiredForPlanningLane}`,
      );
      console.log(
        `capitalPlanningTop=implemented:${capitalExpansion.planningTopImplementedId || "n/a"} pivot:${capitalExpansion.planningTopPivotId || "n/a"} yield:${capitalExpansion.planningYieldProfileId || "n/a"}`,
      );
    }
  }
  console.log(`topImplemented=${topStrategy?.id || "n/a"} status=${topStrategy?.status || "n/a"}`);
  console.log(`topPivot=${topPivot?.id || "n/a"} status=${topPivot?.status || "n/a"}`);
  console.log(`yieldTopProfile=${summary.yieldTopProfileId || "n/a"}`);
  console.log(`proxyCoverageNext=${summary.proxyCoverageNextAction || "n/a"}`);
  if (phase1Revalidation) {
    console.log(
      `phase1 overfit=${phase1Revalidation.overfitDecision || "n/a"} clearsNewFloor=${phase1Revalidation.clearsNewFloorCount ?? 0} varianceReadyRoutes=${phase1Revalidation.varianceReadyRouteCount ?? 0} candidateForValidation=${phase1Revalidation.candidateForValidationCount ?? 0}`,
    );
  }
  if (researchBoard) {
    console.log(
      `research candidates=${researchBoard.candidateCount ?? 0} top=${researchBoard.topCandidate?.id || "n/a"} newTop=${researchBoard.topNewCandidate?.id || "n/a"} newStatus=${researchBoard.topNewCandidate?.status || "n/a"} nextNew=${researchBoard.nextNewAction?.code || "n/a"}`,
    );
  }
  if (secondaryScaffolds) {
    console.log(
      `secondary scaffolds=${secondaryScaffolds.scaffoldCount ?? 0} top=${secondaryScaffolds.topScaffold?.id || "n/a"} next=${secondaryScaffolds.nextAction?.code || "n/a"}`,
    );
  }
  if (deterministicCandidates) {
    console.log(
      `deterministic candidates=${deterministicCandidates.candidateCount ?? 0} readyForDryRun=${deterministicCandidates.readyForDryRunCount ?? 0} receiptBacked=${deterministicCandidates.receiptBackedCount ?? 0} top=${deterministicCandidates.topCandidate?.id || "n/a"} next=${deterministicCandidates.nextAction?.code || "n/a"}`,
    );
  }
  if (phase3Validation) {
    console.log(
      `phase3 validations=${phase3Validation.validationCount ?? 0} passed=${phase3Validation.passedCount ?? 0} topBlocked=${phase3Validation.topBlocked?.id || "n/a"} next=${phase3Validation.nextAction?.code || "n/a"}`,
    );
  }
  if (allocatorCore) {
    console.log(
      `allocator candidates=${allocatorCore.candidateCount ?? 0} active=${allocatorCore.activeAllocationCount ?? 0} planning=${allocatorCore.planningCandidateCount ?? 0} top=${allocatorCore.topPlanningCandidate?.id || "n/a"}`,
    );
  }
  if (protocolTrustTiers) {
    console.log(`trustTiers recorded=${protocolTrustTiers.recordedCount ?? 0} reviewRequired=${protocolTrustTiers.reviewRequiredCount ?? 0}`);
  }
  if (protocolMarketWatchers) {
    console.log(
      `watchers blocked=${protocolMarketWatchers.blockedCount ?? 0} observe=${protocolMarketWatchers.observeCount ?? 0} top=${protocolMarketWatchers.topBlocked?.id || "n/a"} next=${protocolMarketWatchers.nextAction?.code || "n/a"}`,
    );
  }
  if (formulaAudit) {
    console.log(
      `formulaAudit implemented=${formulaAudit.summary?.implementedCount ?? 0} partial=${formulaAudit.summary?.partialCount ?? 0} missing=${formulaAudit.summary?.missingCount ?? 0} topGap=${formulaAudit.summary?.topGap?.id || "n/a"}`,
    );
  }
  if (milestoneValidation) {
    console.log(
      `milestones overall=${milestoneValidation.overallStatus || "n/a"} passed=${milestoneValidation.passedCount ?? 0}/${milestoneValidation.gateCount ?? 0} next=${milestoneValidation.nextGate?.id || "n/a"}`,
    );
  }
  if (productCoverage) {
    console.log(
      `productCoverage ready=${productCoverage.readyCount ?? 0} inProgress=${productCoverage.inProgressCount ?? 0} blocked=${productCoverage.blockedCount ?? 0} missing=${productCoverage.missingCount ?? 0} topGap=${productCoverage.topGap?.id || "n/a"} reason=${productCoverage.topGap?.reason || "n/a"}`,
    );
  }
  console.log(`nextAction=${topAction?.code || "n/a"} command=${topAction?.command || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
