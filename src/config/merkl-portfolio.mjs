export const MERKL_PORTFOLIO_POLICY = Object.freeze({
  profileId: "aggressive_merkl_portfolio_v1",
  maxActiveUsd: 300,
  maxNewPositionsPerRun: 8,
  maxOpenPositions: 20,
  perOpportunityMaxUsd: 75,
  allowTopUps: true,
  chainMaxUsd: Object.freeze({
    base: 80,
    ethereum: 200,
    bsc: 60,
    optimism: 25,
    sei: 15,
    unichain: 25,
    soneium: 25,
  }),
  protocolMaxUsd: Object.freeze({
    yo: 80,
    morpho: 170,
    euler: 60,
    aave: 40,
  }),
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
    chainMaxUsd: {
      ...MERKL_PORTFOLIO_POLICY.chainMaxUsd,
      ...(overrides.chainMaxUsd || {}),
    },
    protocolMaxUsd: {
      ...MERKL_PORTFOLIO_POLICY.protocolMaxUsd,
      ...(overrides.protocolMaxUsd || {}),
    },
    scoreWeights: {
      ...MERKL_PORTFOLIO_POLICY.scoreWeights,
      ...(overrides.scoreWeights || {}),
    },
  };
}
