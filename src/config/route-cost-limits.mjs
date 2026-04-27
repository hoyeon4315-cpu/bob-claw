export const ROUTE_COST_LIMITS = Object.freeze({
  maxAllowedCostBps: Object.freeze({
    stable_to_stable: 60,
    cross_asset: 120,
    default: 120,
  }),
});

export function routeCostLimits(overrides = {}) {
  return Object.freeze({
    ...ROUTE_COST_LIMITS,
    maxAllowedCostBps: Object.freeze({
      ...ROUTE_COST_LIMITS.maxAllowedCostBps,
      ...(overrides.maxAllowedCostBps || {}),
    }),
  });
}
