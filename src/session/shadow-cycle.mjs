import { planNextReadinessRefresh } from "../estimator/readiness-refresh.mjs";

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalized(value) {
  return String(value || "").toLowerCase();
}

function treasuryNeedFromAction(action) {
  if (!action) return null;
  return {
    state: "ready_now",
    chain: action.chain,
    ticker: action.asset || action.ticker || null,
    token: action.asset ? null : action.token || null,
    refillAmountDecimal: action.refillAmountDecimal ?? null,
    refillEstimatedUsd: action.refillEstimatedUsd ?? null,
  };
}

function treasuryNeedFromBlocker(blocker) {
  if (!blocker || !String(blocker.type || "").endsWith("_blocked_no_demand")) return null;
  return {
    state: "waiting_demand",
    chain: blocker.chain,
    ticker: blocker.asset || blocker.ticker || null,
    token: blocker.asset ? null : blocker.token || null,
    refillAmountDecimal: blocker.refillAmountDecimal ?? null,
    refillEstimatedUsd: blocker.refillEstimatedUsd ?? null,
  };
}

function compareTreasuryNeeds(left, right) {
  const leftUsd = Number.isFinite(left.refillEstimatedUsd) ? left.refillEstimatedUsd : -1;
  const rightUsd = Number.isFinite(right.refillEstimatedUsd) ? right.refillEstimatedUsd : -1;
  if (leftUsd !== rightUsd) return rightUsd - leftUsd;
  const leftAmount = Number.isFinite(left.refillAmountDecimal) ? left.refillAmountDecimal : -1;
  const rightAmount = Number.isFinite(right.refillAmountDecimal) ? right.refillAmountDecimal : -1;
  if (leftAmount !== rightAmount) return rightAmount - leftAmount;
  return `${left.chain}:${left.ticker}`.localeCompare(`${right.chain}:${right.ticker}`);
}

function candidatePriority(candidate) {
  if (!candidate) return 99;
  if (candidate.viableForPrep) return 0;
  if (candidate.prepBlockers?.includes("wallet_not_checked")) return 1;
  if (candidate.readinessFailureReason) return 2;
  if (!candidate.txReady) return 3;
  if (candidate.scoreDisqualifiers?.length) return 4;
  return 5;
}

function summarizeNeedActivation(routePlan, need) {
  const candidates = (routePlan?.candidates || [])
    .filter((candidate) => {
      if (candidate.srcChain !== need.chain) return false;
      if (!need.token) return true;
      return normalized(candidate.srcToken) === normalized(need.token);
    })
    .sort((left, right) => {
      const leftTickerMatch = need.ticker && left.srcTicker === need.ticker ? 1 : 0;
      const rightTickerMatch = need.ticker && right.srcTicker === need.ticker ? 1 : 0;
      if (leftTickerMatch !== rightTickerMatch) return rightTickerMatch - leftTickerMatch;
      return candidatePriority(left) - candidatePriority(right) || String(left.amount).localeCompare(String(right.amount));
    });

  const top = candidates[0] || null;
  if (!top) {
    return {
      code: "no_candidate_route",
      candidateCount: 0,
      routeLabel: null,
    };
  }
  if (top.viableForPrep) {
    return {
      code: "demand_active_now",
      candidateCount: candidates.length,
      routeLabel: top.label,
    };
  }
  if (!top.txReady) {
    return {
      code: "awaiting_tx_payload",
      candidateCount: candidates.length,
      routeLabel: top.label,
    };
  }
  if (top.prepBlockers?.includes("wallet_not_checked")) {
    return {
      code: "awaiting_wallet_readiness_check",
      candidateCount: candidates.length,
      routeLabel: top.label,
    };
  }
  if (top.readinessFailureReason) {
    return {
      code: "awaiting_wallet_readiness_retry",
      candidateCount: candidates.length,
      routeLabel: top.label,
    };
  }
  if (top.scoreDisqualifiers?.length) {
    return {
      code: "awaiting_score_gap_clear",
      candidateCount: candidates.length,
      routeLabel: top.label,
    };
  }
  return {
    code: "awaiting_route_viability",
    candidateCount: candidates.length,
    routeLabel: top.label,
  };
}

function compareReadinessChecks(left, right) {
  const leftPriority = candidatePriority(left);
  const rightPriority = candidatePriority(right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftEdge = Number.isFinite(left.netEdgeUsd) ? left.netEdgeUsd : Number.NEGATIVE_INFINITY;
  const rightEdge = Number.isFinite(right.netEdgeUsd) ? right.netEdgeUsd : Number.NEGATIVE_INFINITY;
  if (leftEdge !== rightEdge) return rightEdge - leftEdge;
  return String(left.amount).localeCompare(String(right.amount));
}

function summarizeReadinessChecks(routePlan, treasuryPlan) {
  const preferredChains = new Set(
    [
      ...(treasuryPlan?.actions || []).map((item) => item.chain),
      ...(treasuryPlan?.blockers || []).map((item) => item.chain),
    ].filter(Boolean),
  );
  return (routePlan?.candidates || [])
    .filter((candidate) => candidate.prepBlockers?.includes("wallet_not_checked") && candidate.txReady)
    .sort((left, right) => {
      const leftPreferred = preferredChains.has(left.srcChain) ? 1 : 0;
      const rightPreferred = preferredChains.has(right.srcChain) ? 1 : 0;
      if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
      return compareReadinessChecks(left, right);
    })
    .slice(0, 3)
    .map((candidate) => ({
      routeKey: candidate.routeKey,
      label: candidate.label,
      amount: candidate.amount,
      srcChain: candidate.srcChain,
      srcTicker: candidate.srcTicker || null,
      dstChain: candidate.dstChain,
      dstTicker: candidate.dstTicker || null,
      tradeReadiness: candidate.tradeReadiness || null,
    }));
}

function readinessCommand(address, check) {
  if (!check?.routeKey || !check?.amount) return null;
  const addressArg = address ? ` --address=${address}` : "";
  return `npm run check:estimator-wallet -- --route-key=${check.routeKey} --amount=${check.amount}${addressArg}`;
}

function summarizeNextReadinessRefresh(canaryState, nextReadinessCheck) {
  if (!nextReadinessCheck) return null;
  const refresh = planNextReadinessRefresh(
    {
      shadowCycle: { canary: { nextReadinessCheck } },
      readinessRecords: canaryState?.readinessRecords || [],
      readinessFailures: canaryState?.readinessFailures || [],
      address: canaryState?.address || null,
    },
    { maxAgeMs: 300_000 },
  );
  return {
    state: refresh.shouldRefresh ? "ready_now" : "cooldown",
    reason: refresh.reason,
    latestObservedAt: refresh.latestObservedAt,
    ageSeconds: Number.isFinite(refresh.ageMs) ? Math.round(refresh.ageMs / 1000) : null,
    maxAgeSeconds: 300,
  };
}

function summarizeTreasuryNeeds(treasuryPlan, routePlan) {
  return [
    ...(treasuryPlan?.actions || []).map(treasuryNeedFromAction),
    ...(treasuryPlan?.blockers || []).map(treasuryNeedFromBlocker),
  ]
    .filter(Boolean)
    .sort(compareTreasuryNeeds)
    .map((need) => ({
      ...need,
      activation: summarizeNeedActivation(routePlan, need),
    }))
    .slice(0, 3);
}

export function buildRouteDemandFromCanaryState(routePlan) {
  return (routePlan?.topCandidates || [])
    .filter((item) => item.viableForPrep)
    .flatMap((item) => [
      { chain: item.srcChain },
      { chain: item.srcChain, token: item.routeKey.split(":")[1]?.split("->")[0] || null },
    ]);
}

export function buildShadowCycleSummary({
  canaryState,
  treasuryPlan,
  fundingSourcePlan,
  refillJobs,
  routePerformance,
  riskState,
}) {
  const nextStep = canaryState?.nextStep || null;
  const topRoute = canaryState?.routePlan?.topCandidates?.[0] || null;
  const readinessChecks = summarizeReadinessChecks(canaryState?.routePlan, treasuryPlan);
  const nextReadinessCheck = readinessChecks[0] || null;
  const nextReadinessRefresh = summarizeNextReadinessRefresh(canaryState, nextReadinessCheck);
  const enabledRoutes = routePerformance?.routes?.filter((item) => item.enabledState === "enabled_review_only") || [];

  const blockers = dedupe([
    ...(nextStep?.reasons || []),
    ...(treasuryPlan?.reasons || []),
    ...(treasuryPlan?.blockers || []).map((item) => item.type),
    ...(fundingSourcePlan?.reasons || []),
    ...(enabledRoutes.length === 0 ? ["no_realized_enabled_routes"] : []),
  ]);

  let mode = "SHADOW_ONLY";
  let headline = "Collect more shadow and realized data";

  if (nextStep?.decision === "FUND_AND_APPROVE_WALLET" || String(nextStep?.decision || "").startsWith("BLOCKED")) {
    mode = "CANARY_PREP_BLOCKED";
    headline = nextStep?.headline || "Canary prep is blocked by wallet or route prerequisites";
  } else if (enabledRoutes.length > 0 && nextStep && !String(nextStep.decision).startsWith("BLOCKED")) {
    mode = "REVIEW_CANARY_PROGRESS";
    headline = "At least one route has positive realized review-only status";
  } else if (topRoute?.tradeReadiness === "shadow_candidate_review_only") {
    mode = "SHADOW_REVIEW_ONLY";
    headline = "Estimated route quality exists, but realized evidence is still missing";
  }

  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode,
    headline,
    topRoute: topRoute
      ? {
          routeKey: topRoute.routeKey,
          label: topRoute.label,
          amount: topRoute.amount,
          viableForPrep: topRoute.viableForPrep,
          tradeReadiness: topRoute.tradeReadiness,
          netEdgeUsd: topRoute.netEdgeUsd,
          executableNetEdgeUsd: topRoute.executableNetEdgeUsd,
          prepFundingUsd: topRoute.prepFundingUsd,
        }
      : null,
    canary: nextStep
      ? {
          decision: nextStep.decision,
          reasons: nextStep.reasons || [],
          nextReadinessCheck,
          nextReadinessRefresh,
          readinessCheckCount: readinessChecks.length,
        }
      : null,
    treasury: treasuryPlan
      ? {
          decision: treasuryPlan.decision,
          reasons: treasuryPlan.reasons || [],
          refillActionCount: treasuryPlan.summary?.refillActionCount ?? 0,
          blockerCount: treasuryPlan.summary?.blockerCount ?? 0,
          estimatedWalletUsd: treasuryPlan.summary?.estimatedWalletUsd ?? null,
          walletValueFloorUsd: treasuryPlan.summary?.walletValueFloorUsd ?? null,
          walletValueShortfallUsd: treasuryPlan.summary?.walletValueShortfallUsd ?? null,
          noDemandBlockerCount: treasuryPlan.summary?.noDemandBlockerCount ?? 0,
          nextNeeds: summarizeTreasuryNeeds(treasuryPlan, canaryState?.routePlan),
        }
      : null,
    funding: fundingSourcePlan
      ? {
          selectionCount: fundingSourcePlan.summary?.selectionCount ?? 0,
          executionRefillExpectedCostUsd: fundingSourcePlan.summary?.executionRefillExpectedCostUsd ?? null,
          reserveReplenishmentExpectedCostUsd: fundingSourcePlan.summary?.reserveReplenishmentExpectedCostUsd ?? null,
          effectiveSystemNetPnlUsd: fundingSourcePlan.summary?.effectiveSystemNetPnlUsd ?? null,
        }
      : null,
    refillJobs: refillJobs
      ? {
          jobCount: refillJobs.summary?.jobCount ?? 0,
          requiresManualReview: refillJobs.requiresManualReview,
        }
      : null,
    routePerformance: routePerformance
      ? {
          routeVariantCount: routePerformance.summary?.routeVariantCount ?? 0,
          enabledCount: routePerformance.summary?.enabledCount ?? 0,
          realizedRouteCount: routePerformance.summary?.realizedRouteCount ?? 0,
        }
      : null,
    risk: riskState
      ? {
          dailyRealizedPnlUsd: riskState.dailyRealizedPnlUsd,
          projectLossUsedUsd: riskState.projectLossUsedUsd,
          failedGasCost24hUsd: riskState.failedGasCost24hUsd,
          consecutiveFailures: riskState.consecutiveFailures,
        }
      : null,
    blockers,
    recommendedCommands: dedupe([
      nextReadinessCheck ? readinessCommand(canaryState?.address || null, nextReadinessCheck) : null,
      mode === "CANARY_PREP_BLOCKED" ? "npm run advance:canary" : null,
      enabledRoutes.length === 0 ? "npm run report:route-performance -- --write" : null,
      treasuryPlan?.decision === "BLOCKED" || treasuryPlan?.decision === "REVIEW_REFILL_PLAN" ? "npm run plan:treasury-actions -- --json" : null,
      fundingSourcePlan?.reasons?.length ? "npm run plan:treasury-funding-sources -- --json" : null,
    ]),
  };
}
