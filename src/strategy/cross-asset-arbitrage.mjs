import { isEthLikeAsset } from "../assets/tokens.mjs";

function parseRouteKey(routeKey) {
  const text = String(routeKey || "");
  const [left, right] = text.split("->");
  if (!left || !right) return null;
  const [srcChain, srcToken] = left.split(":");
  const [dstChain, dstToken] = right.split(":");
  if (!srcChain || !srcToken || !dstChain || !dstToken) return null;
  return { srcChain, srcToken, dstChain, dstToken };
}

function familyKey(score, side) {
  const route = parseRouteKey(score?.routeKey);
  if (side === "src") {
    return {
      chain: score?.srcChain || route?.srcChain || null,
      token: score?.srcAsset?.token || route?.srcToken || null,
      ticker: score?.srcAsset?.ticker || null,
      family: score?.srcAsset?.family || null,
    };
  }
  return {
    chain: score?.dstChain || route?.dstChain || null,
    token: score?.dstAsset?.token || route?.dstToken || null,
    ticker: score?.dstAsset?.ticker || null,
    family: score?.dstAsset?.family || null,
  };
}

function sameAsset(left, right) {
  return (
    left?.chain &&
    right?.chain &&
    left?.token &&
    right?.token &&
    String(left.chain) === String(right.chain) &&
    String(left.token).toLowerCase() === String(right.token).toLowerCase()
  );
}

function isBtcLikeAsset(asset) {
  return ["btc", "wrapped_btc"].includes(asset?.family);
}

function resolveAssetPredicate(options = {}) {
  if (typeof options.assetPredicate === "function") return options.assetPredicate;
  if (options.assetFamily === "eth") return isEthLikeAsset;
  return isBtcLikeAsset;
}

function isStableToAsset(score, assetPredicate) {
  return score?.srcAsset?.family === "stablecoin" && assetPredicate(score?.dstAsset);
}

function isAssetToStable(score, assetPredicate) {
  return assetPredicate(score?.srcAsset) && score?.dstAsset?.family === "stablecoin";
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function amountLevelKey(value) {
  return String(value ?? "");
}

function amountGapPct(entry, exit) {
  if (!Number.isFinite(entry?.outputAmount) || !Number.isFinite(exit?.inputAmount) || entry.outputAmount <= 0) return null;
  return Math.abs(exit.inputAmount - entry.outputAmount) / entry.outputAmount;
}

function closedLoop(entry, exit) {
  return sameAsset(familyKey(entry, "src"), familyKey(exit, "dst"));
}

function preferredFinalUsd(exit) {
  return Number.isFinite(exit?.executableOutputUsd) ? exit.executableOutputUsd : exit?.outputUsd;
}

function loopNetEdgeUsd(entry, exit) {
  const finalUsd = preferredFinalUsd(exit);
  if (!Number.isFinite(entry?.inputUsd) || !Number.isFinite(finalUsd)) return null;
  return finalUsd - entry.inputUsd - (entry?.knownCostUsd || 0) - (exit?.knownCostUsd || 0);
}

function blockers(entry, exit, loop) {
  const reasons = [];
  if (!loop.exactAmountMatch) reasons.push("amount_mismatch");
  if (!loop.closedLoop) reasons.push("inventory_loop_not_closed");
  if (!(loop.loopNetEdgeUsd > 0)) reasons.push("non_positive_loop_net_edge");
  if (entry?.tradeReadiness && entry.tradeReadiness !== "shadow_candidate_review_only") reasons.push(`entry_${entry.tradeReadiness}`);
  if (exit?.tradeReadiness && exit.tradeReadiness !== "shadow_candidate_review_only") reasons.push(`exit_${exit.tradeReadiness}`);
  for (const gap of entry?.dataGaps || []) reasons.push(`entry_${gap}`);
  for (const gap of exit?.dataGaps || []) reasons.push(`exit_${gap}`);
  return [...new Set(reasons)];
}

function summarizeLoop(entry, exit, tolerancePct) {
  const gapPct = amountGapPct(entry, exit);
  const summary = {
    entryRouteKey: entry.routeKey,
    entryAmount: entry.amount,
    exitRouteKey: exit.routeKey,
    exitAmount: exit.amount,
    intermediateAsset: familyKey(entry, "dst"),
    startAsset: familyKey(entry, "src"),
    endAsset: familyKey(exit, "dst"),
    entryReadiness: entry.tradeReadiness || null,
    exitReadiness: exit.tradeReadiness || null,
    amountGapPct: finite(gapPct),
    exactAmountMatch: Number.isFinite(gapPct) ? gapPct <= tolerancePct : false,
    closedLoop: closedLoop(entry, exit),
    startInputUsd: finite(entry.inputUsd),
    finalOutputUsd: finite(preferredFinalUsd(exit)),
    entryKnownCostUsd: finite(entry.knownCostUsd),
    exitKnownCostUsd: finite(exit.knownCostUsd),
    loopNetEdgeUsd: finite(loopNetEdgeUsd(entry, exit)),
  };
  return {
    ...summary,
    blockers: blockers(entry, exit, summary),
  };
}

function ladderPairKey(loop) {
  return `${loop.entryRouteKey}|${loop.exitRouteKey}`;
}

function buildAmountLadderCoverage(loops = []) {
  const coverage = new Map();
  for (const loop of loops) {
    const key = ladderPairKey(loop);
    const entryLevel = amountLevelKey(loop.entryAmount);
    const exitLevel = amountLevelKey(loop.exitAmount);
    const current = coverage.get(key) || {
      pairKey: key,
      entryRouteKey: loop.entryRouteKey,
      exitRouteKey: loop.exitRouteKey,
      entryAmounts: new Set(),
      exitAmounts: new Set(),
      observedPairCount: 0,
      exactMatchCount: 0,
      positiveLoopCount: 0,
      closestAmountGapPct: null,
      blockerCounts: new Map(),
    };
    current.entryAmounts.add(entryLevel);
    current.exitAmounts.add(exitLevel);
    current.observedPairCount += 1;
    if (loop.exactAmountMatch) current.exactMatchCount += 1;
    if (Number.isFinite(loop.loopNetEdgeUsd) && loop.loopNetEdgeUsd > 0) current.positiveLoopCount += 1;
    if (Number.isFinite(loop.amountGapPct)) {
      current.closestAmountGapPct =
        current.closestAmountGapPct === null
          ? loop.amountGapPct
          : Math.min(current.closestAmountGapPct, loop.amountGapPct);
    }
    for (const blocker of loop.blockers || []) {
      current.blockerCounts.set(blocker, (current.blockerCounts.get(blocker) || 0) + 1);
    }
    coverage.set(key, current);
  }

  return [...coverage.values()]
    .map((item) => ({
      pairKey: item.pairKey,
      entryRouteKey: item.entryRouteKey,
      exitRouteKey: item.exitRouteKey,
      entryAmountLevelCount: item.entryAmounts.size,
      exitAmountLevelCount: item.exitAmounts.size,
      observedPairCount: item.observedPairCount,
      exactMatchCount: item.exactMatchCount,
      positiveLoopCount: item.positiveLoopCount,
      closestAmountGapPct: finite(item.closestAmountGapPct),
      blockerCounts: [...item.blockerCounts.entries()]
        .map(([blocker, count]) => ({ blocker, count }))
        .sort((left, right) => right.count - left.count || String(left.blocker).localeCompare(String(right.blocker))),
    }))
    .sort(
      (left, right) =>
        right.exactMatchCount - left.exactMatchCount ||
        (left.closestAmountGapPct ?? Number.POSITIVE_INFINITY) - (right.closestAmountGapPct ?? Number.POSITIVE_INFINITY) ||
        right.observedPairCount - left.observedPairCount ||
        String(left.entryRouteKey).localeCompare(String(right.entryRouteKey)),
    );
}

export function buildAssetFamilyCrossAssetArbitrageSummary(scoreSnapshot, options = {}) {
  const scores = scoreSnapshot?.scores || [];
  const tolerancePct = Number.isFinite(options.amountTolerancePct) ? options.amountTolerancePct : 0.02;
  const assetPredicate = resolveAssetPredicate(options);
  const entries = scores.filter((score) => isStableToAsset(score, assetPredicate));
  const exits = scores.filter((score) => isAssetToStable(score, assetPredicate));
  const exactAssetPairs = [];

  for (const entry of entries) {
    for (const exit of exits) {
      if (!sameAsset(familyKey(entry, "dst"), familyKey(exit, "src"))) continue;
      exactAssetPairs.push(summarizeLoop(entry, exit, tolerancePct));
    }
  }

  exactAssetPairs.sort(
    (left, right) =>
      (right.loopNetEdgeUsd ?? Number.NEGATIVE_INFINITY) - (left.loopNetEdgeUsd ?? Number.NEGATIVE_INFINITY) ||
      (left.amountGapPct ?? Number.POSITIVE_INFINITY) - (right.amountGapPct ?? Number.POSITIVE_INFINITY) ||
      String(left.entryRouteKey).localeCompare(String(right.entryRouteKey)),
  );
  const amountLadderCoverage = buildAmountLadderCoverage(exactAssetPairs);

  return {
    schemaVersion: 1,
    generatedAt: scoreSnapshot?.generatedAt || null,
    assetFamily: options.assetFamily || "btc",
    amountTolerancePct: tolerancePct,
    entryCount: entries.length,
    exitCount: exits.length,
    exactAssetPairCount: exactAssetPairs.length,
    matchedLoopCount: exactAssetPairs.filter((item) => item.exactAmountMatch).length,
    closedLoopCount: exactAssetPairs.filter((item) => item.exactAmountMatch && item.closedLoop).length,
    profitableClosedLoopCount: exactAssetPairs.filter(
      (item) => item.exactAmountMatch && item.closedLoop && Number.isFinite(item.loopNetEdgeUsd) && item.loopNetEdgeUsd > 0,
    ).length,
    amountLadderPairCount: amountLadderCoverage.length,
    amountLadderCoverage,
    bestAmountLadderPair: amountLadderCoverage[0] || null,
    bestLoop: exactAssetPairs.find((item) => item.exactAmountMatch && item.closedLoop) || null,
    closestLoop: exactAssetPairs[0] || null,
    loops: exactAssetPairs.slice(0, 10),
  };
}

export function buildCrossAssetArbitrageSummary(scoreSnapshot, options = {}) {
  return buildAssetFamilyCrossAssetArbitrageSummary(scoreSnapshot, {
    ...options,
    assetFamily: "btc",
    assetPredicate: options.assetPredicate || isBtcLikeAsset,
  });
}

export function buildEthCrossAssetArbitrageSummary(scoreSnapshot, options = {}) {
  return buildAssetFamilyCrossAssetArbitrageSummary(scoreSnapshot, {
    ...options,
    assetFamily: "eth",
    assetPredicate: options.assetPredicate || isEthLikeAsset,
  });
}
