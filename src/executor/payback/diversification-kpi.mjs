// Diversification KPI slice for the dashboard JSON.
// Consumes current portfolio allocations and emits a slice that the
// dashboard can display. Pure function; no I/O.
//
// Plan §3 / §12: dashboard shows HHI, per-chain share, per-strategy share
// alongside BYR/CG/TBR. This module is the single source of truth for those
// KPIs.

import {
  DIVERSIFICATION_POLICY,
  GATEWAY_OFFICIAL_CHAINS,
  computeHhi,
  evaluateDiversification,
} from "../../config/diversification.mjs";

function sortedTopN(obj, n = 5) {
  return Object.entries(obj || {})
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, share]) => ({ id, share }));
}

function totalOf(obj) {
  let s = 0;
  for (const v of Object.values(obj || {})) {
    if (Number.isFinite(v) && v > 0) s += v;
  }
  return s;
}

export function buildDiversificationKpiSlice({
  allocations = {},
  policy = DIVERSIFICATION_POLICY,
  observedAt = new Date().toISOString(),
} = {}) {
  const perStrategy = allocations.perStrategy || {};
  const perChain = allocations.perChain || {};
  const perProtocol = allocations.perProtocol || {};
  const bobL2DirectShare = Number(allocations.bobL2DirectShare ?? 0);

  const verdict = evaluateDiversification(
    { perStrategy, perChain, perProtocol, bobL2DirectShare },
    policy,
  );

  const activeStrategies = Object.values(perStrategy).filter((v) => v > 0).length;
  const activeChains = Object.values(perChain).filter((v) => v > 0).length;
  const activeProtocols = Object.values(perProtocol).filter((v) => v > 0).length;

  const utilization = totalOf(perStrategy);

  const effectiveN = verdict.hhi > 0 ? 1 / Math.max(verdict.hhi, 1e-9) : 0;

  return Object.freeze({
    schemaVersion: 1,
    observedAt,
    hhi: verdict.hhi,
    effectiveN,
    utilizationShare: utilization,
    activeStrategies,
    activeChains,
    activeProtocols,
    topStrategies: Object.freeze(sortedTopN(perStrategy, 5).map((e) => Object.freeze(e))),
    topChains: Object.freeze(sortedTopN(perChain, 5).map((e) => Object.freeze(e))),
    topProtocols: Object.freeze(sortedTopN(perProtocol, 5).map((e) => Object.freeze(e))),
    bobL2DirectShare,
    policy: Object.freeze({
      perStrategyMaxShare: policy.perStrategyMaxShare,
      perChainMaxShare: policy.perChainMaxShare,
      chainSelectionMode: policy.chainSelectionMode ?? null,
      perChainMaxShareByChain: Object.freeze({ ...(policy.perChainMaxShareByChain ?? {}) }),
      evidencePrimaryChains: Object.freeze(Object.keys(policy.perChainMaxShareByChain ?? {})),
      perProtocolMaxShare: policy.perProtocolMaxShare,
      hhiMax: policy.hhiMax,
      bobL2DirectMaxShare: policy.bobL2DirectMaxShare,
    }),
    gatewayOfficialChains: GATEWAY_OFFICIAL_CHAINS,
    ok: verdict.ok,
    violations: verdict.violations,
    status: verdict.ok ? "healthy" : "violation",
  });
}

export { computeHhi };
