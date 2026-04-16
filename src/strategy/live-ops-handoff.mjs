import { buildWrappedBtcLoopReceiptGuide } from "./wrapped-btc-lending-loop-dry-run.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function buildPrimaryLiveLane(candidate, tinyLiveCanaryRollout = null, preliveValidation = null) {
  const strategyCandidate = candidate?.candidateType === "strategy";
  return {
    id: candidate?.candidateId || candidate?.routeKey || null,
    label: candidate?.candidateLabel || candidate?.routeLabel || null,
    kind: candidate?.candidateType || (candidate ? "route" : null),
    priority: "primary",
    promotionTarget: "first_live_promotion",
    status: candidate?.tradeReadiness || (candidate ? "candidate_selected" : "missing_candidate"),
    blockerReasons: unique(candidate?.blockerReasons || candidate?.evidenceBlockers || []),
    nextAction: strategyCandidate
      ? candidate?.nextAction || tinyLiveCanaryRollout?.summary?.nextAction || preliveValidation?.nextAction || null
      : candidate?.nextAction || null,
  };
}

function buildExactRouteLane(btcOnlyE2eDryRun = null, currentRoutePrelivePass = null, preliveValidation = null) {
  const blockedCount = btcOnlyE2eDryRun?.summary?.blockedCount ?? 0;
  const provenCount = currentRoutePrelivePass?.provenCount ?? 0;
  const laneStatus = blockedCount > 0 || provenCount === 0 ? "blocked" : "passed";
  return {
    id: btcOnlyE2eDryRun?.lane?.id || "btc_exact_route",
    label: btcOnlyE2eDryRun?.lane?.label || "BTC exact-route lane",
    priority: "secondary",
    promotionTarget: "blocked_secondary_lane",
    status: laneStatus,
    routeKey: btcOnlyE2eDryRun?.candidate?.routeKey || null,
    routeLabel: btcOnlyE2eDryRun?.candidate?.routeLabel || null,
    topBlockedStageId: btcOnlyE2eDryRun?.summary?.topStuckPointId || null,
    blockerReasons: unique([
      currentRoutePrelivePass?.latestStopReason || null,
      preliveValidation?.exactRouteForkEconomicStatus || null,
    ]),
    economicStatus: preliveValidation?.exactRouteForkEconomicStatus || null,
    technicalStatus: preliveValidation?.exactRouteForkTechnicalStatus || null,
    nextAction: currentRoutePrelivePass?.nextAction || btcOnlyE2eDryRun?.summary?.nextAction || null,
  };
}

export function buildLiveOpsHandoff({
  strategySnapshot = null,
  reviewPackage = null,
  preliveValidation = null,
  connectedRefresh = null,
  currentRoutePrelivePass = null,
  protocolMarketWatchers = null,
  btcOnlyE2eDryRun = null,
  tinyLiveCanaryRollout = null,
  operationalJudgmentReview = null,
  now = null,
} = {}) {
  const candidate = reviewPackage?.primaryLiveCandidate || reviewPackage?.manualReviewCandidate || reviewPackage?.tinyCanaryAdmission?.candidate || null;
  const primaryLiveLane = buildPrimaryLiveLane(candidate, tinyLiveCanaryRollout, preliveValidation);
  const blockedExactRouteLane = buildExactRouteLane(btcOnlyE2eDryRun, currentRoutePrelivePass, preliveValidation);
  const receiptIngestionGuide =
    candidate?.candidateType === "strategy" && unique(candidate?.blockerReasons || candidate?.evidenceBlockers || []).includes("signer_backed_oos_receipts_missing")
      ? buildWrappedBtcLoopReceiptGuide()
      : null;
  const actionChain =
    candidate?.candidateType === "strategy"
      ? [
          candidate?.nextAction?.command || null,
          "npm run report:tiny-live-canary-rollout -- --write",
          "npm run report:live-ops-handoff -- --write",
          "npm run write:session-handoff",
        ].filter(Boolean)
      : [
          connectedRefresh?.runnerExecuteCommand || null,
          "npm run run:current-route-prelive-pass -- --execute --write",
          "npm run report:tiny-live-canary-rollout -- --write",
          "npm run write:session-handoff",
        ].filter(Boolean);
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
      summary: {
        liveTrading: strategySnapshot?.currentSystem?.liveTrading || null,
        preliveStage: strategySnapshot?.currentSystem?.preliveStage || null,
        candidateType: candidate?.candidateType || "route",
        candidateId: candidate?.candidateId || candidate?.routeKey || null,
        candidateLabel: candidate?.candidateLabel || candidate?.routeLabel || null,
        candidateRouteKey: candidate?.routeKey || null,
        primaryLaneId: primaryLiveLane.id,
        primaryLaneLabel: primaryLiveLane.label,
        primaryLaneStatus: primaryLiveLane.status,
        primaryLanePromotionTarget: primaryLiveLane.promotionTarget,
        exactRouteLaneStatus: blockedExactRouteLane.status,
        exactRouteLanePriority: blockedExactRouteLane.priority,
        exactRouteLaneBlockedStageId: blockedExactRouteLane.topBlockedStageId,
        watcherBlockedCount: protocolMarketWatchers?.summary?.blockedCount ?? 0,
        e2eBlockedCount: btcOnlyE2eDryRun?.summary?.blockedCount ?? 0,
        canaryDecision: tinyLiveCanaryRollout?.summary?.decision || null,
        nextAction: primaryLiveLane.nextAction?.code || preliveValidation?.nextActionCode || connectedRefresh?.nextActionCode || null,
        nextActionCommand: primaryLiveLane.nextAction?.command || preliveValidation?.nextActionCommand || connectedRefresh?.nextActionCommand || null,
      },
      operatorChecklist: reviewPackage?.operatorChecklist || null,
      candidate,
      primaryLiveLane,
      blockedExactRouteLane,
      connectedRefresh: connectedRefresh
        ? {
            status: connectedRefresh.status || null,
          requiredRefreshCount: connectedRefresh.requiredRefreshCount ?? 0,
          nextActionCode: connectedRefresh.nextActionCode || null,
          runnerExecuteCommand: connectedRefresh.runnerExecuteCommand || null,
          fullCommandChain: connectedRefresh.fullCommandChain || null,
        }
      : null,
    preliveValidation,
    currentRoutePrelivePass,
    protocolMarketWatchers: protocolMarketWatchers?.summary || null,
    btcOnlyE2eDryRun: btcOnlyE2eDryRun?.summary || null,
    tinyLiveCanaryRollout: tinyLiveCanaryRollout?.summary || null,
    receiptIngestionGuide,
    operationalJudgmentReview,
    actionChain,
  };
}
