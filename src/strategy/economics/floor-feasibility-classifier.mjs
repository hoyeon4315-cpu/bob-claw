import { solveMinViableNotional } from "./min-viable-notional.mjs";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundUsd(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function snapshotMissingInput(snapshot = {}) {
  return finiteNumber(snapshot.measuredEdgeBpsPerDay) === null ||
    finiteNumber(snapshot.measuredRoundTripCostUsd) === null ||
    finiteNumber(snapshot.varianceFloorUsd) === null;
}

function sourceCandidatesFor(deltaUsd, treasury = {}) {
  const sources = Array.isArray(treasury.sources) ? treasury.sources : [];
  let remaining = Math.max(0, finiteNumber(deltaUsd) ?? 0);
  const candidates = [];
  for (const source of sources) {
    const freeUsd = finiteNumber(source.freeUsd ?? source.amountUsd ?? source.usd);
    if (!(freeUsd > 0) || remaining <= 0) continue;
    const amountUsd = Math.min(freeUsd, remaining);
    candidates.push({
      chain: source.chain || null,
      asset: source.asset || source.token || source.ticker || null,
      amountUsd: roundUsd(amountUsd),
      freeUsd,
    });
    remaining -= amountUsd;
  }
  return candidates;
}

function expectedDailyUsd(snapshot = {}, minNotionalUsd) {
  const edge = finiteNumber(snapshot.measuredEdgeBpsPerDay);
  const notional = finiteNumber(minNotionalUsd);
  if (edge === null || notional === null) return null;
  return roundUsd((edge / 10_000) * notional);
}

export function classifyFloorFeasibility({
  snapshots = [],
  minViableByStrategy = {},
  treasury = {},
  strategyCapsById = {},
  holdingPeriodDays = 1,
} = {}) {
  const freeCapitalUsd = Math.max(0, finiteNumber(treasury.freeCapitalUsd) ?? 0);
  return (snapshots || []).map((snapshot) => {
    const strategyId = snapshot.strategyId;
    const caps = strategyCapsById[strategyId]?.caps || strategyCapsById[strategyId] || null;
    const solved = minViableByStrategy[strategyId] || solveMinViableNotional({
      edgeBpsPerDay: snapshot.measuredEdgeBpsPerDay,
      roundTripCostUsd: snapshot.measuredRoundTripCostUsd,
      slippageVarianceUsd: snapshot.slippageVarianceUsd,
      varianceFloorUsd: snapshot.varianceFloorUsd,
      holdingPeriodDays,
      caps: caps ? { ...caps, chain: snapshot.chain || Object.keys(caps.perChainUsd || {})[0] || null } : null,
    });
    let classification = null;
    const observed = Math.max(0, finiteNumber(snapshot.observedNotionalUsd) ?? 0);
    const minNotional = finiteNumber(solved.minNotionalUsd);
    const delta = minNotional !== null ? Math.max(0, minNotional - observed) : null;

    if (snapshotMissingInput(snapshot) || solved.reason === "missing_input") classification = "missing_input";
    else if (snapshot.freshness?.isThin === true) classification = "thin_evidence";
    else if (solved.reason === "floor_infeasible_at_committed_caps") classification = "floor_infeasible_at_committed_caps";
    else if (solved.reason === "negative_or_zero_edge") classification = "negative_or_zero_edge";
    else if (solved.infeasible) classification = solved.reason || "missing_input";
    else if (delta <= 0) classification = "ready_no_capital_change";
    else if (delta <= freeCapitalUsd) classification = "ready_with_capital_addition";
    else classification = "needs_capital_acquisition";

    return {
      strategyId,
      classification,
      capitalDeltaNeededUsd: delta === null ? null : roundUsd(delta),
      minNotionalUsd: minNotional,
      observedNotionalUsd: observed,
      capitalSourceCandidates: delta !== null && delta > 0 ? sourceCandidatesFor(delta, treasury) : [],
      expectedDailyUsdOnResolve: expectedDailyUsd(snapshot, minNotional),
      reason: solved.reason || null,
    };
  });
}
