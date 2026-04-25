export const MERKL_PORTFOLIO_POLICY = Object.freeze({
  profileId: "aggressive_merkl_portfolio_v1",
  maxActiveUsd: 5000,
  maxNewPositionsPerRun: 20,
  maxOpenPositions: 50,
  perOpportunityMaxUsd: 500,
  allowTopUps: true,
  chainMaxUsd: Object.freeze({
    base: 2000,
    ethereum: 3000,
    bsc: 750,
    optimism: 300,
    sei: 150,
    unichain: 300,
    soneium: 300,
    avalanche: 500,
    bera: 300,
    sonic: 500,
  }),
  protocolMaxUsd: Object.freeze({
    yo: 1000,
    morpho: 2500,
    euler: 1000,
    aave: 1000,
  }),
  minPositionUsd: 0.25,
  minEthereumNotionalUsd: 10,
  allowSmallEthereumProofBackedEntries: true,
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
