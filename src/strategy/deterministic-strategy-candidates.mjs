function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function researchCandidateById(strategyResearchBoard = null) {
  return new Map((strategyResearchBoard?.candidates || []).map((item) => [item.id, item]));
}

function stagePriority(candidate = null) {
  const statusBias = {
    repo_auto_build_supported: 0,
    planning_adapter_ready: 1,
    design_scaffold: 2,
    research_blocked: 3,
    unsupported_venue_profile: 4,
  }[candidate?.deterministicStatus] ?? 5;
  return [statusBias, Number.isFinite(candidate?.rank) ? candidate.rank : 999, String(candidate?.id || "")];
}

function summarizeLoopCandidate(loop = null, researchCandidate = null, defaultRank = 99) {
  if (!loop?.strategy?.id) return null;
  const supportStatus = loop.executionSupport?.status || "support_unknown";
  const repoAutoBuildSupported = supportStatus === "repo_auto_build_supported";
  const deterministicStatus = repoAutoBuildSupported
    ? "repo_auto_build_supported"
    : supportStatus === "planning_adapter_ready"
      ? "planning_adapter_ready"
      : supportStatus;
  return {
    rank: researchCandidate?.rank ?? defaultRank,
    id: loop.strategy.id,
    label: loop.strategy.label || null,
    category: researchCandidate?.category || "yield",
    status: researchCandidate?.status || "candidate_for_design",
    deterministicStatus,
    repoAutoBuildSupported,
    readyForDryRun: loop.readiness?.readyForDryRun === true,
    dryRunReceiptRecorded: loop.dryRunSummary?.dryRunReceiptRecorded === true,
    signerBackedRunCount: loop.dryRunSummary?.signerBackedRunCount ?? 0,
    latestDryRunObservedAt: loop.dryRunSummary?.latestObservedAt || null,
    readyForLive: false,
    protocolAdapterId: loop.protocolAdapter?.id || null,
    reusableComponents: unique([
      loop.executionSupport?.status ? `execution_support:${loop.executionSupport.status}` : null,
      loop.protocolAdapter?.id ? `protocol_adapter:${loop.protocolAdapter.id}` : null,
      loop.watcherRuntime?.status ? `watcher:${loop.watcherRuntime.status}` : null,
      Number.isFinite(loop.executionPlan?.actionCount) ? `entry_actions:${loop.executionPlan.actionCount}` : null,
      Number.isFinite(loop.unwindPlan?.actions?.length) ? `unwind_actions:${loop.unwindPlan.actions.length}` : null,
    ]),
    blockers: unique(loop.blockers || []),
    missingEvidence: unique(researchCandidate?.missingEvidence || []),
    evidence: {
      executionSurface: researchCandidate?.evidence?.executionSurface || null,
      executionSupportStatus: supportStatus,
      readyForDryRun: loop.readiness?.readyForDryRun === true,
      dryRunReceiptRecorded: loop.dryRunSummary?.dryRunReceiptRecorded === true,
      signerBackedRunCount: loop.dryRunSummary?.signerBackedRunCount ?? 0,
      watcherStatus: loop.watcherRuntime?.status || null,
      actionCount: loop.executionPlan?.actionCount ?? 0,
      unwindActionCount: loop.unwindPlan?.actions?.length ?? 0,
    },
    nextAction: researchCandidate?.nextAction || null,
  };
}

function summarizeSecondaryCandidate(scaffold = null, researchCandidate = null) {
  if (!scaffold?.id) return null;
  return {
    rank: researchCandidate?.rank ?? scaffold.rank ?? 999,
    id: scaffold.id,
    label: scaffold.label || null,
    category: scaffold.category || researchCandidate?.category || null,
    status: researchCandidate?.status || scaffold.status || "design_scaffold",
    deterministicStatus: scaffold.status || "design_scaffold",
    repoAutoBuildSupported: false,
    readyForDryRun: false,
    readyForLive: false,
    protocolAdapterId: null,
    reusableComponents: unique([
      scaffold.entryShape?.type ? `entry_shape:${scaffold.entryShape.type}` : null,
      ...(scaffold.watcherShape?.checks || []).map((item) => `watcher:${item}`),
      scaffold.unwindShape?.path ? `unwind:${scaffold.unwindShape.path}` : null,
    ]),
    blockers: unique(scaffold.blockers || []),
    missingEvidence: unique(scaffold.missingEvidence || researchCandidate?.missingEvidence || []),
    evidence: {
      protocolTrack: scaffold.protocolTrack || null,
      entryShape: scaffold.entryShape || null,
      watcherShape: scaffold.watcherShape || null,
      unwindShape: scaffold.unwindShape || null,
    },
    nextAction: scaffold.nextAction || researchCandidate?.nextAction || null,
  };
}

export function buildDeterministicStrategyCandidates({
  strategyResearchBoard = null,
  recursiveWrappedBtcLoop = null,
  recursiveStablecoinLoop = null,
  secondaryStrategyScaffolds = null,
  now = null,
} = {}) {
  const researchById = researchCandidateById(strategyResearchBoard);
  const candidates = [
    summarizeLoopCandidate(recursiveWrappedBtcLoop, researchById.get("recursive_wrapped_btc_lending_loop") || null, 1),
    summarizeLoopCandidate(recursiveStablecoinLoop, researchById.get("recursive_stablecoin_lending_loop") || null, 2),
    ...(secondaryStrategyScaffolds?.scaffolds || []).map((item) =>
      summarizeSecondaryCandidate(item, researchById.get(item.id) || null),
    ),
  ]
    .filter(Boolean)
    .sort((left, right) => {
      const [leftStatus, leftRank, leftId] = stagePriority(left);
      const [rightStatus, rightRank, rightId] = stagePriority(right);
      if (leftStatus !== rightStatus) return leftStatus - rightStatus;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return leftId.localeCompare(rightId);
    });
  const topCandidate = candidates[0] || null;
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary: {
      candidateCount: candidates.length,
      repoAutoBuildCount: candidates.filter((item) => item.repoAutoBuildSupported).length,
      readyForDryRunCount: candidates.filter((item) => item.readyForDryRun).length,
      receiptBackedCount: candidates.filter((item) => item.dryRunReceiptRecorded).length,
      topCandidateId: topCandidate?.id || null,
      nextAction: topCandidate?.nextAction || null,
    },
    candidates,
  };
}

export function summarizeDeterministicStrategyCandidates(report = null) {
  if (!report) return null;
  const topCandidate =
    report.candidates?.find((item) => item.id === report.summary?.topCandidateId) ||
    report.candidates?.[0] ||
    null;
  return {
    candidateCount: report.summary?.candidateCount ?? 0,
    repoAutoBuildCount: report.summary?.repoAutoBuildCount ?? 0,
    readyForDryRunCount: report.summary?.readyForDryRunCount ?? 0,
    receiptBackedCount: report.summary?.receiptBackedCount ?? 0,
    topCandidate: topCandidate
      ? {
          id: topCandidate.id || null,
          label: topCandidate.label || null,
          status: topCandidate.status || null,
          deterministicStatus: topCandidate.deterministicStatus || null,
          dryRunReceiptRecorded: topCandidate.dryRunReceiptRecorded === true,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
