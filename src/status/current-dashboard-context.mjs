import { join } from "node:path";
import { config } from "../config/env.mjs";
import { loadCanaryState, readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildAdmissionRemediationPlan } from "../prelive/admission-remediation.mjs";
import { buildConnectedRefreshPackage, summarizeConnectedRefreshPackage } from "../prelive/connected-refresh-package.mjs";
import { buildConnectedRefreshExecutionSummary } from "../prelive/connected-refresh-runner.mjs";
import { buildCurrentRoutePrelivePassSummary } from "../prelive/current-route-prelive-pass.mjs";
import { buildExecutionRunbook, summarizeExecutionRunbook } from "../prelive/execution-runbook.mjs";
import { buildPreliveEvidenceCampaign, summarizePreliveEvidenceCampaign } from "../prelive/evidence-campaign.mjs";
import { buildExactRouteForkPackage, summarizeExactRouteForkPackage } from "../prelive/exact-route-fork-package.mjs";
import { buildOperationalJudgmentReview, summarizeOperationalJudgmentReview } from "../prelive/operational-judgment-review.mjs";
import { buildPreliveReadinessSummary } from "../prelive/readiness.mjs";
import { buildPreliveValidationReport, summarizePreliveValidationReport } from "../prelive/prelive-validation.mjs";
import { buildPreliveReviewPackage, summarizePreliveReviewPackage } from "../prelive/review-package.mjs";
import { reconcileTinyCanaryAdmissionWithLivePolicy } from "../prelive/tiny-canary-admission.mjs";
import { readTriangleArtifacts } from "../flash/triangle-artifacts.mjs";
import { buildAllocatorCore, summarizeAllocatorCore } from "../strategy/allocator-core.mjs";
import { buildMilestoneValidationGates, summarizeMilestoneValidationGates } from "../strategy/milestone-validation-gates.mjs";
import { buildPaybackDashboardSlice } from "../executor/payback/dashboard.mjs";
import { buildPhase3StrategyValidation, summarizePhase3StrategyValidation } from "../strategy/phase3-strategy-validation.mjs";
import { buildProtocolMarketWatchers, summarizeProtocolMarketWatchers } from "../strategy/protocol-market-watchers.mjs";
import { buildProtocolTrustTiers, resolveTrustTierDecision, summarizeProtocolTrustTiers } from "../strategy/protocol-trust-tiers.mjs";
import { buildSearchComplexityBudgets, resolveSearchComplexityBudget } from "../strategy/search-complexity-budgets.mjs";
import { buildProductPlanningCoverage, buildStrategySnapshot, summarizeStrategySnapshot } from "../strategy/strategy-snapshot.mjs";
import { buildObjectivePlans } from "../strategy/objective-plans.mjs";
import { buildCanaryInputSummary } from "./canary-inputs.mjs";
import { buildAllChainAutopilotDashboardSlice } from "./all-chain-autopilot-slice.mjs";
import { buildCapitalSummarySlice } from "./capital-summary-slice.mjs";
import { buildDashboardStatus } from "./dashboard-status.mjs";
import { buildChainParitySlice } from "./chain-parity-slice.mjs";
import { buildFlowDashboardSlice } from "./flow-slice.mjs";
import { buildMerklActivePositions } from "./merkl-active-slice.mjs";
import { buildStrategyParitySlice } from "./strategy-parity-slice.mjs";
import { buildTreasuryHoldingsSlice } from "./treasury-holdings-slice.mjs";
import { loadExecutorRuntime } from "./executor-runtime.mjs";
import { buildLiveBaselineSummary } from "./live-baseline.mjs";
import { applyLaneAwareLivePolicy } from "./live-policy.mjs";
import { buildCanarySelectionGap } from "../strategy/canary-selection-gap.mjs";
import { summarizeV1InfraDrills } from "../prelive/v1-infra-drills.mjs";
import { stabilizeWrappedBtcLoopLiveProof } from "../strategy/wrapped-btc-loop-live-proof.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";

function summarizeMerklCandidate(candidate = null) {
  if (!candidate) return null;
  return {
    opportunityId: candidate.opportunityId || null,
    chain: candidate.chain || null,
    protocolId: candidate.protocolId || null,
    name: candidate.name || null,
    family: candidate.family || null,
    mappedStrategyId: candidate.mappedStrategyId || null,
    score: candidate.score ?? null,
    campaignRemainingHours: candidate.campaignRemainingHours ?? null,
    validationMode: candidate.validationMode || null,
    decision: candidate.decision || null,
  };
}

function summarizeMerklOpportunityStatus(report = null, alerts = []) {
  if (!report) return null;
  const latestAlert = alerts.at(-1) || null;
  const summary = report.summary || {};
  return {
    generatedAt: report.generatedAt || null,
    policyProfile: report.policyProfile || null,
    validationModel: report.validationModel || null,
    opportunityCount: summary.opportunityCount ?? 0,
    campaignCount: summary.campaignCount ?? 0,
    candidateCount: summary.candidateCount ?? 0,
    liveCanaryCandidateCount: summary.liveCanaryCandidateCount ?? 0,
    multiAssetRelevantCount: summary.multiAssetRelevantCount ?? 0,
    rotationCandidateCount: summary.rotationCandidateCount ?? 0,
    highOverfitRiskCount: summary.highOverfitRiskCount ?? 0,
    topCandidate: summarizeMerklCandidate(report.topCandidates?.[0] || null),
    topCandidates: (report.topCandidates || []).slice(0, 5).map(summarizeMerklCandidate),
    latestAlert: latestAlert
      ? {
          observedAt: latestAlert.observedAt || null,
          updateDetected: latestAlert.diff?.changed === true,
          addedCount: latestAlert.diff?.addedOpportunityIds?.length ?? 0,
          removedCount: latestAlert.diff?.removedOpportunityIds?.length ?? 0,
          newlyExpiringCount: latestAlert.diff?.newlyExpiringIds?.length ?? 0,
          endedCount: latestAlert.diff?.endedIds?.length ?? 0,
          topCandidateId: latestAlert.reportSummary?.topCandidateId || null,
        }
      : null,
    nextAction:
      (summary.liveCanaryCandidateCount ?? 0) > 0
        ? "queue_merkl_candidate_tiny_live_canary"
        : "continue_merkl_watch",
  };
}

function summarizeMerklCanaryQueueStatus(queue = null) {
  if (!queue) return null;
  const summary = queue.summary || {};
  const top = queue.queue?.[0] || null;
  return {
    generatedAt: queue.generatedAt || null,
    queueCount: summary.queueCount ?? 0,
    topQueueId: summary.topQueueId || null,
    topOpportunityId: summary.topOpportunityId || null,
    topNextAction: summary.topNextAction || null,
    topExecutableOpportunityId: summary.topExecutableOpportunityId || null,
    chainCount: summary.chainCount ?? 0,
    protocolBindingReadyCount: summary.protocolBindingReadyCount ?? 0,
    protocolBindingRequiredCount: summary.protocolBindingRequiredCount ?? 0,
    unsupportedProtocolBindingCount: summary.unsupportedProtocolBindingCount ?? 0,
    chainRouteGapCount: summary.chainRouteGapCount ?? 0,
    executableNowCount: summary.executableNowCount ?? 0,
    cooldownActiveCount: summary.cooldownActiveCount ?? 0,
    nativeGasGapCount: summary.nativeGasGapCount ?? 0,
    executorMissingCount: summary.executorMissingCount ?? 0,
    readinessByStatus: summary.readinessByStatus || {},
    capabilityGapCounts: summary.capabilityGapCounts || {},
    topBlockingReason: summary.topBlockingReason || null,
    topQueue: top
      ? {
          opportunityId: top.opportunityId || null,
          chain: top.chain || null,
          protocolId: top.protocolId || null,
          mappedStrategyId: top.mappedStrategyId || null,
          canaryKind: top.canaryKind || null,
          priorityScore: top.priorityScore ?? null,
          capabilityGaps: top.capabilityGaps || [],
          protocolBindingStatus: top.protocolBindingPlan?.status || null,
          executionReadiness: top.executionReadiness?.status || null,
        }
      : null,
  };
}

function buildMerklAprMap(allocatorLatest = null) {
  const allocations = Array.isArray(allocatorLatest?.allocations)
    ? allocatorLatest.allocations
    : Array.isArray(allocatorLatest?.plan?.allocations)
      ? allocatorLatest.plan.allocations
      : [];
  const map = {};
  for (const item of allocations) {
    const queueItem = item?.queueItem || null;
    if (!queueItem?.opportunityId) continue;
    if (!Number.isFinite(queueItem.aprPct)) continue;
    map[queueItem.opportunityId] = queueItem.aprPct;
  }
  return map;
}

export async function buildCurrentDashboardContext({ dataDir = config.dataDir, address = null } = {}) {
  const now = new Date().toISOString();
  const state = await loadCanaryState({ address, dataDir });
  const [
    quoteFailures,
    gasFailures,
    updateSnapshots,
    updateAlerts,
    dexFailures,
    gasEstimateFailures,
    shadowCycle,
    advanceCanary,
    preliveSimulationRuns,
    preliveForkPlan,
    preliveForkSubmissions,
    preliveForkReceipts,
    receiptReconciliations,
    executionEvents,
    shadowRefreshExecutions,
    shadowRefreshBatches,
    connectedRefreshRuns,
    currentRoutePrelivePasses,
    preliveEvidenceCampaigns,
    quoteLagLatest,
    dexSpreadLatest,
    thresholdSensitivity,
    triangleArtifacts,
    destinationAllocationPlan,
    destinationPromotionGate,
    destinationStrategyRegistry,
    overfitAuditArtifact,
    gasSlippageVariance,
    laneReclassification,
     strategyResearchBoard,
     secondaryStrategyScaffolds,
     deterministicStrategyCandidates,
     flashFloorDecision,
      recursiveWrappedBtcLoop,
      recursiveWrappedBtcLoopDryRun,
      recursiveStablecoinLoop,
      recursiveStablecoinLoopDryRun,
      wrappedBtcLendingLoopSlice,
      wrappedBtcLoopDryRun,
     wrappedBtcLoopOosEvidence,
     wrappedBtcLoopLiveProof,
     capitalAuditReport,
     v1InfraDrills,
     promotionReport,
     allChainAutopilotLatest,
     treasuryInventoryRecords,
      wholeWalletInventoryRecords,
      merklPositionEvents,
      signerAuditRecords,
    ] = await Promise.all([
    readJsonl(dataDir, "gateway-quote-failures"),
    readJsonl(dataDir, "gas-snapshot-failures"),
    readJsonl(dataDir, "gateway-update-snapshots"),
    readJsonl(dataDir, "gateway-update-alerts"),
    readJsonl(dataDir, "dex-quote-failures"),
    readJsonl(dataDir, "gateway-gas-estimate-failures"),
    readJsonIfExists(join(dataDir, "shadow-cycle-latest.json")),
    readJsonIfExists(join(dataDir, "advance-canary-latest.json")),
    readJsonl(dataDir, "prelive-simulation-runs"),
    readJsonIfExists(join(dataDir, "prelive-fork-plan.json")),
    readJsonl(dataDir, "prelive-fork-submissions"),
    readJsonl(dataDir, "prelive-fork-receipts"),
    readJsonl(dataDir, "receipt-reconciliations"),
    readJsonl(dataDir, "execution-journal"),
    readJsonl(dataDir, "shadow-refresh-executions"),
    readJsonl(dataDir, "shadow-refresh-batches"),
    readJsonl(dataDir, "connected-refresh-runs"),
    readJsonl(dataDir, "current-route-prelive-passes"),
    readJsonl(dataDir, "prelive-evidence-campaigns"),
    readJsonIfExists(join(dataDir, "quote-lag-latest.json")),
    readJsonIfExists(join(dataDir, "dex-spread-latest.json")),
    readJsonIfExists(join(dataDir, "threshold-sensitivity.json")),
    readTriangleArtifacts(dataDir),
    readJsonIfExists(join(dataDir, "destination-allocation-plan.json")),
    readJsonIfExists(join(dataDir, "destination-promotion-gate.json")),
    readJsonIfExists(join(dataDir, "destination-strategy-registry.json")),
    readJsonIfExists(join(dataDir, "overfit-audit-latest.json")),
    readJsonIfExists(join(dataDir, "gas-slippage-variance-latest.json")),
    readJsonIfExists(join(dataDir, "lane-reclassification.json")),
     readJsonIfExists(join(dataDir, "strategy-research-board.json")),
     readJsonIfExists(join(dataDir, "secondary-strategy-scaffolds.json")),
      readJsonIfExists(join(dataDir, "deterministic-strategy-candidates.json")),
      readJsonIfExists(join(dataDir, "flash-floor-decision.json")),
      readJsonIfExists(join(dataDir, "recursive_wrapped_btc_lending_loop-scaffold.json")),
      readJsonIfExists(join(dataDir, "recursive_wrapped_btc_lending_loop-dry-run-latest.json")),
      readJsonIfExists(join(dataDir, "recursive_stablecoin_lending_loop-scaffold.json")),
      readJsonIfExists(join(dataDir, "recursive_stablecoin_lending_loop-dry-run-latest.json")),
      readJsonIfExists(join(dataDir, "wrapped-btc-lending-loop-slice.json")),
      readJsonIfExists(join(dataDir, "wrapped-btc-lending-loop-dry-run-latest.json")),
     readJsonIfExists(join(dataDir, "wrapped-btc-loop-oos-evidence.json")),
     readJsonIfExists(join(dataDir, "wrapped-btc-loop-live-success-latest.json")),
     readJsonIfExists(join(dataDir, "capital-audit.json")),
     readJsonIfExists(join(dataDir, "v1-infra-drills.json")),
       readJsonIfExists(join(dataDir, "promotion-latest.json")),
       readJsonIfExists(join(dataDir, "all-chain-autopilot-latest.json")),
       readJsonl(dataDir, "treasury-inventory"),
       readJsonl(dataDir, "whole-wallet-inventory"),
       readJsonl(dataDir, "merkl-portfolio-positions"),
       readSignerAuditLog(),
     ]);
  const [merklOpportunityReport, merklOpportunityAlerts, merklCanaryQueue, merklPortfolioAllocatorLatest] = await Promise.all([
    readJsonIfExists(join(dataDir, "merkl-opportunities-report.json")),
    readJsonl(dataDir, "merkl-opportunity-alerts"),
    readJsonIfExists(join(dataDir, "merkl-canary-queue.json")),
    readJsonIfExists(join(dataDir, "merkl-portfolio-allocator-latest.json")),
  ]);
  const enrichedWrappedBtcLoopLiveProof = await stabilizeWrappedBtcLoopLiveProof({
    proof: wrappedBtcLoopLiveProof,
    capitalAuditReport,
  });

  const executorRuntime = await loadExecutorRuntime({ now });
  const dashboardStatus = buildDashboardStatus({
    routesRecords: state.routesRecords || [],
    quotes: state.quotes || [],
    failures: quoteFailures,
    gasSnapshots: state.gasSnapshots || [],
    gasFailures,
    priceSnapshots: state.priceSnapshots || [],
    updateSnapshots,
    updateAlerts,
    scoreSnapshot: state.scoreSnapshot || null,
    dexQuotes: state.dexQuotes || [],
    dexFailures,
    bitcoinFeeSnapshots: state.bitcoinFeeSnapshots || [],
    gatewayGasEstimates: state.gasEstimateSnapshots || [],
    gatewayGasEstimateFailures: gasEstimateFailures,
    estimatorWalletReadiness: state.readinessRecords || [],
    estimatorWalletReadinessFailures: state.readinessFailures || [],
    shadowObservations: state.shadowObservations || [],
    shadowCycle,
    advanceCanary,
    preliveSimulationRuns,
    preliveForkPlan,
    preliveForkSubmissions,
    preliveForkReceipts,
    receiptReconciliations,
    executionEvents,
    shadowRefreshExecutions,
    shadowRefreshBatches,
    connectedRefreshRuns,
    currentRoutePrelivePasses,
    preliveEvidenceCampaigns,
    quoteLagLatest,
    dexSpreadLatest,
    thresholdSensitivity,
    triangleArtifacts,
    executorRuntime,
    promotionReport,
  }, { now });

  // P1/P2 parity floor injection — deterministic, pure slices
  const chainParity = buildChainParitySlice();
  const strategyTickStatus =
    (await readJsonIfExists(join(dataDir, "..", "dashboard", "public", "strategy-tick-status.json"))) ||
    (await readJsonIfExists(join(dataDir, "..", "..", "dashboard", "public", "strategy-tick-status.json"))) ||
    null;
  const strategyParity = buildStrategyParitySlice({
    deterministicCandidates: deterministicStrategyCandidates,
    secondaryStrategyScaffolds,
    researchBoard: strategyResearchBoard,
    strategyTickStatus,
  });
  dashboardStatus.strategy.chainParity = chainParity;
  dashboardStatus.strategy.strategyParity = strategyParity;
  dashboardStatus.strategy.promotionSummary = dashboardStatus.promotion;
  dashboardStatus.strategy.microCanarySummary =
    strategyTickStatus?.microCanary || { total: 0, byStrategy: {} };

  const canaryInputs = buildCanaryInputSummary(state, { now: dashboardStatus.generatedAt });
  dashboardStatus.canaryInputs = canaryInputs;
  dashboardStatus.payback = await buildPaybackDashboardSlice({
    dataDir,
    now: dashboardStatus.generatedAt,
  });
  const canarySelectionGap = buildCanarySelectionGap({
    routePlan: state.routePlan,
    edgeViability: dashboardStatus.strategy?.edgeViability || null,
    canaryInputs,
    scoreSnapshot: state.scoreSnapshot || null,
  });
  dashboardStatus.strategy.canarySelectionGap = canarySelectionGap;
  dashboardStatus.strategy.merklOpportunitySummary = summarizeMerklOpportunityStatus(
    merklOpportunityReport,
    merklOpportunityAlerts,
  );
  dashboardStatus.strategy.merklCanaryQueueSummary = summarizeMerklCanaryQueueStatus(merklCanaryQueue);
  dashboardStatus.strategy.merklActivePositions = buildMerklActivePositions(merklPositionEvents, {
    generatedAt: dashboardStatus.generatedAt,
    aprByOpportunity: buildMerklAprMap(merklPortfolioAllocatorLatest),
  });
  dashboardStatus.walletHoldings = buildTreasuryHoldingsSlice(treasuryInventoryRecords, {
    generatedAt: dashboardStatus.generatedAt,
    merklPositionEvents,
    wholeWalletRecords: wholeWalletInventoryRecords,
  });
  dashboardStatus.capitalSummary = buildCapitalSummarySlice({
    walletHoldings: dashboardStatus.walletHoldings,
    merklActivePositions: dashboardStatus.strategy.merklActivePositions,
    generatedAt: dashboardStatus.generatedAt,
  });
  dashboardStatus.operations = {
    allChainAutopilot: buildAllChainAutopilotDashboardSlice(allChainAutopilotLatest),
  };
  dashboardStatus.flow = buildFlowDashboardSlice({
    executionEvents,
    merklPositionEvents,
    signerAuditRecords,
    payback: dashboardStatus.payback,
    capitalSummary: dashboardStatus.capitalSummary,
    btcUsd: dashboardStatus.market?.btcUsd ?? null,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    generatedAt: dashboardStatus.generatedAt,
  });
  dashboardStatus.dataCounts.merklOpportunityReportPresent = merklOpportunityReport ? 1 : 0;
  dashboardStatus.dataCounts.merklOpportunityAlertCount = merklOpportunityAlerts.length;
  dashboardStatus.dataCounts.merklCanaryQueuePresent = merklCanaryQueue ? 1 : 0;
  dashboardStatus.dataCounts.merklActivePositionCount =
    dashboardStatus.strategy.merklActivePositions?.activeCount ?? 0;
  dashboardStatus.dataCounts.treasuryInventoryRecords = treasuryInventoryRecords.length;
  dashboardStatus.dataCounts.capitalSummaryPresent = 1;
  dashboardStatus.dataCounts.allChainAutopilotPresent = allChainAutopilotLatest ? 1 : 0;
  dashboardStatus.dataCounts.flowPresent = dashboardStatus.flow ? 1 : 0;
  const freshObjectivePlans = buildObjectivePlans({
    routePlan: state.routePlan,
    canaryInputs,
    scoreSnapshot: state.scoreSnapshot || null,
    shadowObservations: state.shadowObservations || [],
    dexQuotes: state.dexQuotes || [],
    address: state.address,
  });
  if (dashboardStatus.shadowCycle) {
    dashboardStatus.shadowCycle = {
      ...dashboardStatus.shadowCycle,
      objectivePlans: freshObjectivePlans,
    };
  }
  const strategySnapshot = buildStrategySnapshot({
    dashboardStatus,
    state,
    triangleArtifacts,
    phase1Revalidation: {
      overfitAuditArtifact,
      gasSlippageVariance,
      laneReclassification,
    },
    strategyResearchBoard,
    secondaryStrategyScaffolds,
    deterministicStrategyCandidates,
  });
  const protocolTrustTiers = buildProtocolTrustTiers({
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    secondaryStrategyScaffolds,
    now: dashboardStatus.generatedAt,
  });
  const searchComplexityBudgets = buildSearchComplexityBudgets({
    secondaryStrategyScaffolds,
    now: dashboardStatus.generatedAt,
  });
  const phase3StrategyValidation = buildPhase3StrategyValidation({
    laneReclassification,
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRun,
    wrappedBtcLoopOosEvidence,
    wrappedBtcLoopLiveProof: enrichedWrappedBtcLoopLiveProof,
    recursiveWrappedBtcLoop,
    recursiveWrappedBtcLoopDryRun,
    recursiveStablecoinLoop,
    recursiveStablecoinLoopDryRun,
    secondaryStrategyScaffolds,
    protocolTrustTiers,
    resolveTrustTierDecision,
    searchComplexityBudgets,
    resolveSearchComplexityBudget,
    now: dashboardStatus.generatedAt,
  });
  const protocolMarketWatchers = buildProtocolMarketWatchers({
    dashboardStatus,
    quoteLagLatest,
    dexSpreadLatest,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    phase3Validation: phase3StrategyValidation,
    protocolTrustTiers,
    secondaryStrategyScaffolds,
    now: dashboardStatus.generatedAt,
  });
  const allocatorCore = buildAllocatorCore({
    strategySnapshot,
    phase3Validation: phase3StrategyValidation,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    secondaryStrategyScaffolds,
    protocolMarketWatchers,
    destinationPromotionGate,
    destinationStrategyRegistry,
    now: dashboardStatus.generatedAt,
  });
  strategySnapshot.summary.phase3ValidationCount = phase3StrategyValidation.summary?.validationCount ?? 0;
  strategySnapshot.summary.phase3PassedCount = phase3StrategyValidation.summary?.passedCount ?? 0;
  strategySnapshot.summary.phase3TopBlockedId = phase3StrategyValidation.summary?.topBlockedId || null;
  strategySnapshot.summary.allocatorCandidateCount = allocatorCore.summary?.candidateCount ?? 0;
  strategySnapshot.summary.allocatorTopPlanningCandidateId = allocatorCore.summary?.topPlanningCandidateId || null;
  strategySnapshot.summary.trustTierRecordedCount = protocolTrustTiers.summary?.recordedCount ?? 0;
  strategySnapshot.summary.watcherBlockedCount = protocolMarketWatchers.summary?.blockedCount ?? 0;
  strategySnapshot.summary.watcherTopBlockedId = protocolMarketWatchers.summary?.topBlockedId || null;
  strategySnapshot.planningLayers.protocolTrustTiers = summarizeProtocolTrustTiers(protocolTrustTiers);
  strategySnapshot.planningLayers.phase3StrategyValidation = summarizePhase3StrategyValidation(phase3StrategyValidation);
  strategySnapshot.planningLayers.allocatorCore = summarizeAllocatorCore(allocatorCore);
  strategySnapshot.planningLayers.protocolMarketWatchers = summarizeProtocolMarketWatchers(protocolMarketWatchers);
  dashboardStatus.strategy.strategySnapshot = summarizeStrategySnapshot(strategySnapshot);
  let reviewPackage = buildPreliveReviewPackage({
    dashboardStatus,
    canaryInputs,
    canarySelectionGap,
    nextStep: state.nextStep,
    advanceCanary: dashboardStatus.canaryAdvance || null,
    address: state.address,
    strategySnapshot: dashboardStatus.strategy.strategySnapshot,
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRun,
    recursiveWrappedBtcLoop,
    recursiveWrappedBtcLoopDryRun,
    recursiveStablecoinLoop,
    recursiveStablecoinLoopDryRun,
    phase3Validation: phase3StrategyValidation,
    protocolMarketWatchers,
    destinationAllocationPlan,
    destinationPromotionGate,
  });
  dashboardStatus.prelive.reviewPackage = summarizePreliveReviewPackage(reviewPackage);
  dashboardStatus.dataCounts.preliveReviewPackagePresent = dashboardStatus.prelive.reviewPackage ? 1 : 0;
  let evidenceCampaign = buildPreliveEvidenceCampaign({
    reviewPackage,
    shadowRefreshBatchSummary: dashboardStatus?.shadowCycle?.refreshBatch || null,
    simulationRuns: preliveSimulationRuns,
    forkExecutionPlans: preliveForkPlan?.plans || [],
    forkExecutionSubmissions: preliveForkSubmissions,
    forkExecutionReceipts: preliveForkReceipts,
  });
  reviewPackage.remediationPlan = buildAdmissionRemediationPlan({
    reviewPackage,
    evidenceCampaign,
    address: state.address,
    advanceCanary,
  });
  let connectedRefreshPackage = buildConnectedRefreshPackage({
    dashboardStatus,
    canaryInputs,
    reviewPackage,
    nextStep: state.nextStep,
    address: state.address,
  });
  let executionRunbook = buildExecutionRunbook({
    dashboardStatus,
    reviewPackage,
    strategySnapshot,
    canaryInputs,
    nextStep: state.nextStep,
    forkPlan: preliveForkPlan,
    address: state.address,
  });
  let exactRouteForkPackage = buildExactRouteForkPackage({
    dashboardStatus,
    canaryInputs,
    reviewPackage,
    nextStep: state.nextStep,
    forkPlan: preliveForkPlan,
    simulationRuns: preliveSimulationRuns,
    submissions: preliveForkSubmissions,
    receipts: preliveForkReceipts,
    connectedRefreshPackage,
  });
  dashboardStatus.prelive.executionRunbook = summarizeExecutionRunbook(executionRunbook);
  let preliveValidation = buildPreliveValidationReport({
    dashboardStatus,
    strategySnapshot,
    executionRunbook,
    reviewPackage,
    connectedRefreshPackage,
    exactRouteForkPackage,
  });
  dashboardStatus.prelive.validation = summarizePreliveValidationReport(preliveValidation);
  let milestoneValidationGates = buildMilestoneValidationGates({
    phase1Revalidation: strategySnapshot?.planningLayers?.phase1Revalidation || null,
    strategyResearchBoard: strategySnapshot?.planningLayers?.strategyResearchBoard || null,
    flashFloorDecision,
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRun,
    recursiveWrappedBtcLoop,
    recursiveWrappedBtcLoopDryRun,
    recursiveStablecoinLoop,
    recursiveStablecoinLoopDryRun,
    phase3Validation: phase3StrategyValidation,
    protocolMarketWatchers,
    allocatorCore,
    preliveValidation,
    now: dashboardStatus.generatedAt,
  });
  strategySnapshot.summary.milestoneOverallStatus = milestoneValidationGates.summary?.overallStatus || null;
  strategySnapshot.summary.milestoneNextGateId = milestoneValidationGates.summary?.nextGateId || null;
  strategySnapshot.planningLayers.milestoneValidationGates = summarizeMilestoneValidationGates(milestoneValidationGates);
  strategySnapshot.artifacts.source.push({ kind: "milestone_validation_gates", path: "data/milestone-validation-gates.json" });
  dashboardStatus.strategy.strategySnapshot = summarizeStrategySnapshot(strategySnapshot);
  dashboardStatus.strategy.milestoneValidationGates = summarizeMilestoneValidationGates(milestoneValidationGates);
  let operationalJudgmentReview = buildOperationalJudgmentReview({
    dashboardStatus,
    strategySnapshot,
    reviewPackage,
    executionRunbook,
    preliveValidation,
    connectedRefreshPackage,
    exactRouteForkPackage,
  });
  dashboardStatus.prelive.connectedRefresh = summarizeConnectedRefreshPackage(connectedRefreshPackage);
  dashboardStatus.prelive.connectedRefreshExecution = buildConnectedRefreshExecutionSummary(
    connectedRefreshRuns,
    dashboardStatus.generatedAt,
  );
  dashboardStatus.prelive.currentRoutePrelivePass = buildCurrentRoutePrelivePassSummary(
    currentRoutePrelivePasses,
    dashboardStatus.generatedAt,
  );
  dashboardStatus.prelive.exactRouteForkPackage = summarizeExactRouteForkPackage(exactRouteForkPackage);
  dashboardStatus.prelive.operationalJudgmentReview = summarizeOperationalJudgmentReview(operationalJudgmentReview);
  dashboardStatus.prelive = {
    ...dashboardStatus.prelive,
    ...buildPreliveReadinessSummary({
      overall: dashboardStatus.overall || {},
      audit: dashboardStatus.audit || null,
      shadowCycle: dashboardStatus.shadowCycle || shadowCycle,
      strategy: dashboardStatus.strategy || null,
      reviewPackage,
      simulationRuns: preliveSimulationRuns,
      walletReadinessRecords: state.readinessRecords || [],
      forkExecutionPlans: preliveForkPlan?.plans || [],
      forkExecutionSubmissions: preliveForkSubmissions,
      forkExecutionReceipts: preliveForkReceipts,
      executionEvents,
    }),
  };

  // Second pass: readiness depends on the selected review candidate, while the
  // review package/runbook must display the final readiness stage.
  reviewPackage = buildPreliveReviewPackage({
    dashboardStatus,
    canaryInputs,
    canarySelectionGap,
    nextStep: state.nextStep,
    advanceCanary: dashboardStatus.canaryAdvance || null,
    address: state.address,
    strategySnapshot: dashboardStatus.strategy.strategySnapshot,
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRun,
    recursiveWrappedBtcLoop,
    recursiveWrappedBtcLoopDryRun,
    recursiveStablecoinLoop,
    recursiveStablecoinLoopDryRun,
    phase3Validation: phase3StrategyValidation,
    protocolMarketWatchers,
    destinationAllocationPlan,
    destinationPromotionGate,
  });
  dashboardStatus.prelive.reviewPackage = summarizePreliveReviewPackage(reviewPackage);
  evidenceCampaign = buildPreliveEvidenceCampaign({
    reviewPackage,
    shadowRefreshBatchSummary: dashboardStatus?.shadowCycle?.refreshBatch || null,
    simulationRuns: preliveSimulationRuns,
    forkExecutionPlans: preliveForkPlan?.plans || [],
    forkExecutionSubmissions: preliveForkSubmissions,
    forkExecutionReceipts: preliveForkReceipts,
  });
  reviewPackage.remediationPlan = buildAdmissionRemediationPlan({
    reviewPackage,
    evidenceCampaign,
    address: state.address,
    advanceCanary,
  });
  connectedRefreshPackage = buildConnectedRefreshPackage({
    dashboardStatus,
    canaryInputs,
    reviewPackage,
    nextStep: state.nextStep,
    address: state.address,
  });
  executionRunbook = buildExecutionRunbook({
    dashboardStatus,
    reviewPackage,
    strategySnapshot,
    canaryInputs,
    nextStep: state.nextStep,
    forkPlan: preliveForkPlan,
    address: state.address,
  });
  exactRouteForkPackage = buildExactRouteForkPackage({
    dashboardStatus,
    canaryInputs,
    reviewPackage,
    nextStep: state.nextStep,
    forkPlan: preliveForkPlan,
    simulationRuns: preliveSimulationRuns,
    submissions: preliveForkSubmissions,
    receipts: preliveForkReceipts,
    connectedRefreshPackage,
  });
  dashboardStatus.prelive.executionRunbook = summarizeExecutionRunbook(executionRunbook);
  preliveValidation = buildPreliveValidationReport({
    dashboardStatus,
    strategySnapshot,
    executionRunbook,
    reviewPackage,
    connectedRefreshPackage,
    exactRouteForkPackage,
  });
  dashboardStatus.prelive.validation = summarizePreliveValidationReport(preliveValidation);
  milestoneValidationGates = buildMilestoneValidationGates({
    phase1Revalidation: strategySnapshot?.planningLayers?.phase1Revalidation || null,
    strategyResearchBoard: strategySnapshot?.planningLayers?.strategyResearchBoard || null,
    flashFloorDecision,
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRun,
    recursiveWrappedBtcLoop,
    recursiveWrappedBtcLoopDryRun,
    recursiveStablecoinLoop,
    recursiveStablecoinLoopDryRun,
    phase3Validation: phase3StrategyValidation,
    protocolMarketWatchers,
    allocatorCore,
    preliveValidation,
    now: dashboardStatus.generatedAt,
  });
  strategySnapshot.summary.milestoneOverallStatus = milestoneValidationGates.summary?.overallStatus || null;
  strategySnapshot.summary.milestoneNextGateId = milestoneValidationGates.summary?.nextGateId || null;
  strategySnapshot.planningLayers.milestoneValidationGates = summarizeMilestoneValidationGates(milestoneValidationGates);
  dashboardStatus.strategy.strategySnapshot = summarizeStrategySnapshot(strategySnapshot);
  dashboardStatus.strategy.milestoneValidationGates = summarizeMilestoneValidationGates(milestoneValidationGates);
  operationalJudgmentReview = buildOperationalJudgmentReview({
    dashboardStatus,
    strategySnapshot,
    reviewPackage,
    executionRunbook,
    preliveValidation,
    connectedRefreshPackage,
    exactRouteForkPackage,
  });
  dashboardStatus.prelive.connectedRefresh = summarizeConnectedRefreshPackage(connectedRefreshPackage);
  dashboardStatus.prelive.exactRouteForkPackage = summarizeExactRouteForkPackage(exactRouteForkPackage);
  dashboardStatus.prelive.operationalJudgmentReview = summarizeOperationalJudgmentReview(operationalJudgmentReview);

  dashboardStatus.liveBaseline = buildLiveBaselineSummary({
    dashboardStatus,
    nextStep: state.nextStep,
  });
  dashboardStatus.overall = applyLaneAwareLivePolicy({
    overall: dashboardStatus.overall,
    audit: dashboardStatus.audit,
    reviewPackage: dashboardStatus.prelive.reviewPackage,
    prelive: dashboardStatus.prelive,
    liveBaseline: dashboardStatus.liveBaseline,
    edgeViability: dashboardStatus.strategy?.edgeViability,
  });
  dashboardStatus.prelive.liveTradingPolicy = dashboardStatus.overall.liveTrading;
  reviewPackage.liveDecision =
    dashboardStatus.overall.liveTrading === "ALLOWED" ? "LIVE_EXECUTION_ALLOWED" : "LIVE_EXECUTION_BLOCKED";
  reviewPackage.liveBlockers = dashboardStatus.overall.blockers || [];
  reviewPackage.tinyCanaryAdmission = reconcileTinyCanaryAdmissionWithLivePolicy(
    reviewPackage.tinyCanaryAdmission,
    dashboardStatus.overall,
  );
  reviewPackage.liveTradingPolicy = dashboardStatus.overall.liveTrading;
  reviewPackage.remediationPlan = buildAdmissionRemediationPlan({
    reviewPackage,
    evidenceCampaign,
    address: state.address,
    advanceCanary,
  });
  executionRunbook = buildExecutionRunbook({
    dashboardStatus,
    reviewPackage,
    strategySnapshot,
    canaryInputs,
    nextStep: state.nextStep,
    forkPlan: preliveForkPlan,
    address: state.address,
  });
  dashboardStatus.prelive.executionRunbook = summarizeExecutionRunbook(executionRunbook);
  preliveValidation = buildPreliveValidationReport({
    dashboardStatus,
    strategySnapshot,
    executionRunbook,
    reviewPackage,
    connectedRefreshPackage,
    exactRouteForkPackage,
  });
  operationalJudgmentReview = buildOperationalJudgmentReview({
    dashboardStatus,
    strategySnapshot,
    reviewPackage,
    executionRunbook,
    preliveValidation,
    connectedRefreshPackage,
    exactRouteForkPackage,
  });
  dashboardStatus.prelive.validation = summarizePreliveValidationReport(preliveValidation);
  dashboardStatus.prelive.operationalJudgmentReview = summarizeOperationalJudgmentReview(operationalJudgmentReview);
  reviewPackage.preliveValidation = dashboardStatus.prelive.validation;
  reviewPackage.operationalJudgmentReview = operationalJudgmentReview;
  dashboardStatus.prelive.reviewPackage = summarizePreliveReviewPackage(reviewPackage);
  dashboardStatus.liveBaseline = buildLiveBaselineSummary({
    dashboardStatus,
    nextStep: state.nextStep,
  });
  dashboardStatus.dataCounts.liveBaselinePresent = dashboardStatus.liveBaseline ? 1 : 0;
  const productCoverage = buildProductPlanningCoverage({
    dashboardStatus,
    strategySnapshot,
  });
  strategySnapshot.summary.productCoverageReadyCount = productCoverage?.readyCount ?? 0;
  strategySnapshot.summary.productCoverageBlockedCount = productCoverage?.blockedCount ?? 0;
  strategySnapshot.summary.productCoverageMissingCount = productCoverage?.missingCount ?? 0;
  strategySnapshot.summary.productCoverageTopGapId = productCoverage?.topGap?.id || null;
  strategySnapshot.planningLayers.productCoverage = productCoverage;
  dashboardStatus.strategy.strategySnapshot = summarizeStrategySnapshot(strategySnapshot);
  dashboardStatus.prelive.v1InfraDrills = summarizeV1InfraDrills(v1InfraDrills);
  dashboardStatus.dataCounts.v1InfraDrillsPresent = dashboardStatus.prelive.v1InfraDrills ? 1 : 0;
  reviewPackage.strategySnapshot = dashboardStatus.strategy.strategySnapshot;
  reviewPackage.executionRunbook = dashboardStatus.prelive.executionRunbook;
  reviewPackage.preliveValidation = dashboardStatus.prelive.validation;
  reviewPackage.connectedRefreshPackage = connectedRefreshPackage;
  reviewPackage.connectedRefreshExecution = dashboardStatus.prelive.connectedRefreshExecution;
  reviewPackage.currentRoutePrelivePass = dashboardStatus.prelive.currentRoutePrelivePass;
  reviewPackage.exactRouteForkPackage = exactRouteForkPackage;
  reviewPackage.operationalJudgmentReview = operationalJudgmentReview;
  dashboardStatus.prelive.reviewPackage = summarizePreliveReviewPackage(reviewPackage);
  dashboardStatus.prelive.evidenceCampaign = {
    ...dashboardStatus.prelive.evidenceCampaign,
    nextAction: dashboardStatus.prelive.evidenceCampaign?.nextAction || evidenceCampaign.nextAction,
    current: summarizePreliveEvidenceCampaign(evidenceCampaign),
  };
  dashboardStatus.dataCounts.preliveEvidenceCampaignPresent = evidenceCampaign ? 1 : 0;

  return {
    state,
    dashboardStatus,
    canaryInputs,
    canarySelectionGap,
    reviewPackage,
    evidenceCampaign,
    strategySnapshot,
    connectedRefreshPackage,
    executionRunbook,
    exactRouteForkPackage,
    preliveValidation,
    operationalJudgmentReview,
    triangleArtifacts,
    artifacts: {
      quoteFailures,
      gasFailures,
      updateSnapshots,
      updateAlerts,
      dexFailures,
      gasEstimateFailures,
      shadowCycle,
      advanceCanary,
      preliveSimulationRuns,
      preliveForkPlan,
      preliveForkSubmissions,
      preliveForkReceipts,
      receiptReconciliations,
      executionEvents,
      shadowRefreshExecutions,
      shadowRefreshBatches,
      connectedRefreshRuns,
      currentRoutePrelivePasses,
      preliveEvidenceCampaigns,
      strategySnapshot,
      connectedRefreshPackage,
      executionRunbook,
      exactRouteForkPackage,
      preliveValidation,
      operationalJudgmentReview,
      destinationAllocationPlan,
      destinationPromotionGate,
      triangleArtifacts,
      overfitAuditArtifact,
      gasSlippageVariance,
      laneReclassification,
      strategyResearchBoard,
      secondaryStrategyScaffolds,
      deterministicStrategyCandidates,
      phase3StrategyValidation,
      allocatorCore,
      protocolTrustTiers,
      protocolMarketWatchers,
      flashFloorDecision,
      recursiveWrappedBtcLoop,
      recursiveWrappedBtcLoopDryRun,
      recursiveStablecoinLoop,
      recursiveStablecoinLoopDryRun,
      wrappedBtcLendingLoopSlice,
      wrappedBtcLoopDryRun,
      wrappedBtcLoopOosEvidence,
      milestoneValidationGates,
       v1InfraDrills,
       merklOpportunityReport,
       merklOpportunityAlerts,
       merklCanaryQueue,
       merklPositionEvents,
       treasuryInventoryRecords,
       allChainAutopilotLatest,
       wrappedBtcLoopLiveProof: enrichedWrappedBtcLoopLiveProof,
     },
   };
}
