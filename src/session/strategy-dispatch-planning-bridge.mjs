function rankValue(candidate = {}) {
  const selectionScore = Number(candidate?.selectionScore);
  if (Number.isFinite(selectionScore)) return selectionScore;
  const priorityScore = Number(candidate?.priorityScore);
  return Number.isFinite(priorityScore) ? priorityScore : -1;
}

export function buildStrategyDispatchPlanningBridge({
  autonomousDiscoveryBoard = null,
  executionSurfaces = null,
  limit = 5,
} = {}) {
  if (!autonomousDiscoveryBoard) return null;
  const strategiesById = new Map((executionSurfaces?.strategies || []).map((strategy) => [strategy.id, strategy]));
  const candidates = [...(autonomousDiscoveryBoard.opportunities || [])]
    .filter(Boolean)
    .sort(
      (left, right) =>
        rankValue(right) - rankValue(left) ||
        String(left?.id || "").localeCompare(String(right?.id || "")),
    )
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((candidate) => {
      const matchedStrategy = strategiesById.get(candidate.id) || null;
      return {
        id: candidate.id || null,
        label: candidate.label || null,
        type: candidate.type || null,
        lane: candidate.lane || null,
        status: candidate.status || null,
        priorityScore: candidate.priorityScore ?? null,
        selectionScore: candidate.selectionScore ?? null,
        recommendedDecision: candidate.researchLoop?.recommendedDecision || null,
        nextAction: candidate.nextAction || null,
        matchedExecutionSurfaceId: matchedStrategy?.id || null,
        matchedExecutionMode: matchedStrategy?.selectedMode || null,
        matchedLiveEligibility: matchedStrategy?.currentLiveEligible === true,
      };
    });
  return {
    source: "autonomous_discovery_board",
    authority: "planning_only",
    dispatchAuthority: "strategy_execution_surfaces_and_runtime_guards_only",
    generatedAt: autonomousDiscoveryBoard.generatedAt || autonomousDiscoveryBoard.summary?.generatedAt || null,
    candidateCount: autonomousDiscoveryBoard.summary?.opportunityCount ?? autonomousDiscoveryBoard.opportunities?.length ?? 0,
    readyNowCount: autonomousDiscoveryBoard.summary?.readyNowCount ?? 0,
    topCandidateId: candidates[0]?.id || null,
    liveEligibleStrategyIds: (executionSurfaces?.strategies || [])
      .filter((strategy) => strategy.currentLiveEligible)
      .map((strategy) => strategy.id),
    candidates,
    notes: [
      "Planning candidates never grant live dispatch authority by themselves.",
      "Live execution remains gated by strategy execution surfaces, runtime guards, and policy checks.",
    ],
  };
}
