export const MERKL_PORTFOLIO_POLICY = Object.freeze({
  profileId: "aggressive_merkl_portfolio_v1",
  maxActiveUsd: 75,
  maxNewPositionsPerRun: 5,
  maxOpenPositions: 12,
  perOpportunityMaxUsd: 25,
  allowTopUps: true,
  minPositionUsd: 0.25,
  reserveSourceInventoryPct: 0.05,
  minCanaryProofsBeforeScale: 1,
  minHoldMinutes: 60,
  exitLookaheadHours: 18,
  minRemainingHoursForEntry: 24,
  minScoreForEntry: 55,
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
