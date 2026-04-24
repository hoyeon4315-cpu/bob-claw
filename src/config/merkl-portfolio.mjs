export const MERKL_PORTFOLIO_POLICY = Object.freeze({
  profileId: "aggressive_merkl_portfolio_v1",
  maxActiveUsd: 5,
  maxNewPositionsPerRun: 3,
  maxOpenPositions: 8,
  perOpportunityMaxUsd: 1,
  minPositionUsd: 0.05,
  reserveSourceInventoryPct: 0.1,
  minCanaryProofsBeforeScale: 1,
  minHoldMinutes: 30,
  exitLookaheadHours: 18,
  minRemainingHoursForEntry: 36,
  minScoreForEntry: 65,
  scoreWeights: Object.freeze({
    queuePriority: 0.58,
    apr: 1.8,
    tvl: 4,
    duration: 8,
    canaryProof: 10,
    inventoryReady: 18,
    gasReady: 8,
    overfitPenalty: 10,
    chainRouteGapPenalty: 3,
  }),
});

export function merklPortfolioPolicy(overrides = {}) {
  return {
    ...MERKL_PORTFOLIO_POLICY,
    ...overrides,
    scoreWeights: {
      ...MERKL_PORTFOLIO_POLICY.scoreWeights,
      ...(overrides.scoreWeights || {}),
    },
  };
}
