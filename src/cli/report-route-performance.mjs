#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildDefaultRoutePerformancePolicy, buildRoutePerformanceRanking } from "../risk/route-performance.mjs";
import { buildCanaryProgressSummary, buildCanaryStageChecklist, buildExecutionStageSummary } from "../status/canary-inputs.mjs";
import { buildCrossAssetArbitrageSummary } from "../strategy/cross-asset-arbitrage.mjs";
import { buildDexEnvironmentSummary } from "../strategy/dex-environment.mjs";
import { buildDexRouteFocusSummary } from "../strategy/dex-route-focus.mjs";
import { buildDexGatewayArbitrageSummary } from "../strategy/dex-gateway-arbitrage.mjs";
import { buildDexRouteUniverseSummary } from "../strategy/dex-route-universe.mjs";
import { buildEdgeViabilitySummary, buildEdgeViabilityVerdict } from "../strategy/edge-viability.mjs";
import { buildEdgeResearchSummary } from "../strategy/edge-research.mjs";
import { buildNoEdgePersistenceSummary } from "../strategy/no-edge-persistence.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function formatUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value >= 1 ? 4 : 6)}` : "n/a";
}

function formatPct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "n/a";
}

function printRoute(route) {
  const tags = [];
  if (route.canaryContext?.isCurrentTopRoute) tags.push("current_top_route");
  if (route.canaryContext?.isLastAdvanceRoute) tags.push("last_advance_route");
  console.log("");
  console.log(`${route.routeKey || "unknown"} amount=${route.amount || "n/a"}${tags.length ? ` [${tags.join(",")}]` : ""}`);
  console.log(
    `  state=${route.enabledState} realizedSamples=${route.realizedSampleCount} quoteSuccess=${formatPct(route.quoteSuccessRate)} current=${route.currentTradeReadiness || "n/a"}`,
  );
  console.log(
    `  realizedMedian=${formatUsd(route.realizedMedianPnlUsd)} realizedTotal=${formatUsd(route.realizedTotalPnlUsd)} p95Loss=${formatUsd(route.routeP95LossUsd)} fillDrift=${Number.isFinite(route.medianFillDriftBps) ? route.medianFillDriftBps.toFixed(2) : "n/a"}bps`,
  );
  console.log(
    `  currentNet=${formatUsd(route.currentEstimatedNetEdgeUsd)} execNet=${formatUsd(route.currentExecutableNetEdgeUsd)} knownCost=${formatUsd(route.currentKnownCostUsd)} latencyP50=${route.quoteLatencyP50Ms ?? "n/a"} latencyP95=${route.quoteLatencyP95Ms ?? "n/a"}`,
  );
  if (route.rejectionReasons.length) {
    console.log(`  reasons=${route.rejectionReasons.join(",")}`);
  }
  if (route.canaryContext?.currentRoute) {
    const blockers = route.canaryContext.currentRoute.routeBlockers.join(",") || "none";
    const inputBlockers = route.canaryContext.currentRoute.blockingInputs
      .map((item) => `${item.key}:${item.state}`)
      .join(",") || "none";
    console.log(`  canaryBlockers=${blockers}`);
    console.log(`  canaryInputs=${inputBlockers}`);
  }
  if (route.canaryContext?.lastAdvance) {
    const advance = route.canaryContext.lastAdvance;
    const finalDecision = advance.finalDecision || advance.afterWalletCheckDecision || advance.initialDecision || "unknown";
    console.log(`  lastAdvance=${advance.initialDecision || "unknown"}->${finalDecision} actions=${advance.actions.join(",") || "none"}`);
  }
}

function bestStablecoinRoute(scores = []) {
  return [...scores]
    .filter((score) => score?.srcAsset?.family === "stablecoin" || score?.dstAsset?.family === "stablecoin")
    .sort(
      (left, right) =>
        (right.executableNetEdgeUsd ?? right.netEdgeUsd ?? Number.NEGATIVE_INFINITY) -
          (left.executableNetEdgeUsd ?? left.netEdgeUsd ?? Number.NEGATIVE_INFINITY) ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    )[0] || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [receiptRecords, quotes, quoteFailures, scoreSnapshot, dashboardStatus, advanceCanary, shadowObservations, dexQuotes, routeRecords] = await Promise.all([
    readJsonl(config.dataDir, "receipt-reconciliations"),
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    readJsonIfExists(join(config.dataDir, "dashboard-status.json")),
    readJsonIfExists(join(config.dataDir, "advance-canary-latest.json")),
    readJsonl(config.dataDir, "gateway-shadow-observations"),
    readJsonl(config.dataDir, "dex-quotes"),
    readJsonl(config.dataDir, "gateway-routes"),
  ]);

  const canaryProgress = buildCanaryProgressSummary({
    inputSummary: dashboardStatus?.canaryInputs || null,
    shadowCycle: dashboardStatus?.shadowCycle || null,
    advanceCanary,
    now: dashboardStatus?.generatedAt || undefined,
  });
  const canaryChecklist = buildCanaryStageChecklist({
    route: dashboardStatus?.canaryInputs
      ? {
          label: dashboardStatus.canaryInputs.routeLabel,
          amount: dashboardStatus.canaryInputs.amount,
          exactGasDone: dashboardStatus.canaryInputs.exactGas?.state !== "missing",
          readinessFailureReason: null,
        }
      : null,
    nextStep: dashboardStatus?.shadowCycle?.canary
      ? {
          decision: dashboardStatus.shadowCycle.canary.decision,
          reasons: dashboardStatus.shadowCycle.canary.reasons || [],
        }
      : null,
    inputSummary: dashboardStatus?.canaryInputs || null,
    shadowCycle: dashboardStatus?.shadowCycle || null,
    advanceCanary,
  });
  const executionStage = buildExecutionStageSummary({
    nextStep: dashboardStatus?.canaryInputs
      ? {
          decision: dashboardStatus.canaryInputs.scoreTradeReadiness === "shadow_candidate_review_only"
            ? "REVIEW_CANARY_CANDIDATE"
            : dashboardStatus?.shadowCycle?.canary?.decision || null,
          reasons: dashboardStatus.canaryInputs.blockers || [],
        }
      : null,
    dashboardStatus,
  });
  const crossAsset = buildCrossAssetArbitrageSummary(scoreSnapshot || null);
  const dexEnvironment = buildDexEnvironmentSummary({ dexQuotes });
  const dexGateway = buildDexGatewayArbitrageSummary({ scoreSnapshot: scoreSnapshot || null, dexQuotes });
  const latestRoutesRecord = routeRecords.at(-1) || null;
  const dexRouteUniverse = buildDexRouteUniverseSummary({
    routes: latestRoutesRecord?.routes || [],
    observedAt: latestRoutesRecord?.observedAt || null,
  });
  const dexRouteFocus = buildDexRouteFocusSummary({
    routes: latestRoutesRecord?.routes || [],
    quotes,
    scoreSnapshot: scoreSnapshot || null,
    dexQuotes,
  });
  const edgeViability = buildEdgeViabilitySummary({ scoreSnapshot: scoreSnapshot || null, dexQuotes });
  const edgeViabilityVerdict = buildEdgeViabilityVerdict({ edgeViability, dexRouteFocus });
  const edgeResearch = buildEdgeResearchSummary({ scoreSnapshot: scoreSnapshot || null, shadowObservations });
  const noEdgePersistence = buildNoEdgePersistenceSummary({ scoreSnapshot: scoreSnapshot || null, dexQuotes });

  const ranking = buildRoutePerformanceRanking({
    receiptRecords,
    quotes,
    quoteFailures,
    scores: scoreSnapshot?.scores || [],
    canaryProgress,
    policy: buildDefaultRoutePerformancePolicy(),
  });

  if (args.write) {
    const path = join(config.dataDir, "route-performance.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(ranking, null, 2)}\n`, "utf8");
  }

  if (args.json) {
    console.log(JSON.stringify(ranking, null, 2));
    return;
  }

  console.log(`routeVariants=${ranking.summary.routeVariantCount}`);
  console.log(`enabledReviewOnly=${ranking.summary.enabledCount}`);
  console.log(`disabled=${ranking.summary.disabledCount}`);
  console.log(`withRealizedData=${ranking.summary.realizedRouteCount}`);
  console.log("strategyNote=btc_family_transfer_alone_is_not_arbitrage");
  console.log("strategyTarget=local_executable_btc_stable_dislocation_must_beat_total_movement_cost");
  console.log("strategyBoundary=directional_btc_accumulation_is_not_counted_as_arbitrage_profit");

  if (ranking.summary.canaryProgress?.currentRoute) {
    const current = ranking.summary.canaryProgress.currentRoute;
    const inputBlockers = current.blockingInputs.map((item) => `${item.key}:${item.state}`).join(",") || "none";
    console.log(`canaryRoute=${current.routeLabel || current.routeKey || "unknown"} amount=${current.amount || "n/a"}`);
    console.log(`canaryTradeReadiness=${current.tradeReadiness || "n/a"}`);
    console.log(`canaryRouteBlockers=${current.routeBlockers.join(",") || "none"}`);
    console.log(`canaryInputBlockers=${inputBlockers}`);
  }
  console.log(`canaryProgressDone=${canaryChecklist.completed.join(" | ") || "none"}`);
  console.log(`canaryProgressRemaining=${canaryChecklist.remaining.join(" | ") || "none"}`);
  console.log(`manualCanaryReview=${executionStage.reviewStage}${executionStage.reviewReasons.length ? ` reasons=${executionStage.reviewReasons.join(",")}` : ""}`);
  console.log(`liveExecution=${executionStage.liveStage}${executionStage.auditDecision ? ` audit=${executionStage.auditDecision}` : ""}${executionStage.liveReasons.length ? ` reasons=${executionStage.liveReasons.join(",")}` : ""}`);
  console.log(
    `strongEdgeCandidates definite=${edgeResearch.definiteEdgeCandidateCount} multiLevel=${edgeResearch.multiLevelCandidateCount} missingDecay=${edgeResearch.missingDecayCoverageCount + edgeResearch.missingDecaySurvivalCount} singleLevel=${edgeResearch.singleLevelOnlyCount} noEdge=${edgeResearch.noEdgeCount} outliers=${edgeResearch.outlierCount}`,
  );
  console.log(
    `dexEnvironment monitoredRoutes=${dexEnvironment.monitoredRouteCount} staleLegs=${dexEnvironment.staleLegCount} unstableLegs=${dexEnvironment.unstableLegCount} thinLiquidityLegs=${dexEnvironment.thinLiquidityLegCount} singleSampleLegs=${dexEnvironment.singleSampleLegCount}`,
  );
  console.log(
    `dexRouteUniverse btcFamily=${dexRouteUniverse.btcFamilyRouteCount} fullyMeasurable=${dexRouteUniverse.fullyMeasurableRouteCount} singleGap=${dexRouteUniverse.singleProviderGapCount} doubleGap=${dexRouteUniverse.doubleProviderGapCount}`,
  );
  console.log(
    `dexRouteFocus loopObservable=${dexRouteFocus.loopObservableCount} partial=${dexRouteFocus.partialLoopMeasurementCount} missingGatewayQuote=${dexRouteFocus.missingGatewayQuoteCount}`,
  );
  console.log(
    `dexGatewayLoops bothDexSupported=${dexGateway.bothDexSupportedRouteCount} executable=${dexGateway.executableLoopCount} measuredNet=${dexGateway.measuredNetLoopCount} exact=${dexGateway.exactAmountMatchCount} profitable=${dexGateway.profitableExactCount}`,
  );
  console.log(
    `edgeViability measured=${edgeViability.measuredLoopCount} positive=${edgeViability.positiveMeasuredCount} policyReady=${edgeViability.policyReadyCount} medianGap=${formatUsd(edgeViability.medianGapToPolicyUsd)}`,
  );
  console.log(`edgeVerdict=${edgeViabilityVerdict.code} detail=${edgeViabilityVerdict.label}`);
  console.log(
    `noEdgePersistence durable=${noEdgePersistence.durableNoEdgeRouteCount} belowPolicy=${noEdgePersistence.belowPolicyRouteCount} nearPolicy=${noEdgePersistence.nearPolicyRouteCount} positiveBelow=${noEdgePersistence.positiveButBelowPolicyRouteCount}`,
  );
  const bestStable = bestStablecoinRoute(scoreSnapshot?.scores || []);
  if (bestStable) {
    console.log(
      `bestStablecoinRoute=${bestStable.routeKey} amount=${bestStable.amount} readiness=${bestStable.tradeReadiness} net=${formatUsd(bestStable.executableNetEdgeUsd ?? bestStable.netEdgeUsd)}`,
    );
  }
  if (edgeResearch.bestCandidate) {
    console.log(
      `bestEdgeResearchRoute=${edgeResearch.bestCandidate.routeKey} class=${edgeResearch.bestCandidate.classification} levels=${edgeResearch.bestCandidate.profitableLevels}/${edgeResearch.bestCandidate.amountLevels} bestNet=${formatUsd(edgeResearch.bestCandidate.bestNetEdgeUsd)}`,
    );
  }
  if (dexEnvironment.topRiskRoute) {
    console.log(
      `topDexEnvironmentRisk=${dexEnvironment.topRiskRoute.routeKey} amount=${dexEnvironment.topRiskRoute.amount} class=${dexEnvironment.topRiskRoute.classification} staleLegs=${dexEnvironment.topRiskRoute.staleLegCount} unstableLegs=${dexEnvironment.topRiskRoute.unstableLegCount} thinLiquidityLegs=${dexEnvironment.topRiskRoute.thinLiquidityLegCount} singleSampleLegs=${dexEnvironment.topRiskRoute.singleSampleLegCount}`,
    );
  }
  if (dexRouteUniverse.topGapChain) {
    console.log(
      `topDexCoverageGapChain=${dexRouteUniverse.topGapChain.chain} routeCount=${dexRouteUniverse.topGapChain.routeCount}`,
    );
  }
  if (dexRouteFocus.bestRoute) {
    console.log(
      `bestDexFocusRoute=${dexRouteFocus.bestRoute.routeKey} class=${dexRouteFocus.bestRoute.classification} gatewayQuotes=${dexRouteFocus.bestRoute.gatewayQuoteCount} entryQuotes=${dexRouteFocus.bestRoute.entryQuoteCount} exitQuotes=${dexRouteFocus.bestRoute.exitQuoteCount} bestExec=${formatUsd(dexRouteFocus.bestRoute.bestExecutableNetEdgeUsd)}`,
    );
  }
  if (dexGateway.bestLoop) {
    console.log(
      `bestDexGatewayLoop=${dexGateway.bestLoop.routeKey} net=${formatUsd(dexGateway.bestLoop.measuredLoopNetUsd)} amountGapPct=${((dexGateway.bestLoop.amountGapPct || 0) * 100).toFixed(2)}`,
    );
  } else if (dexGateway.closestLoop) {
    console.log(
      `closestDexGatewayLoop=${dexGateway.closestLoop.routeKey} net=${formatUsd(dexGateway.closestLoop.measuredLoopNetUsd)} amountGapPct=${((dexGateway.closestLoop.amountGapPct || 0) * 100).toFixed(2)} blockers=${dexGateway.closestLoop.blockers.join(",") || "none"}`,
    );
  }
  if (edgeViability.closestLoop) {
    console.log(
      `closestPolicyLoop=${edgeViability.closestLoop.routeKey} amount=${edgeViability.closestLoop.amount} net=${formatUsd(edgeViability.closestLoop.measuredLoopNetUsd)} gapToPolicy=${formatUsd(edgeViability.closestLoop.gapToPolicyUsd)} target=${formatUsd(edgeViability.closestLoop.requiredNetProfitUsd)}`,
    );
  }
  if (noEdgePersistence.bestRoute) {
    console.log(
      `bestPersistenceRoute=${noEdgePersistence.bestRoute.routeKey} class=${noEdgePersistence.bestRoute.classification} measuredLevels=${noEdgePersistence.bestRoute.measuredLevelCount} minGap=${formatUsd(noEdgePersistence.bestRoute.minGapToPolicyUsd)} bestNet=${formatUsd(noEdgePersistence.bestRoute.bestMeasuredLoopNetUsd)}`,
    );
  }
  console.log(`crossAssetLoops=${crossAsset.matchedLoopCount} closedLoops=${crossAsset.closedLoopCount} profitableClosedLoops=${crossAsset.profitableClosedLoopCount}`);
  if (crossAsset.bestLoop) {
    console.log(
      `bestCrossAssetLoop=${crossAsset.bestLoop.entryRouteKey} + ${crossAsset.bestLoop.exitRouteKey} net=${formatUsd(crossAsset.bestLoop.loopNetEdgeUsd)}`,
    );
  } else if (crossAsset.closestLoop) {
    console.log(
      `closestCrossAssetLoop=${crossAsset.closestLoop.entryRouteKey} + ${crossAsset.closestLoop.exitRouteKey} amountGapPct=${((crossAsset.closestLoop.amountGapPct || 0) * 100).toFixed(2)} blockers=${crossAsset.closestLoop.blockers.join(",") || "none"}`,
    );
  }
  if (ranking.summary.canaryProgress?.lastAdvance) {
    const advance = ranking.summary.canaryProgress.lastAdvance;
    const finalDecision = advance.finalDecision || advance.afterWalletCheckDecision || advance.initialDecision || "unknown";
    console.log(
      `lastAdvance=${advance.routeLabel || advance.routeKey || "unknown"} ${advance.initialDecision || "unknown"}->${finalDecision} actions=${advance.actions.join(",") || "none"}`,
    );
  }

  const focusedRoutes = ranking.routes.filter(
    (route) => route.canaryContext?.isCurrentTopRoute || route.canaryContext?.isLastAdvanceRoute,
  );
  const printed = new Set();
  for (const route of focusedRoutes) {
    printed.add(route.routeVariantKey);
    printRoute(route);
  }

  for (const route of ranking.routes.slice(0, 10)) {
    if (printed.has(route.routeVariantKey)) continue;
    printRoute(route);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
