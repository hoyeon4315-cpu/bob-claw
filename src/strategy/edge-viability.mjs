import { buildDefaultRiskPolicy } from "../risk/policy.mjs";
import { buildDexGatewayLoops } from "./dex-gateway-arbitrage.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function requiredNetProfitUsd(loop, policy) {
  const percentFloorUsd = Number.isFinite(loop?.entryStableUsd) ? loop.entryStableUsd * policy.minNetProfitPct : null;
  return Math.max(policy.minNetProfitUsd, percentFloorUsd || 0);
}

function enrichLoop(loop, policy) {
  const measuredLoopNetUsd = finite(loop?.measuredLoopNetUsd);
  const requiredProfitUsd = requiredNetProfitUsd(loop, policy);
  const gapToBreakEvenUsd = Number.isFinite(measuredLoopNetUsd) ? Math.max(0, 0 - measuredLoopNetUsd) : null;
  const gapToPolicyUsd = Number.isFinite(measuredLoopNetUsd) ? Math.max(0, requiredProfitUsd - measuredLoopNetUsd) : null;
  const netPctOfEntry =
    Number.isFinite(measuredLoopNetUsd) && Number.isFinite(loop?.entryStableUsd) && loop.entryStableUsd > 0
      ? measuredLoopNetUsd / loop.entryStableUsd
      : null;
  return {
    routeKey: loop.routeKey,
    amount: loop.amount,
    srcChain: loop.srcChain,
    dstChain: loop.dstChain,
    srcTicker: loop.srcTicker || null,
    dstTicker: loop.dstTicker || null,
    entryStableUsd: finite(loop.entryStableUsd),
    measuredLoopNetUsd,
    requiredNetProfitUsd: finite(requiredProfitUsd),
    requiredNetProfitPct: policy.minNetProfitPct,
    gapToBreakEvenUsd: finite(gapToBreakEvenUsd),
    gapToPolicyUsd: finite(gapToPolicyUsd),
    netPctOfEntry: finite(netPctOfEntry),
    blockers: loop.blockers || [],
    exactAmountMatch: Boolean(loop.exactAmountMatch),
  };
}

export function buildEdgeViabilitySummary({ scoreSnapshot = null, dexQuotes = [] } = {}, options = {}) {
  const policy = {
    ...buildDefaultRiskPolicy(),
    ...(options.policy || {}),
  };
  const { loops } = buildDexGatewayLoops({ scoreSnapshot, dexQuotes }, options);
  const measuredLoops = loops
    .filter((loop) => Number.isFinite(loop.measuredLoopNetUsd))
    .map((loop) => enrichLoop(loop, policy));

  const sortable = [...measuredLoops].sort(
    (left, right) =>
      (left.gapToPolicyUsd ?? Number.POSITIVE_INFINITY) - (right.gapToPolicyUsd ?? Number.POSITIVE_INFINITY) ||
      (right.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) - (left.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) ||
      String(left.routeKey).localeCompare(String(right.routeKey)),
  );
  const gapSamples = measuredLoops.map((loop) => loop.gapToPolicyUsd).filter(Number.isFinite);
  const positiveMeasuredCount = measuredLoops.filter((loop) => (loop.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) > 0).length;
  const policyReadyCount = measuredLoops.filter((loop) => (loop.gapToPolicyUsd ?? Number.POSITIVE_INFINITY) <= 0).length;

  return {
    schemaVersion: 1,
    generatedAt: scoreSnapshot?.generatedAt || null,
    minNetProfitUsd: policy.minNetProfitUsd,
    minNetProfitPct: policy.minNetProfitPct,
    measuredLoopCount: measuredLoops.length,
    positiveMeasuredCount,
    policyReadyCount,
    medianGapToPolicyUsd: median(gapSamples),
    closestLoop: sortable[0] || null,
    bestMeasuredLoop:
      [...measuredLoops].sort(
        (left, right) =>
          (right.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) - (left.measuredLoopNetUsd ?? Number.NEGATIVE_INFINITY) ||
          String(left.routeKey).localeCompare(String(right.routeKey)),
      )[0] || null,
    loops: sortable.slice(0, 10),
  };
}

export function buildEdgeViabilityVerdict({ edgeViability = null, dexRouteFocus = null } = {}) {
  const missingGatewayQuoteCount = dexRouteFocus?.missingGatewayQuoteCount || 0;
  const closestGap = edgeViability?.closestLoop?.gapToPolicyUsd;

  if ((edgeViability?.policyReadyCount || 0) > 0) {
    return {
      code: "policy_ready",
      label: "policy-ready edge observed",
      detail: "At least one measured loop clears the minimum profit gate.",
    };
  }

  if ((edgeViability?.positiveMeasuredCount || 0) > 0) {
    return {
      code: "positive_but_below_policy",
      label: "positive but still below policy",
      detail: "Some measured loops are above break-even, but none reach the minimum profit gate yet.",
    };
  }

  if ((edgeViability?.measuredLoopCount || 0) === 0) {
    return {
      code: missingGatewayQuoteCount > 0 ? "coverage_still_incomplete" : "no_measured_loops",
      label: missingGatewayQuoteCount > 0 ? "coverage still incomplete" : "no measured loops yet",
      detail: missingGatewayQuoteCount > 0
        ? "Some fully measurable routes still need Gateway coverage before the universe is fully tested."
        : "No closed measured loop is available yet.",
    };
  }

  if (missingGatewayQuoteCount > 0) {
    return {
      code: "coverage_still_incomplete",
      label: "coverage still incomplete",
      detail: "Closed loops exist, but the measurable universe is not fully covered yet.",
    };
  }

  if (Number.isFinite(closestGap) && closestGap <= 0.15) {
    return {
      code: "near_policy",
      label: "near policy but not there yet",
      detail: "The best measured loop is close to the policy gate, so repeated remeasurement may still matter.",
    };
  }

  if (Number.isFinite(closestGap) && closestGap <= 0.5) {
    return {
      code: "below_policy",
      label: "below policy",
      detail: "Measured loops are consistently below the minimum profit gate.",
    };
  }

  return {
    code: "measured_no_edge",
    label: "measured no-edge universe",
    detail: "The currently measurable closed-loop universe has been tested and still sits well below the minimum profit gate.",
  };
}
