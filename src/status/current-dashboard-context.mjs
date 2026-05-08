import { join } from "node:path";
import { config, getEnv } from "../config/env.mjs";
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
import { buildPaybackDashboardSlice } from "../executor/payback/dashboard.mjs";
import { evaluateStage } from "../executor/policy/stage-evaluator.mjs";
import { syncStageTransitionAudit } from "../executor/policy/stage-transition-audit.mjs";
import { buildPhase3StrategyValidation, summarizePhase3StrategyValidation } from "../strategy/phase3-strategy-validation.mjs";
import { buildProtocolMarketWatchers, summarizeProtocolMarketWatchers } from "../strategy/protocol-market-watchers.mjs";
import { buildProtocolTrustTiers, resolveTrustTierDecision, summarizeProtocolTrustTiers } from "../strategy/protocol-trust-tiers.mjs";
import { buildSearchComplexityBudgets, resolveSearchComplexityBudget } from "../strategy/search-complexity-budgets.mjs";
import { buildProductPlanningCoverage, buildStrategySnapshot, summarizeStrategySnapshot } from "../strategy/strategy-snapshot.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import {
  ABSOLUTE_FLOOR_SATS,
  MIN_PAYBACK_PCT_OF_CAPITAL,
} from "../config/payback.mjs";
import { buildChainHypothesisReport } from "../strategy/chain-hypothesis-evaluator.mjs";
import { buildStrategyReceiptDistribution } from "../strategy/strategy-receipt-distribution.mjs";
import { buildObjectivePlans } from "../strategy/objective-plans.mjs";
import { buildCanaryInputSummary } from "./canary-inputs.mjs";
import {
  buildAllChainAutopilotDashboardSlice,
  resolveUnresolvedRefillCount,
  resolveAllChainAutopilotReport,
} from "./all-chain-autopilot-slice.mjs";
import { buildCapitalSummarySlice } from "./capital-summary-slice.mjs";
import { buildAssetTrackingSlice } from "./asset-tracking-slice.mjs";
import { buildDashboardStatus } from "./dashboard-status.mjs";
import { buildChainParitySlice } from "./chain-parity-slice.mjs";
import { buildFlowDashboardSlice } from "./flow-slice.mjs";
import { buildIdleConsolidationSlice } from "./idle-consolidation-slice.mjs";
import { buildMerklActivePositions } from "./merkl-active-slice.mjs";
import { buildMerklUserRewardsSlice } from "./merkl-user-rewards-slice.mjs";
import { buildProtocolPositionMarksSlice } from "./protocol-position-marks-slice.mjs";
import { buildProtocolAprSlice } from "./protocol-apr-slice.mjs";
import { buildStrategyParitySlice } from "./strategy-parity-slice.mjs";
import { buildTreasuryHoldingsSlice } from "./treasury-holdings-slice.mjs";
import { buildSleeveProfileSlice } from "./sleeve-profile-slice.mjs";
import { loadExecutorRuntime } from "./executor-runtime.mjs";
import { buildLiveBaselineSummary } from "./live-baseline.mjs";
import { readReportingPnlBaseline } from "./reporting-pnl-baseline.mjs";
import { applyLaneAwareLivePolicy } from "./live-policy.mjs";
import { buildCanarySelectionGap } from "../strategy/canary-selection-gap.mjs";
import { summarizeDevAgentAutomationBridge } from "../strategy/dev-agent-automation-bridge.mjs";
import { summarizeV1InfraDrills } from "../prelive/v1-infra-drills.mjs";
import { stabilizeWrappedBtcLoopLiveProof } from "../strategy/wrapped-btc-loop-live-proof.mjs";
import { readRadarJsonl } from "../strategy/radar/jsonl.mjs";
import { buildRadarBoard } from "../strategy/radar/radar-board.mjs";
import { buildRadarCapGraduationReview } from "../strategy/radar/cap-graduation-review.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { buildAutoKillReplayStatus } from "../risk/auto-kill-replay.mjs";
import { merklUserRewardPolicy } from "../config/merkl-user-rewards.mjs";
import {
  activeProtocolPositions,
  latestProtocolMarksByPosition,
  mergeProtocolMarksIntoPositions,
} from "../treasury/protocol-position-ledger.mjs";

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
    inventoryReadyCount: summary.inventoryReadyCount ?? summary.executableNowCount ?? 0,
    autoEntryReadyCount: summary.autoEntryReadyCount ?? summary.autoExecutableNowCount ?? 0,
    executableNowCount: summary.executableNowCount ?? 0,
    autoExecutableNowCount: summary.autoExecutableNowCount ?? 0,
    executableNowStage: summary.executableNowStage || "inventory_ready_before_sizing_policy_and_signer",
    finalExecutionRequires: summary.finalExecutionRequires || [],
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

function buildMerklAprMap(allocatorLatest = null, merklCanaryQueue = null) {
  const allocations = Array.isArray(allocatorLatest?.allocations)
    ? allocatorLatest.allocations
    : Array.isArray(allocatorLatest?.plan?.allocations)
      ? allocatorLatest.plan.allocations
      : [];
  const map = {};
  const queueItems = Array.isArray(merklCanaryQueue?.queue)
    ? merklCanaryQueue.queue
    : Array.isArray(merklCanaryQueue?.items)
      ? merklCanaryQueue.items
      : [];
  for (const item of queueItems) {
    if (!item?.opportunityId) continue;
    if (!Number.isFinite(item.aprPct)) continue;
    map[item.opportunityId] = item.aprPct;
  }
  for (const item of allocations) {
    const queueItem = item?.queueItem || null;
    if (!queueItem?.opportunityId) continue;
    if (!Number.isFinite(queueItem.aprPct)) continue;
    if (Number.isFinite(map[queueItem.opportunityId])) continue;
    map[queueItem.opportunityId] = queueItem.aprPct;
  }
  return map;
}

export async function buildCurrentDashboardContext({
  dataDir = config.dataDir,
  logsDir = join(dataDir, "..", "logs"),
  address = null,
  syncStageAudit = true,
} = {}) {
  const now = new Date().toISOString();
  const state = await loadCanaryState({ address, dataDir });
  const autoKillOraclesPath = getEnv("AUTO_KILL_ORACLES_PATH", join(dataDir, "oracles", "btc-latest.json"));
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
    autonomousDiscoveryBoard,
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
    allChainAutopilotLatestCompleted,
    capitalManagerRefillJobsLatest,
    devAgentAutomationBridgeReport,
    evCostModel,
    treasuryInventoryRecords,
    wholeWalletInventoryRecords,
    merklPositionEvents,
    protocolPositionMarks,
    signerAuditRecords,
    radarObservations,
    radarEpisodes,
    radarPackets,
    radarCandidates,
    radarRealizationRecords,
    autoKillPriceSamples,
    autoKillActiveProtocols,
    autoKillCampaignStatus,
    autoKillOraclePayload,
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
    readJsonIfExists(join(dataDir, "autonomous-discovery-board.json")),
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
    readJsonIfExists(join(dataDir, "all-chain-autopilot-latest-completed.json")),
    readJsonIfExists(join(dataDir, "capital-manager-refill-jobs-latest.json")),
    readJsonIfExists(join(dataDir, "dev-agent-automation-bridge.json")),
    readJsonIfExists(join(dataDir, "policy", "ev-cost-model.json")),
    readJsonl(dataDir, "treasury-inventory"),
    readJsonl(dataDir, "whole-wallet-inventory"),
    readJsonl(dataDir, "merkl-portfolio-positions"),
    readJsonl(dataDir, "protocol-position-marks"),
    readSignerAuditLog(),
    readRadarJsonl(dataDir, "opportunity-observations"),
    readRadarJsonl(dataDir, "strategy-episodes"),
    readRadarJsonl(dataDir, "portable-packets"),
    readRadarJsonl(dataDir, "executable-candidates"),
    readRadarJsonl(dataDir, "realization-records"),
    readJsonIfExists(join(dataDir, "price-samples.json")),
    readJsonIfExists(join(dataDir, "active-protocols.json")),
    readJsonIfExists(join(dataDir, "campaign-status.json")),
    readJsonIfExists(autoKillOraclesPath),
  ]);
  const [merklOpportunityReport, merklOpportunityAlerts, merklCanaryQueue, merklPortfolioAllocatorLatest, campaignAwareOpportunities, anchorPositionHealth, merklUserRewardsLatest] = await Promise.all([
    readJsonIfExists(join(dataDir, "merkl-opportunities-report.json")),
    readJsonl(dataDir, "merkl-opportunity-alerts"),
    readJsonIfExists(join(dataDir, "merkl-canary-queue.json")),
    readJsonIfExists(join(dataDir, "merkl-portfolio-allocator-latest.json")),
    readJsonIfExists(join(dataDir, "campaign-aware-opportunities.json")),
    readJsonIfExists(join(dataDir, "anchor-position-health.json")),
    readJsonIfExists(join(dataDir, "merkl-user-rewards-latest.json")),
  ]);
  const enrichedWrappedBtcLoopLiveProof = await stabilizeWrappedBtcLoopLiveProof({
    proof: wrappedBtcLoopLiveProof,
    capitalAuditReport,
  });

  const executorRuntime = await loadExecutorRuntime({ now });
  const reportingPnlBaseline = await readReportingPnlBaseline({ dataDir });
  const radarBoard = buildRadarBoard({
    observations: radarObservations,
    episodes: radarEpisodes,
    packets: radarPackets,
    candidates: radarCandidates,
    realizationRecords: radarRealizationRecords,
    generatedAt: now,
  });
  const radarCapReview = buildRadarCapGraduationReview({
    realizationRecords: radarRealizationRecords,
    now,
    strategyCapsById: Object.fromEntries(listStrategyCaps().map((config) => [config.strategyId, config])),
  });
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
     reportingPnlBaseline,
     campaignOpportunities: campaignAwareOpportunities || null,
     anchorPositions: anchorPositionHealth || null,
     radarBoard,
     radarCapReview,
   }, { now });

  // P1/P2 parity floor injection — deterministic, pure slices
  const chainParity = buildChainParitySlice();
  const strategyTickStatus =
    (await readJsonIfExists(join(dataDir, "..", "dashboard", "public", "strategy-tick-status.json"), {
      tolerateMalformed: true,
      retryCount: 2,
    })) ||
    (await readJsonIfExists(join(dataDir, "..", "..", "dashboard", "public", "strategy-tick-status.json"), {
      tolerateMalformed: true,
      retryCount: 2,
    })) ||
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
  dashboardStatus.strategy.receiptDistribution = buildStrategyReceiptDistribution({
    records: signerAuditRecords,
    now: dashboardStatus.generatedAt,
    expectedStrategies: listStrategyCaps()
      .filter((strategy) => strategy.autoExecute === true)
      .map((strategy) => strategy.strategyId),
  }).receiptDistribution;
  dashboardStatus.strategy.chainHypothesis = buildChainHypothesisReport({
    now: dashboardStatus.generatedAt,
  });

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
  dashboardStatus.strategy.devAgentAutomationBridge = devAgentAutomationBridgeReport
    ? {
        ...summarizeDevAgentAutomationBridge(devAgentAutomationBridgeReport),
        topTasks: (devAgentAutomationBridgeReport.tasks || []).slice(0, 3).map((task) => ({
          id: task.id || null,
          kind: task.kind || null,
          title: task.title || null,
          queueStatus: task.queueStatus || null,
          chain: task.chain || null,
          score: task.priority?.score ?? null,
          source: task.source || null,
          allowedToExecuteLive: task.safety?.allowedToExecuteLive === true,
        })),
      }
    : null;
  const activeMerklProtocolPositions = activeProtocolPositions(merklPositionEvents);
  const merklPositionDisplayEvents =
    activeMerklProtocolPositions.length > 0 ? activeMerklProtocolPositions : merklPositionEvents;
  dashboardStatus.strategy.protocolPositionMarks = buildProtocolPositionMarksSlice(protocolPositionMarks, {
    generatedAt: dashboardStatus.generatedAt,
    activePositionIds: activeMerklProtocolPositions.map((position) => position.positionId),
  });
  const mergedMerklPositionEvents = mergeProtocolMarksIntoPositions(
    merklPositionDisplayEvents,
    latestProtocolMarksByPosition(protocolPositionMarks),
  );
  dashboardStatus.strategy.merklActivePositions = buildMerklActivePositions(mergedMerklPositionEvents, {
    generatedAt: dashboardStatus.generatedAt,
    aprByOpportunity: buildMerklAprMap(merklPortfolioAllocatorLatest, merklCanaryQueue),
  });
  const rewardPolicy = merklUserRewardPolicy();
  dashboardStatus.strategy.merklUserRewards = merklUserRewardsLatest
    ? buildMerklUserRewardsSlice(merklUserRewardsLatest.rows || [], {
        generatedAt: dashboardStatus.generatedAt,
        minClaimUsd: rewardPolicy.minClaimUsd,
        maxClaimCostUsdByChainId: rewardPolicy.maxClaimCostUsdByChainId,
        distributorsByChainId: rewardPolicy.distributorsByChainId,
      })
    : null;
  const protocolApr = buildProtocolAprSlice({
    wrappedBtcLoopSlice: wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoopScaffold: recursiveWrappedBtcLoop,
  });
  dashboardStatus.walletHoldings = buildTreasuryHoldingsSlice(treasuryInventoryRecords, {
    generatedAt: dashboardStatus.generatedAt,
    merklPositionEvents,
    wholeWalletRecords: wholeWalletInventoryRecords,
    protocolApr,
  });
  const allChainAutopilotReport = resolveAllChainAutopilotReport(
    allChainAutopilotLatest,
    allChainAutopilotLatestCompleted,
  );
  dashboardStatus.capitalSummary = buildCapitalSummarySlice({
    walletHoldings: dashboardStatus.walletHoldings,
    merklActivePositions: dashboardStatus.strategy.merklActivePositions,
    protocolPositionMarks: dashboardStatus.strategy.protocolPositionMarks,
    executorEstimatedAssetValueUsd: allChainAutopilotReport?.summary?.capitalManager?.estimatedAssetValueUsd ?? null,
    signerAuditRecords,
    generatedAt: dashboardStatus.generatedAt,
  });
  dashboardStatus.assetTracking = buildAssetTrackingSlice({
    capitalSummary: dashboardStatus.capitalSummary,
    generatedAt: dashboardStatus.generatedAt,
  });
  const operatingCapitalUsd = dashboardStatus.capitalSummary?.totalUsd ?? null;
  dashboardStatus.operatingCapitalUsd = operatingCapitalUsd;
  dashboardStatus.operations = {
    allChainAutopilot: buildAllChainAutopilotDashboardSlice(allChainAutopilotReport),
  };
  const autoKillReplay = buildAutoKillReplayStatus({
    auditRecords: signerAuditRecords,
    executorRuntime,
    oraclePayload: autoKillOraclePayload,
    priceSamplesPayload: autoKillPriceSamples,
    anchorHealthPayload: anchorPositionHealth,
    activeProtocolsPayload: autoKillActiveProtocols,
    campaignStatusPayload: autoKillCampaignStatus,
    operatingCapitalUsd: dashboardStatus.capitalSummary?.totalUsd ?? null,
    now: dashboardStatus.generatedAt,
  });
  if (dashboardStatus.executorRuntime?.killSwitch) {
    dashboardStatus.executorRuntime.killSwitch.replay = autoKillReplay;
  }
  dashboardStatus.sleeveProfile = buildSleeveProfileSlice({
    generatedAt: dashboardStatus.generatedAt,
    operatingCapitalUsd,
  });
  dashboardStatus.capitalScaleBandId = dashboardStatus.sleeveProfile.capitalScaleBandId;
  dashboardStatus.capitalScaleMultiplier = dashboardStatus.sleeveProfile.capitalScaleMultiplier;
  dashboardStatus.nominalBudgets = dashboardStatus.sleeveProfile.nominalBudgets;
  dashboardStatus.effectiveBudgets = dashboardStatus.sleeveProfile.effectiveBudgets;
  const minimumProgress = dashboardStatus.payback?.scheduler?.minimumPaybackProgress || null;
  dashboardStatus.payback.operatorSummary = {
    effectiveMinPaybackSats: minimumProgress?.minPaybackSats ?? null,
    pendingSats: dashboardStatus.payback?.accumulatorPendingSats ?? dashboardStatus.payback?.carry?.pendingSats ?? null,
    satsToMinimum: minimumProgress?.satsToMinimumPayback ?? dashboardStatus.payback?.carry?.remainingSatsToMinimum ?? null,
    minPaybackPctOfCapital: MIN_PAYBACK_PCT_OF_CAPITAL,
    absoluteFloorSats: ABSOLUTE_FLOOR_SATS,
  };
  dashboardStatus.payback.effectiveMinPaybackSats = dashboardStatus.payback.operatorSummary.effectiveMinPaybackSats;
  const stageEvaluation = evCostModel
    ? evaluateStage({
        marksSlice: dashboardStatus.strategy.protocolPositionMarks,
        capitalPlan: {
          unresolvedRefillRoutes: resolveUnresolvedRefillCount({
            report: allChainAutopilotReport,
            slice: dashboardStatus.operations.allChainAutopilot,
            capitalManagerRefillJobsLatest,
          }),
          payback: dashboardStatus.payback || null,
        },
        evGateStats: {
          calibrated:
            (evCostModel?.summary?.matchedReceiptCount ?? 0) > 0 &&
            (evCostModel?.summary?.keyedEntryCount ?? 0) > 0,
          matchedReceiptCount: evCostModel?.summary?.matchedReceiptCount ?? 0,
          keyedEntryCount: evCostModel?.summary?.keyedEntryCount ?? 0,
          lookbackDays: evCostModel?.lookbackDays ?? null,
        },
      })
    : null;
  if (syncStageAudit) {
    await syncStageTransitionAudit({
      logsDir,
      stageEvaluation,
      observedAt: dashboardStatus.generatedAt,
    });
  }
  dashboardStatus.strategy.reopenStage = stageEvaluation;
  dashboardStatus.flow = buildFlowDashboardSlice({
    executionEvents,
    merklPositionEvents,
    merklActivePositions: dashboardStatus.strategy.merklActivePositions,
    signerAuditRecords,
    payback: dashboardStatus.payback,
    capitalSummary: dashboardStatus.capitalSummary,
    btcUsd: dashboardStatus.market?.btcUsd ?? null,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    generatedAt: dashboardStatus.generatedAt,
  });
  dashboardStatus.idleConsolidation = buildIdleConsolidationSlice({
    auditRecords: signerAuditRecords,
    now: dashboardStatus.generatedAt,
  });
  dashboardStatus.dataCounts.merklOpportunityReportPresent = merklOpportunityReport ? 1 : 0;
  dashboardStatus.dataCounts.merklOpportunityAlertCount = merklOpportunityAlerts.length;
  dashboardStatus.dataCounts.merklCanaryQueuePresent = merklCanaryQueue ? 1 : 0;
  dashboardStatus.dataCounts.merklUserRewardsPresent = merklUserRewardsLatest ? 1 : 0;
  dashboardStatus.dataCounts.merklUserRewardCount =
    dashboardStatus.strategy.merklUserRewards?.rewardCount ?? 0;
  dashboardStatus.dataCounts.merklActivePositionCount =
    dashboardStatus.strategy.merklActivePositions?.activeCount ?? 0;
  dashboardStatus.dataCounts.protocolPositionMarkCount = protocolPositionMarks.length;
  dashboardStatus.dataCounts.devAgentAutomationTaskCount =
    dashboardStatus.strategy.devAgentAutomationBridge?.taskCount ?? 0;
  dashboardStatus.dataCounts.treasuryInventoryRecords = treasuryInventoryRecords.length;
  dashboardStatus.dataCounts.capitalSummaryPresent = 1;
  dashboardStatus.dataCounts.allChainAutopilotPresent = allChainAutopilotReport ? 1 : 0;
  dashboardStatus.dataCounts.flowPresent = dashboardStatus.flow ? 1 : 0;
  dashboardStatus.dataCounts.idleConsolidationPlanned7d =
    dashboardStatus.idleConsolidation?.plannedCount7d ?? 0;
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
    autonomousDiscoveryBoard,
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
    wholeWalletRecords: wholeWalletInventoryRecords,
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
  dashboardStatus.strategy.strategySnapshot = summarizeStrategySnapshot(strategySnapshot);
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
    wholeWalletRecords: wholeWalletInventoryRecords,
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
  dashboardStatus.strategy.strategySnapshot = summarizeStrategySnapshot(strategySnapshot);
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
    stageEvaluation,
    executorRuntime: dashboardStatus.executorRuntime,
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
      autonomousDiscoveryBoard,
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
       v1InfraDrills,
       merklOpportunityReport,
       merklOpportunityAlerts,
       merklCanaryQueue,
       merklPositionEvents,
       signerAuditRecords,
       treasuryInventoryRecords,
       allChainAutopilotLatest,
       radarBoard,
       wrappedBtcLoopLiveProof: enrichedWrappedBtcLoopLiveProof,
     },
   };
}
