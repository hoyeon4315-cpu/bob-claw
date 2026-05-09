import { EV_MARGIN_FLOOR_POLICY } from "../config/ev-margin-floor.mjs";

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function key(value) {
  return value === undefined || value === null ? null : String(value).trim().toLowerCase();
}

export function evaluateEvMarginFloor({
  expectedNetPnlUsd = null,
  gasEstimateUsd = null,
  chain = null,
  route = null,
  policy = EV_MARGIN_FLOOR_POLICY,
} = {}) {
  if (policy?.enabled === false) {
    return {
      allow: true,
      ratio: null,
      threshold: null,
      reason: null,
      disabled: true,
    };
  }

  const expected = finite(expectedNetPnlUsd);
  const gas = finite(gasEstimateUsd);
  const chainKey = key(chain);
  const routeKey = key(route);
  const threshold =
    finite(routeKey ? policy?.minRatioByRoute?.[routeKey] : null) ??
    finite(chainKey ? policy?.minRatioByChain?.[chainKey] : null) ??
    finite(policy?.defaultMinRatio) ??
    EV_MARGIN_FLOOR_POLICY.defaultMinRatio;

  if (expected === null || gas === null || !(gas > 0)) {
    return {
      allow: true,
      ratio: null,
      threshold,
      reason: null,
      skipped: "missing_positive_gas_estimate",
    };
  }

  const ratio = expected / gas;
  const allow = expected > 0 && ratio > threshold;
  return {
    allow,
    ratio,
    threshold,
    reason: allow ? null : "ev_below_gas_margin_floor",
    expectedNetPnlUsd: expected,
    gasEstimateUsd: gas,
    chain: chainKey,
    route: routeKey,
  };
}
