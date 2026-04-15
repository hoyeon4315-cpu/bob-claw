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
import { buildPreliveValidationReport, summarizePreliveValidationReport } from "../prelive/prelive-validation.mjs";
import { buildPreliveReviewPackage, summarizePreliveReviewPackage } from "../prelive/review-package.mjs";
import { readTriangleArtifacts } from "../flash/triangle-artifacts.mjs";
import { buildStrategySnapshot, summarizeStrategySnapshot } from "../strategy/strategy-snapshot.mjs";
import { buildCanaryInputSummary } from "./canary-inputs.mjs";
import { buildDashboardStatus } from "./dashboard-status.mjs";
import { buildCanarySelectionGap } from "../strategy/canary-selection-gap.mjs";

export async function buildCurrentDashboardContext({ dataDir = config.dataDir, address = null } = {}) {
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
  ]);

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
  });
  const canaryInputs = buildCanaryInputSummary(state, { now: dashboardStatus.generatedAt });
  dashboardStatus.canaryInputs = canaryInputs;
  const canarySelectionGap = buildCanarySelectionGap({
    routePlan: state.routePlan,
    edgeViability: dashboardStatus.strategy?.edgeViability || null,
    canaryInputs,
    scoreSnapshot: state.scoreSnapshot || null,
  });
  dashboardStatus.strategy.canarySelectionGap = canarySelectionGap;
  const strategySnapshot = buildStrategySnapshot({
    dashboardStatus,
    state,
    triangleArtifacts,
  });
  dashboardStatus.strategy.strategySnapshot = summarizeStrategySnapshot(strategySnapshot);
  const reviewPackage = buildPreliveReviewPackage({
    dashboardStatus,
    canaryInputs,
    canarySelectionGap,
    nextStep: state.nextStep,
    advanceCanary: dashboardStatus.canaryAdvance || null,
    address: state.address,
    strategySnapshot: dashboardStatus.strategy.strategySnapshot,
    destinationAllocationPlan,
    destinationPromotionGate,
  });
  dashboardStatus.prelive.reviewPackage = summarizePreliveReviewPackage(reviewPackage);
  dashboardStatus.dataCounts.preliveReviewPackagePresent = dashboardStatus.prelive.reviewPackage ? 1 : 0;
  const evidenceCampaign = buildPreliveEvidenceCampaign({
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
  });
  const connectedRefreshPackage = buildConnectedRefreshPackage({
    dashboardStatus,
    canaryInputs,
    reviewPackage,
    nextStep: state.nextStep,
    address: state.address,
  });
  const executionRunbook = buildExecutionRunbook({
    dashboardStatus,
    reviewPackage,
    strategySnapshot,
    canaryInputs,
    nextStep: state.nextStep,
    forkPlan: preliveForkPlan,
    address: state.address,
  });
  const exactRouteForkPackage = buildExactRouteForkPackage({
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
  const preliveValidation = buildPreliveValidationReport({
    dashboardStatus,
    strategySnapshot,
    executionRunbook,
    reviewPackage,
    connectedRefreshPackage,
    exactRouteForkPackage,
  });
  dashboardStatus.prelive.validation = summarizePreliveValidationReport(preliveValidation);
  const operationalJudgmentReview = buildOperationalJudgmentReview({
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
    },
  };
}
