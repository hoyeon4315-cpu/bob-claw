export const DEFAULT_QUOTE_DECAY_WINDOWS_SECONDS = [5, 15, 30, 60];

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function sortByObservedAt(items) {
  return [...items].sort((left, right) => new Date(left.observedAt || 0) - new Date(right.observedAt || 0));
}

function secondsBetween(older, newer) {
  return (new Date(newer).getTime() - new Date(older).getTime()) / 1000;
}

function firstFollowupAtWindow(group, startIndex, windowSeconds) {
  const start = group[startIndex];
  for (let index = startIndex + 1; index < group.length; index += 1) {
    if (secondsBetween(start.observedAt, group[index].observedAt) >= windowSeconds) {
      return group[index];
    }
  }
  return null;
}

export function observationClearsRequiredEdge(observation) {
  if (Number.isFinite(observation?.observedEdgePct) && Number.isFinite(observation?.requiredEdgePct)) {
    return observation.observedEdgePct >= observation.requiredEdgePct;
  }
  if (Number.isFinite(observation?.observedEdgeUsd)) return observation.observedEdgeUsd > 0;
  if (Number.isFinite(observation?.treasuryAdjustedExecutableNetEdgeUsd)) return observation.treasuryAdjustedExecutableNetEdgeUsd > 0;
  if (Number.isFinite(observation?.treasuryAdjustedNetEdgeUsd)) return observation.treasuryAdjustedNetEdgeUsd > 0;
  if (Number.isFinite(observation?.referenceExecutableNetEdgeUsd)) return observation.referenceExecutableNetEdgeUsd > 0;
  if (Number.isFinite(observation?.referenceNetEdgeUsd)) return observation.referenceNetEdgeUsd > 0;
  return false;
}

export function summarizeQuoteDecay(observations, windows = DEFAULT_QUOTE_DECAY_WINDOWS_SECONDS) {
  const grouped = groupBy(
    (observations || []).filter((item) => item?.routeKey && item?.amount && item?.observedAt),
    (item) => `${item.routeKey}|${item.amount}`,
  );
  const groups = [...grouped.values()].map(sortByObservedAt);
  const repeatedGroups = groups.filter((group) => group.length >= 2).length;

  const windowSummaries = windows.map((windowSeconds) => ({
    windowSeconds,
    coveredGroups: 0,
    profitableStartGroups: 0,
    survivedGroups: 0,
    survivalRatePct: null,
  }));

  for (const group of groups) {
    for (const summary of windowSummaries) {
      let covered = false;
      let profitableStart = false;
      let survived = false;

      for (let index = 0; index < group.length - 1; index += 1) {
        const followup = firstFollowupAtWindow(group, index, summary.windowSeconds);
        if (!followup) continue;
        covered = true;
        if (!profitableStart && observationClearsRequiredEdge(group[index])) {
          profitableStart = true;
          survived = observationClearsRequiredEdge(followup);
          break;
        }
      }

      if (covered) summary.coveredGroups += 1;
      if (profitableStart) summary.profitableStartGroups += 1;
      if (survived) summary.survivedGroups += 1;
    }
  }

  for (const summary of windowSummaries) {
    summary.survivalRatePct =
      summary.profitableStartGroups > 0 ? (summary.survivedGroups / summary.profitableStartGroups) * 100 : null;
  }

  return {
    coveredGroups: repeatedGroups,
    windows: windowSummaries,
  };
}
