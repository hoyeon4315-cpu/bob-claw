function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function stage({ id, label, status, blockers = [], evidence = null, nextAction = null }) {
  return {
    id,
    label,
    status,
    blockers: unique(blockers),
    evidence,
    nextAction,
  };
}

export function buildBtcOnlyE2eDryRun({
  reviewPackage = null,
  preliveValidation = null,
  connectedRefresh = null,
  currentRoutePrelivePass = null,
  operationalJudgmentReview = null,
  now = null,
} = {}) {
  const candidate = reviewPackage?.manualReviewCandidate || reviewPackage?.tinyCanaryAdmission?.candidate || null;
  const stages = [
    stage({
      id: "route_selection",
      label: "Current BTC route selected",
      status: candidate?.routeKey ? "passed" : "blocked",
      blockers: candidate?.routeKey ? [] : ["manual_review_candidate_missing"],
      evidence: candidate
        ? {
            routeKey: candidate.routeKey || null,
            amount: candidate.amount || null,
            tradeReadiness: candidate.tradeReadiness || null,
          }
        : null,
    }),
    stage({
      id: "connected_refresh",
      label: "Connected route inputs refreshed",
      status:
        (connectedRefresh?.requiredRefreshCount ?? 0) > 0
          ? "blocked"
          : (connectedRefresh?.blockedInputCount ?? 0) > 0
            ? "blocked"
            : "passed",
      blockers: [
        (connectedRefresh?.requiredRefreshCount ?? 0) > 0 ? "connected_refresh_required" : null,
        (connectedRefresh?.blockedInputCount ?? 0) > 0 ? "blocked_connected_input_present" : null,
      ],
      evidence: connectedRefresh
        ? {
            status: connectedRefresh.status || null,
            requiredRefreshCount: connectedRefresh.requiredRefreshCount ?? 0,
            staleInputCount: connectedRefresh.staleInputCount ?? 0,
          }
        : null,
      nextAction:
        (connectedRefresh?.requiredRefreshCount ?? 0) > 0 || (connectedRefresh?.blockedInputCount ?? 0) > 0
          ? {
              code: connectedRefresh?.nextActionCode || "execute_connected_refresh",
              command: connectedRefresh?.runnerExecuteCommand || connectedRefresh?.nextActionCommand || null,
            }
          : null,
    }),
    stage({
      id: "shadow_replay",
      label: "Shadow replay and validation gate",
      status: preliveValidation?.currentStageId === "shadow_replay" && preliveValidation?.validationStatus === "blocked" ? "blocked" : "passed",
      blockers:
        preliveValidation?.currentStageId === "shadow_replay" && preliveValidation?.validationStatus === "blocked"
          ? ["shadow_replay_not_ready"]
          : [],
      evidence: preliveValidation
        ? {
            validationStatus: preliveValidation.validationStatus || null,
            readinessPct: preliveValidation.readinessPct ?? null,
            blockerCount: preliveValidation.blockerCount ?? 0,
          }
        : null,
      nextAction:
        preliveValidation?.currentStageId === "shadow_replay" && preliveValidation?.validationStatus === "blocked"
          ? {
              code: preliveValidation.nextActionCode || null,
              command: preliveValidation.nextActionCommand || null,
            }
          : null,
    }),
    stage({
      id: "exact_route_pass",
      label: "Exact-route BTC dry-run pass",
      status: (currentRoutePrelivePass?.provenCount ?? 0) > 0 ? "passed" : "blocked",
      blockers: (currentRoutePrelivePass?.provenCount ?? 0) > 0 ? [] : [currentRoutePrelivePass?.latestStopReason || "exact_route_pass_not_proven"],
      evidence: currentRoutePrelivePass
        ? {
            runCount: currentRoutePrelivePass.runCount ?? 0,
            blockedCount: currentRoutePrelivePass.blockedCount ?? 0,
            latestStatus: currentRoutePrelivePass.latestStatus || null,
            latestMode: currentRoutePrelivePass.latestMode || null,
          }
        : null,
      nextAction: currentRoutePrelivePass?.nextAction || null,
    }),
    stage({
      id: "btc_settlement_return",
      label: "BTC settlement return path",
      status: (currentRoutePrelivePass?.provenCount ?? 0) > 0 ? "passed" : "blocked",
      blockers: (currentRoutePrelivePass?.provenCount ?? 0) > 0 ? [] : ["signer_backed_btc_return_not_proven"],
      evidence: {
        provenCount: currentRoutePrelivePass?.provenCount ?? 0,
        issueCount: operationalJudgmentReview?.issueCount ?? 0,
      },
      nextAction:
        (currentRoutePrelivePass?.provenCount ?? 0) > 0
          ? null
          : {
              code: operationalJudgmentReview?.nextActionCode || preliveValidation?.nextActionCode || null,
              command: operationalJudgmentReview?.nextActionCommand || preliveValidation?.nextActionCommand || null,
            },
    }),
  ];

  const blockedStage = stages.find((item) => item.status === "blocked") || null;
  const laneStatus = blockedStage ? "blocked" : "passed";
  const lane = {
    id: "btc_exact_route",
    label: "BTC exact-route lane",
    priority: "secondary",
    promotionTarget: "blocked_secondary_lane",
    status: laneStatus,
    routeKey: candidate?.routeKey || null,
    routeLabel: candidate?.routeLabel || null,
    topBlockedStage: blockedStage
      ? {
          id: blockedStage.id || null,
          label: blockedStage.label || null,
          blockers: blockedStage.blockers || [],
        }
      : null,
    nextAction: blockedStage?.nextAction || null,
  };
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      stageCount: stages.length,
      blockedCount: stages.filter((item) => item.status === "blocked").length,
      runCount: currentRoutePrelivePass?.runCount ?? 0,
      latestStatus: currentRoutePrelivePass?.latestStatus || null,
      laneStatus,
      lanePriority: lane.priority,
      topStuckPointId: blockedStage?.id || null,
      nextAction: blockedStage?.nextAction || null,
    },
    candidate,
    lane,
    stages,
    stuckPoints: stages
      .filter((item) => item.status === "blocked")
      .map((item) => ({
        stageId: item.id,
        blockers: item.blockers,
      })),
  };
}

export function summarizeBtcOnlyE2eDryRun(report = null) {
  if (!report) return null;
  const topStuck =
    report.stages?.find((item) => item.id === report.summary?.topStuckPointId) ||
    report.stages?.find((item) => item.status === "blocked") ||
    null;
  return {
    stageCount: report.summary?.stageCount ?? 0,
    blockedCount: report.summary?.blockedCount ?? 0,
    runCount: report.summary?.runCount ?? 0,
    latestStatus: report.summary?.latestStatus || null,
    lane: report.lane
      ? {
          id: report.lane.id || null,
          label: report.lane.label || null,
          status: report.lane.status || null,
          priority: report.lane.priority || null,
        }
      : null,
    topStuckPoint: topStuck
      ? {
          id: topStuck.id || null,
          label: topStuck.label || null,
          status: topStuck.status || null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
