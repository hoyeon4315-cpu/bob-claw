export const EV_MARGIN_FLOOR_POLICY = Object.freeze({
  enabled: true,
  defaultMinRatio: 1.5,
  minRatioByChain: Object.freeze({}),
  minRatioByRoute: Object.freeze({}),
});

export function evMarginFloorPolicy(overrides = {}) {
  return Object.freeze({
    ...EV_MARGIN_FLOOR_POLICY,
    ...overrides,
    minRatioByChain: Object.freeze({
      ...EV_MARGIN_FLOOR_POLICY.minRatioByChain,
      ...(overrides.minRatioByChain || {}),
    }),
    minRatioByRoute: Object.freeze({
      ...EV_MARGIN_FLOOR_POLICY.minRatioByRoute,
      ...(overrides.minRatioByRoute || {}),
    }),
  });
}
