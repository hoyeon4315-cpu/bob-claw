import { evaluateConcentrationLimits } from "../config/concentration-limits.mjs";

function respectsConcentration(candidate, capitalState, exitingPositions = []) {
  const projectedChainShare = { ...(capitalState.chainSharePct ?? {}) };
  const projectedProtocolShare = { ...(capitalState.protocolSharePct ?? {}) };
  const projectedOpportunityShare = { ...(capitalState.opportunitySharePct ?? {}) };

  for (const pos of exitingPositions) {
    const share = pos.sharePct ?? 0;
    if (pos.chain) projectedChainShare[pos.chain] = (projectedChainShare[pos.chain] ?? 0) - share;
    if (pos.protocol) projectedProtocolShare[pos.protocol] = (projectedProtocolShare[pos.protocol] ?? 0) - share;
    if (pos.opportunityId) projectedOpportunityShare[pos.opportunityId] = (projectedOpportunityShare[pos.opportunityId] ?? 0) - share;
  }

  const enterShare = candidate.sharePct ?? candidate.positionSharePct ?? 0;
  if (candidate.chain) projectedChainShare[candidate.chain] = (projectedChainShare[candidate.chain] ?? 0) + enterShare;
  if (candidate.protocol) projectedProtocolShare[candidate.protocol] = (projectedProtocolShare[candidate.protocol] ?? 0) + enterShare;
  if (candidate.opportunityId) projectedOpportunityShare[candidate.opportunityId] = (projectedOpportunityShare[candidate.opportunityId] ?? 0) + enterShare;

  const result = evaluateConcentrationLimits({
    allocations: {
      chainSharePct: projectedChainShare,
      protocolSharePct: projectedProtocolShare,
      opportunitySharePct: projectedOpportunityShare,
    },
  });

  return result.ok;
}

export function planRotations({
  activePositions = [],
  rankedCandidates = [],
  capitalState = {},
  migrationThresholdPct = 0.30,
  migrationCostFraction = 0.5,
} = {}) {
  const migrations = [];

  for (const pos of activePositions) {
    const posScore = Number.isFinite(pos.score) ? pos.score : 0;
    const threshold = posScore * (1 + migrationThresholdPct);

    const better = rankedCandidates.find((c) => {
      const cScore = Number.isFinite(c.score) ? c.score : 0;
      if (cScore <= threshold) return false;

      const migrationCost = Number.isFinite(c.migrationCostUsd) ? c.migrationCostUsd : Number.POSITIVE_INFINITY;
      const uplift = Number.isFinite(c.expected30dUpliftUsd) ? c.expected30dUpliftUsd : 0;
      if (migrationCost >= uplift * migrationCostFraction) return false;

      if (c.opportunityId === pos.opportunityId) return false;

      return respectsConcentration(c, capitalState, [pos]);
    });

    if (better) {
      migrations.push({
        exit: pos,
        enter: better,
        expectedUpliftUsd:
          (better.expected30dUpliftUsd ?? 0) - (pos.expected30dUpliftUsd ?? 0),
      });
    }
  }

  return migrations;
}

export function planMultiStepRotations({
  activePositions = [],
  rankedCandidates = [],
  capitalState = {},
  maxRounds = 3,
  migrationThresholdPct = 0.30,
  migrationCostFraction = 0.5,
} = {}) {
  let currentPositions = [...activePositions];
  let currentState = { ...capitalState };
  const allMigrations = [];

  for (let round = 0; round < maxRounds; round++) {
    const roundMigrations = planRotations({
      activePositions: currentPositions,
      rankedCandidates,
      capitalState: currentState,
      migrationThresholdPct,
      migrationCostFraction,
    });

    if (roundMigrations.length === 0) break;

    for (const m of roundMigrations) {
      allMigrations.push({ ...m, round });
      currentPositions = currentPositions.filter((p) => p.opportunityId !== m.exit.opportunityId);
      currentPositions.push(m.enter);

      const exitShare = m.exit.sharePct ?? 0;
      const enterShare = m.enter.sharePct ?? m.enter.positionSharePct ?? 0;
      if (m.exit.chain) {
        currentState.chainSharePct = { ...(currentState.chainSharePct ?? {}) };
        currentState.chainSharePct[m.exit.chain] = (currentState.chainSharePct[m.exit.chain] ?? 0) - exitShare;
      }
      if (m.enter.chain) {
        currentState.chainSharePct = { ...(currentState.chainSharePct ?? {}) };
        currentState.chainSharePct[m.enter.chain] = (currentState.chainSharePct[m.enter.chain] ?? 0) + enterShare;
      }
    }
  }

  return allMigrations;
}
