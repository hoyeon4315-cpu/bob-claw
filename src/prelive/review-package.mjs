import { buildCanaryStageChecklist, buildExecutionStageSummary } from "../status/canary-inputs.mjs";
import { buildAdmissionRemediationPlan, summarizeAdmissionRemediationPlan } from "./admission-remediation.mjs";
import { buildTinyCanaryAdmission } from "./tiny-canary-admission.mjs";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function sameCandidate(candidate, canaryInputs) {
  if (!candidate || !canaryInputs) return false;
  if (candidate.label && canaryInputs.routeLabel && candidate.label === canaryInputs.routeLabel) {
    return String(candidate.amount) === String(canaryInputs.amount);
  }
  return false;
}

function matchedCanaryCandidate(dashboardStatus = null, canaryInputs = null) {
  return (dashboardStatus?.shadowCycle?.shadowRoster?.candidates || []).find((candidate) => sameCandidate(candidate, canaryInputs)) || null;
}

function freshnessSummary(canaryInputs = null) {
  if (!canaryInputs) return null;
  return {
    gatewayQuote: canaryInputs.gatewayQuote || null,
    exactGas: canaryInputs.exactGas || null,
    srcGas: canaryInputs.srcGas || null,
    dexQuote: canaryInputs.dexQuote || null,
    bitcoinFee: canaryInputs.bitcoinFee || null,
    marketSnapshot: canaryInputs.marketSnapshot || null,
  };
}

function buildManualReviewCandidate({ dashboardStatus = null, canaryInputs = null, matchedCandidate = null, nextStep = null, address = null } = {}) {
  const topRoute = dashboardStatus?.shadowCycle?.topRoute || null;
  const route = nextStep?.route || null;
  const routeLabel = canaryInputs?.routeLabel || matchedCandidate?.label || route?.label || topRoute?.label || null;
  const amount = canaryInputs?.amount || matchedCandidate?.amount || route?.amount || topRoute?.amount || null;
  if (!routeLabel && !amount && !canaryInputs?.routeKey) return null;
  return {
    address: address || null,
    routeKey: canaryInputs?.routeKey || route?.routeKey || null,
    routeLabel,
    amount,
    tradeReadiness: canaryInputs?.scoreTradeReadiness || matchedCandidate?.tradeReadiness || route?.tradeReadiness || topRoute?.tradeReadiness || null,
    netEdgeUsd: matchedCandidate?.netEdgeUsd ?? route?.netEdgeUsd ?? topRoute?.netEdgeUsd ?? null,
    prepFundingUsd: matchedCandidate?.prepFundingUsd ?? route?.prepFundingUsd ?? null,
    viableForPrep: matchedCandidate?.viableForPrep ?? route?.viableForPrep ?? null,
    txReady: matchedCandidate?.txReady ?? route?.txReady ?? null,
    blockerReasons: unique([
      ...(canaryInputs?.blockers || []),
      ...(matchedCandidate?.prepBlockers || []),
      ...(matchedCandidate?.scoreDisqualifiers || []),
      ...(nextStep?.reasons || []),
    ]),
    scoreDataGaps: canaryInputs?.scoreDataGaps || [],
    inputFreshness: freshnessSummary(canaryInputs),
    evidence: matchedCandidate?.evidence
      ? {
          quoteSampleCount: matchedCandidate.evidence.quoteSampleCount ?? 0,
          quoteFailureCount: matchedCandidate.evidence.quoteFailureCount ?? 0,
          quoteAttemptCount: matchedCandidate.evidence.quoteAttemptCount ?? 0,
          quoteSuccessRate: matchedCandidate.evidence.quoteSuccessRate ?? null,
          quoteLatencyP50Ms: matchedCandidate.evidence.quoteLatencyP50Ms ?? null,
          quoteLatencyP95Ms: matchedCandidate.evidence.quoteLatencyP95Ms ?? null,
          shadowObservationCount: matchedCandidate.evidence.shadowObservationCount ?? 0,
          latestObservedEdgeUsd: matchedCandidate.evidence.latestObservedEdgeUsd ?? null,
          latestKnownCostUsd: matchedCandidate.evidence.latestKnownCostUsd ?? null,
          latestExecutionGasUsd: matchedCandidate.evidence.latestExecutionGasUsd ?? null,
          latestRouteFailureRate: matchedCandidate.evidence.latestRouteFailureRate ?? null,
          latestTradeReadiness: matchedCandidate.evidence.latestTradeReadiness || null,
          rejectionReasons: matchedCandidate.evidence.rejectionReasons || [],
        }
      : null,
  };
}

function buildMeasuredLeaderReview({ canarySelectionGap = null, executionReview = null } = {}) {
  const measuredLeader = canarySelectionGap?.measuredLeader || null;
  const reviewPlan = canarySelectionGap?.reviewPlan || null;
  if (!measuredLeader?.routeKey && !executionReview?.routeKey) return null;
  return {
    selectionCode: canarySelectionGap?.selectionCode || executionReview?.selectionCode || null,
    selectionLabel: canarySelectionGap?.selectionLabel || executionReview?.selectionLabel || null,
    routeKey: measuredLeader?.routeKey || executionReview?.routeKey || null,
    routeLabel: measuredLeader?.label || executionReview?.routeLabel || null,
    amount: measuredLeader?.amount || executionReview?.amount || null,
    tradeReadiness: measuredLeader?.tradeReadiness || executionReview?.tradeReadiness || null,
    measuredNetUsd: measuredLeader?.measuredNetUsd ?? executionReview?.measuredNetUsd ?? null,
    executableNetUsd: measuredLeader?.executableNetUsd ?? executionReview?.executableNetUsd ?? null,
    viableForPrep: measuredLeader?.viableForPrep ?? null,
    txReady: measuredLeader?.txReady ?? null,
    exactGasDone: measuredLeader?.exactGasDone ?? null,
    reasons: canarySelectionGap?.reasonLabels || executionReview?.reasonLabels || [],
    blockers: canarySelectionGap?.blockerLabels || executionReview?.blockerLabels || executionReview?.blockers || [],
    nextActionCode: reviewPlan?.actionCodes?.[0] || executionReview?.nextActionCode || null,
    nextActionLabels: reviewPlan?.actionLabels || executionReview?.steps?.map((step) => step.label).filter(Boolean) || [],
    command: executionReview?.command || null,
    hypothesisGuard: canarySelectionGap?.hypothesisGuard || executionReview?.hypothesisGuard || null,
  };
}

function buildAntiOverfitCaveats({ dashboardStatus = null, measuredLeaderReview = null, readyForManualReview = false } = {}) {
  return unique([
    ...(dashboardStatus?.prelive?.notes || []),
    measuredLeaderReview?.hypothesisGuard || null,
    !readyForManualReview
      ? "Do not promote any route to canary or live execution while review blockers, stale inputs, or missing pre-live evidence remain."
      : null,
    dashboardStatus?.overall?.liveTrading === "BLOCKED"
      ? "liveTrading remains BLOCKED; this review package summarizes readiness and does not grant execution permission."
      : null,
    measuredLeaderReview && measuredLeaderReview.routeKey !== dashboardStatus?.canaryInputs?.routeKey
      ? "The measured leader and the current canary can diverge; keep them separate until the measured leader clears objective review."
      : null,
  ]);
}

export function buildPreliveReviewPackage({
  dashboardStatus = null,
  canaryInputs = null,
  canarySelectionGap = null,
  nextStep = null,
  advanceCanary = null,
  address = null,
  now = null,
} = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const effectiveStatus = canaryInputs ? { ...dashboardStatus, canaryInputs } : dashboardStatus;
  const executionStage = buildExecutionStageSummary({
    nextStep,
    dashboardStatus: effectiveStatus,
  });
  const checklist = buildCanaryStageChecklist({
    route: nextStep?.route || null,
    nextStep,
    inputSummary: canaryInputs,
    shadowCycle: dashboardStatus?.shadowCycle || null,
    advanceCanary: advanceCanary || dashboardStatus?.canaryAdvance || null,
  });
  const matchedCandidate = matchedCanaryCandidate(dashboardStatus, canaryInputs);
  const manualReviewCandidate = buildManualReviewCandidate({
    dashboardStatus,
    canaryInputs,
    matchedCandidate,
    nextStep,
    address,
  });
  const measuredLeaderReview = buildMeasuredLeaderReview({
    canarySelectionGap,
    executionReview: dashboardStatus?.shadowCycle?.objectivePlans?.executionReview || null,
  });
  const prelive = dashboardStatus?.prelive || {};
  const tinyCanaryAdmission = buildTinyCanaryAdmission({
    prelive,
    executionStage,
    manualReviewCandidate,
    overall: dashboardStatus?.overall || null,
  });
  const readyForManualReview = tinyCanaryAdmission.decision === "GO_FOR_MANUAL_APPROVAL";
  const reviewBlockers = readyForManualReview ? [] : tinyCanaryAdmission.blockers;
  const liveBlockers = unique([...(executionStage.liveReasons || []), ...(dashboardStatus?.overall?.blockers || [])]);

  const reviewPackage = {
    schemaVersion: 1,
    generatedAt,
    reviewScope: "tiny_live_canary",
    packageStatus: readyForManualReview ? "ready_for_manual_review" : "not_ready_for_manual_review",
    readyForManualReview,
    currentStage: prelive?.currentStage || null,
    reviewDecision: executionStage.reviewStage,
    reviewBlockers,
    liveDecision: executionStage.liveStage,
    liveBlockers,
    tinyCanaryAdmission,
    pivotDecision:
      dashboardStatus?.strategy?.pivotDecision ||
      dashboardStatus?.shadowCycle?.pivotDecision ||
      null,
    liveTradingPolicy: prelive?.liveTradingPolicy || dashboardStatus?.overall?.liveTrading || "BLOCKED",
    decisionContext: {
      currentDecision: nextStep?.decision || dashboardStatus?.canaryAdvance?.final?.decision || dashboardStatus?.shadowCycle?.canaryDecision || null,
      headline: nextStep?.headline || dashboardStatus?.canaryAdvance?.final?.headline || dashboardStatus?.shadowCycle?.headline || null,
      reasons: nextStep?.reasons || [],
    },
    manualReviewCandidate,
    measuredLeaderReview,
    operatorChecklist: checklist,
    preliveEvidence: {
      shadowReplay: prelive?.shadowReplay
        ? {
            status: prelive.shadowReplay.status || null,
            blockers: prelive.shadowReplay.blockers || [],
            auditDecision: prelive.shadowReplay.auditDecision || null,
            policyReadyMeasuredRoutes: prelive.shadowReplay.policyReadyMeasuredRoutes ?? 0,
          }
        : null,
      mechanicalSimulation: prelive?.mechanicalSimulation
        ? {
            status: prelive.mechanicalSimulation.status || null,
            blockers: prelive.mechanicalSimulation.blockers || [],
            successCount: prelive.mechanicalSimulation.successCount ?? 0,
            targetSuccessCount: prelive.mechanicalSimulation.targetSuccessCount ?? 0,
            failureCount: prelive.mechanicalSimulation.failureCount ?? 0,
          }
        : null,
      forkExecution: prelive?.forkExecution
        ? {
            status: prelive.forkExecution.status || null,
            blockers: prelive.forkExecution.blockers || [],
            planCount: prelive.forkExecution.planCount ?? 0,
            submittedCount: prelive.forkExecution.submittedCount ?? 0,
            confirmedCount: prelive.forkExecution.confirmedCount ?? 0,
            targetConfirmedCount: prelive.forkExecution.targetConfirmedCount ?? 0,
            failedCount: prelive.forkExecution.failedCount ?? 0,
            pendingOutputCount: prelive.forkExecution.pendingOutputCount ?? 0,
            realizedSampleCount: prelive.forkExecution.realizedSampleCount ?? 0,
            realizedNetPnlUsd: prelive.forkExecution.realizedNetPnlUsd ?? null,
            medianRealizedNetPnlUsd: prelive.forkExecution.medianRealizedNetPnlUsd ?? null,
            medianNetDriftUsd: prelive.forkExecution.medianNetDriftUsd ?? null,
            medianExecutionGasDriftUsd: prelive.forkExecution.medianExecutionGasDriftUsd ?? null,
            medianFillDriftBps: prelive.forkExecution.medianFillDriftBps ?? null,
            estimatedPositiveRealizedNegativeCount: prelive.forkExecution.estimatedPositiveRealizedNegativeCount ?? 0,
            latestPendingOutput: prelive.forkExecution.latestPendingOutput
              ? {
                  observedAt: prelive.forkExecution.latestPendingOutput.observedAt || null,
                  planId: prelive.forkExecution.latestPendingOutput.planId || null,
                  routeLabel: prelive.forkExecution.latestPendingOutput.routeLabel || null,
                  routeKey: prelive.forkExecution.latestPendingOutput.routeKey || null,
                  amount: prelive.forkExecution.latestPendingOutput.amount || null,
                  txHash: prelive.forkExecution.latestPendingOutput.txHash || null,
                  outputRequirements: prelive.forkExecution.latestPendingOutput.outputRequirements || null,
                  resolutionCommand: prelive.forkExecution.latestPendingOutput.resolutionCommand || null,
                }
              : null,
          }
        : null,
      executionAudit: prelive?.executionAudit
        ? {
            status: prelive.executionAudit.status || null,
            blockers: prelive.executionAudit.blockers || [],
            missingRecordCount: prelive.executionAudit.missingRecordCount ?? 0,
          }
        : null,
    },
    recentTransitions: prelive?.executionAudit?.recentTransitions || [],
    queueFollowUps: prelive?.nextActions || [],
    antiOverfitCaveats: buildAntiOverfitCaveats({
      dashboardStatus: effectiveStatus,
      measuredLeaderReview,
      readyForManualReview,
    }),
  };
  reviewPackage.remediationPlan = buildAdmissionRemediationPlan({
    reviewPackage,
    address,
  });
  return reviewPackage;
}

export function summarizePreliveReviewPackage(reviewPackage = null) {
  if (!reviewPackage) return null;
  return {
    generatedAt: reviewPackage.generatedAt || null,
    packageStatus: reviewPackage.packageStatus || null,
    readyForManualReview: Boolean(reviewPackage.readyForManualReview),
    currentStage: reviewPackage.currentStage || null,
    reviewDecision: reviewPackage.reviewDecision || null,
    reviewBlockers: reviewPackage.reviewBlockers || [],
    liveDecision: reviewPackage.liveDecision || null,
    liveBlockers: reviewPackage.liveBlockers || [],
    tinyCanaryAdmissionDecision: reviewPackage.tinyCanaryAdmission?.decision || null,
    tinyCanaryAdmissionStatus: reviewPackage.tinyCanaryAdmission?.status || null,
    tinyCanaryAdmissionBlockers: reviewPackage.tinyCanaryAdmission?.blockers || [],
    tinyCanaryAdmissionNextActionCode: reviewPackage.tinyCanaryAdmission?.nextActionCode || null,
    remediationPlan: summarizeAdmissionRemediationPlan(reviewPackage.remediationPlan || null),
    routeLabel: reviewPackage.manualReviewCandidate?.routeLabel || null,
    routeKey: reviewPackage.manualReviewCandidate?.routeKey || null,
    amount: reviewPackage.manualReviewCandidate?.amount || null,
    tradeReadiness: reviewPackage.manualReviewCandidate?.tradeReadiness || null,
    simulationSuccessCount: reviewPackage.preliveEvidence?.mechanicalSimulation?.successCount ?? 0,
    simulationTargetCount: reviewPackage.preliveEvidence?.mechanicalSimulation?.targetSuccessCount ?? 0,
    forkConfirmedCount: reviewPackage.preliveEvidence?.forkExecution?.confirmedCount ?? 0,
    forkTargetCount: reviewPackage.preliveEvidence?.forkExecution?.targetConfirmedCount ?? 0,
    recentTransitionCount: reviewPackage.recentTransitions?.length || 0,
    queueFollowUpCount: reviewPackage.queueFollowUps?.length || 0,
  };
}
