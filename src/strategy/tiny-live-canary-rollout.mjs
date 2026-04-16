function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

export function buildTinyLiveCanaryRollout({
  reviewPackage = null,
  preliveValidation = null,
  currentRoutePrelivePass = null,
  operationalJudgmentReview = null,
  now = null,
} = {}) {
  const admission = reviewPackage?.tinyCanaryAdmission || null;
  const requirements = (admission?.requirements || []).map((item) => ({
    code: item.code || null,
    label: item.label || null,
    status: item.status || null,
    blockers: unique(item.blockers || []),
  }));
  const blockedRequirement = requirements.find((item) => item.status === "blocked") || null;
  const rollbackCriteria = [
    "stale or blocked connected inputs pause the rollout immediately",
    "any fork execution or dry-run regression blocks promotion",
    "watcher breach or failed-gas budget breach requires unwind/stop",
    "manual approval remains required before any live canary",
  ];
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      status: admission?.status || "blocked",
      decision: admission?.decision || "NO_GO",
      blockerCount: admission?.blockers?.length ?? 0,
      topBlockedRequirementCode: blockedRequirement?.code || null,
      nextAction: {
        code: preliveValidation?.nextActionCode || admission?.nextActionCode || null,
        command: preliveValidation?.nextActionCommand || null,
      },
    },
    candidate: admission?.candidate || null,
    constraints: admission?.constraints || null,
    requirements,
    rollbackCriteria,
    operationalIssues: {
      status: operationalJudgmentReview?.status || null,
      issueCount: operationalJudgmentReview?.issueCount ?? 0,
      nextActionCode: operationalJudgmentReview?.nextActionCode || null,
      nextActionCommand: operationalJudgmentReview?.nextActionCommand || null,
    },
    executionProof: {
      provenCount: currentRoutePrelivePass?.provenCount ?? 0,
      blockedCount: currentRoutePrelivePass?.blockedCount ?? 0,
      latestStatus: currentRoutePrelivePass?.latestStatus || null,
    },
  };
}

export function summarizeTinyLiveCanaryRollout(report = null) {
  if (!report) return null;
  const topBlocked =
    report.requirements?.find((item) => item.code === report.summary?.topBlockedRequirementCode) ||
    report.requirements?.find((item) => item.status === "blocked") ||
    null;
  return {
    status: report.summary?.status || null,
    decision: report.summary?.decision || null,
    blockerCount: report.summary?.blockerCount ?? 0,
    topBlockedRequirement: topBlocked
      ? {
          code: topBlocked.code || null,
          label: topBlocked.label || null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
