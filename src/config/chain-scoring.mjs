export const CHAIN_SCORING_POLICY = Object.freeze({
  halfLifeHours: 168,
  priorScore: 0.5,
  minObservedSamplesForConfidentScore: 10,
  maxScoreDeltaPerDay: 0.25,
  weights: Object.freeze({
    realizedNetBtc: 0.45,
    receiptFreshness: 0.25,
    routeAvailability: 0.15,
    costEfficiency: 0.15,
  }),
});
