export const BROADCAST_BUDGET_POLICY = Object.freeze({
  enabled: true,
  scopedLifecycleStages: Object.freeze(["refill", "discovery_probe", "idle_consolidation_planned"]),
  maxDailyGasUsd: null,
  dailyGasBurnFractionCap: null,
  operatorReviewRequired: true,
});

export function broadcastBudgetPolicy(overrides = {}) {
  return Object.freeze({
    ...BROADCAST_BUDGET_POLICY,
    ...overrides,
    scopedLifecycleStages: Object.freeze(
      overrides.scopedLifecycleStages || BROADCAST_BUDGET_POLICY.scopedLifecycleStages,
    ),
  });
}
