export const BLOCKER_RESOLUTION_CONFIG = Object.freeze({
  quarantineTickThreshold: 12,
  maxAutoAttemptsProofAcquisition: 3,
  attemptResetInactivityHours: 24,
  maxResolverWallSeconds: 600,
  maxRpcCallsPerRun: 200,
  maxProofAcquisitionsPerRun: 10,
  maxOperationalIntentsPerRun: 3,
  externalApiBudgetUsd: 0,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerHalfOpenAfterMs: 300_000,
  codexQueueStaleDays: 30,
  paybackSettlementTimeoutHours: 6,
  profitAttributionGapDays: 7,
});

export function buildBlockerResolutionConfig(overrides = {}) {
  return Object.freeze({
    ...BLOCKER_RESOLUTION_CONFIG,
    ...Object.fromEntries(
      Object.entries(overrides || {}).filter(([, value]) => value !== undefined),
    ),
  });
}
