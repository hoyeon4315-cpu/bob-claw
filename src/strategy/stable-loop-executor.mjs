import { shellQuote } from "../lib/shell-quote.mjs";
import { buildStrategyRefreshPlans } from "./strategy-refresh-plans.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function money(value) {
  return Number.isFinite(value) ? Math.round(value * 10_000) / 10_000 : null;
}

function routeQuoteCommand(routeKey) {
  if (!routeKey) return null;
  return `npm run quote:dex -- --route-key=${shellQuote(routeKey)} --include-stable-entry`;
}

function normalizeLoop(loop = null) {
  if (!loop) return null;
  return {
    entryRouteKey: loop.entryRouteKey || null,
    exitRouteKey: loop.exitRouteKey || null,
    entryAmount: loop.entryAmount || null,
    exitAmount: loop.exitAmount || null,
    amountGapPct: Number.isFinite(loop.amountGapPct) ? loop.amountGapPct : null,
    exactAmountMatch: loop.exactAmountMatch === true,
    closedLoop: loop.closedLoop === true,
    loopNetEdgeUsd: money(loop.loopNetEdgeUsd),
    blockers: [...new Set(loop.blockers || [])],
  };
}

function determineStatus(loop = null, pair = null) {
  if (loop && (loop.blockers || []).length === 0 && Number.isFinite(loop.loopNetEdgeUsd) && loop.loopNetEdgeUsd > 0) {
    return "candidate_for_validation";
  }
  if (pair) return "quote_refresh_required";
  return "coverage_missing";
}

function buildExecutionSteps(loop = null, pair = null) {
  if (!pair) return [];
  return [
    {
      step: 1,
      kind: "refresh_entry_quote",
      routeKey: pair.entryRouteKey,
      command: routeQuoteCommand(pair.entryRouteKey),
    },
    {
      step: 2,
      kind: "refresh_exit_quote",
      routeKey: pair.exitRouteKey,
      command: routeQuoteCommand(pair.exitRouteKey),
    },
    {
      step: 3,
      kind: "verify_amount_ladder",
      exactMatchCount: pair.exactMatchCount || 0,
      entryAmountLevelCount: pair.entryAmountLevelCount || 0,
      exitAmountLevelCount: pair.exitAmountLevelCount || 0,
    },
    {
      step: 4,
      kind: "verify_closed_loop",
      expected: true,
      observed: loop?.closedLoop === true,
    },
    {
      step: 5,
      kind: "verify_positive_net_edge",
      expectedPositiveUsd: true,
      observedNetEdgeUsd: money(loop?.loopNetEdgeUsd),
    },
  ];
}

export function buildStableLoopExecutorReport({
  crossAssetArbitrage = null,
  laneReclassification = null,
  now = null,
} = {}) {
  const pair = crossAssetArbitrage?.bestAmountLadderPair || null;
  const bestLoop = normalizeLoop(crossAssetArbitrage?.bestLoop || null);
  const closestLoop = normalizeLoop(crossAssetArbitrage?.closestLoop || null);
  const selectedLoop = bestLoop || closestLoop;
  const refreshPlans = buildStrategyRefreshPlans({ crossAssetArbitrage });
  const nextAction = refreshPlans.stableLoop || null;
  const lane = (laneReclassification?.lanes || []).find((item) => item.id === "stablecoin_entry_exit_loops") || null;
  const status = determineStatus(selectedLoop, pair);
  const blockers = unique([
    ...(selectedLoop?.blockers || []),
    !pair ? "stable_loop_amount_ladder_missing" : null,
    lane?.passesOverfitGate === false ? "overfit_gate_blocked" : null,
  ]);
  const commandChain = unique([
    routeQuoteCommand(pair?.entryRouteKey),
    routeQuoteCommand(pair?.exitRouteKey),
    "npm run report:lane-reclassification -- --write",
    "npm run status:dashboard",
  ]);

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    strategyId: "stablecoin_entry_exit_loops",
    status,
    laneStatus: lane?.statusNew || null,
    selectedPair: pair
      ? {
          entryRouteKey: pair.entryRouteKey,
          exitRouteKey: pair.exitRouteKey,
          entryAmountLevelCount: pair.entryAmountLevelCount || 0,
          exitAmountLevelCount: pair.exitAmountLevelCount || 0,
          observedPairCount: pair.observedPairCount || 0,
          exactMatchCount: pair.exactMatchCount || 0,
          positiveLoopCount: pair.positiveLoopCount || 0,
          closestAmountGapPct: Number.isFinite(pair.closestAmountGapPct) ? pair.closestAmountGapPct : null,
          topBlocker: pair.blockerCounts?.[0]?.blocker || null,
        }
      : null,
    selectedLoop,
    evidence: {
      matchedLoopCount: crossAssetArbitrage?.matchedLoopCount || 0,
      closedLoopCount: crossAssetArbitrage?.closedLoopCount || 0,
      profitableClosedLoopCount: crossAssetArbitrage?.profitableClosedLoopCount || 0,
      amountLadderPairCount: crossAssetArbitrage?.amountLadderPairCount || 0,
      laneNetPnlMeasuredUsd: lane?.netPnlMeasuredUsd ?? null,
      gasSlippageVarianceUsd: lane?.gasSlippageVarianceUsd ?? null,
    },
    executionPlan: {
      runnerKind: "command_sequence",
      actionCount: pair ? 5 : 0,
      commandChain,
      steps: buildExecutionSteps(selectedLoop, pair),
    },
    blockers,
    readiness: {
      readyForExecutorDryRun: Boolean(pair),
      readyForLive: false,
    },
    nextAction: {
      code: nextAction?.nextAction || "collect_stable_loop_coverage",
      reason: nextAction?.reason || "no_paired_stable_loop_ladder",
      command: nextAction?.command || null,
      routeKeys: nextAction?.routeKeys || [],
    },
    notes: [
      "This executor surface is deterministic and command-sequenced; it does not bypass policy or signer gating.",
      "Stable loop promotion still requires durable quote coverage, amount-ladder closure, and repeated positive net edge outside the variance floor.",
    ],
  };
}
