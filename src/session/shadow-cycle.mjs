import { planNextReadinessRefresh } from "../estimator/readiness-refresh.mjs";
import { summarizeShadowCandidateEvidence } from "./shadow-evidence.mjs";
import { buildShadowRefreshQueue } from "./shadow-refresh-queue.mjs";
import { buildEdgeResearchSummary } from "../strategy/edge-research.mjs";
import { buildEdgeViabilitySummary } from "../strategy/edge-viability.mjs";
import { buildNoEdgePersistenceSummary } from "../strategy/no-edge-persistence.mjs";
import { buildObjectivePlans } from "../strategy/objective-plans.mjs";
import { buildPivotDecisionSummary, buildRouteEconomicsAudit } from "../strategy/route-economics-audit.mjs";
import { buildStrategyRefreshPlans } from "../strategy/strategy-refresh-plans.mjs";
import { shellQuote } from "../lib/shell-quote.mjs";
import { ETHEREUM_L1_PHASE_DISABLED_REASON, hasEthereumL1PhaseBlock } from "../risk/ethereum-l1-policy.mjs";

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
  if (hasEthereumL1PhaseBlock(candidate)) return 6;
  if (candidate.prepBlockers?.includes("wallet_not_checked")) return 1;
  if (candidate.readinessFailureReason) return 2;
  if (!candidate.txReady) return 3;
  if (candidate.scoreDisqualifiers?.length) return 4;
  return 5;
}

function evidencePriority(candidate, evidence) {
  if (!candidate) return { score: -1, reason: "no_candidate" };
  if (!evidence) return { score: 100, reason: "no_shadow_evidence" };
  if ((evidence.shadowObservationCount || 0) === 0) return { score: 90, reason: "no_shadow_evidence" };
  if ((evidence.quoteAttemptCount || 0) < 2) return { score: 80, reason: "thin_quote_samples" };
  if (Number.isFinite(evidence.quoteSuccessRate) && evidence.quoteSuccessRate < 0.8) return { score: 70, reason: "low_quote_success_rate" };
  if ((evidence.shadowObservationCount || 0) < 3) return { score: 60, reason: "thin_shadow_observations" };
  if (Number.isFinite(evidence.quoteLatencyP95Ms) && evidence.quoteLatencyP95Ms > 2_000) return { score: 50, reason: "high_quote_latency" };
  return { score: 10, reason: "evidence_accumulating" };
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
  if (hasEthereumL1PhaseBlock(top)) {
    return {
      code: "awaiting_policy_review",
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
    .filter((candidate) => !hasEthereumL1PhaseBlock(candidate))
    .filter((candidate) => candidate.tradeReadiness !== "reject_no_net_edge")
    .filter((candidate) => {
      const indicativeEdge = Number.isFinite(candidate.executableNetEdgeUsd)
        ? candidate.executableNetEdgeUsd
        : candidate.netEdgeUsd;
      return !Number.isFinite(indicativeEdge) || indicativeEdge > 0;
    })
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
  const addressArg = address ? ` --address=${shellQuote(address)}` : "";
  return `npm run check:estimator-wallet -- --route-key=${shellQuote(check.routeKey)} --amount=${shellQuote(check.amount)}${addressArg}`;
}

function verifyRouteCommand(candidate) {
  if (!candidate?.routeKey || !candidate?.amount) return null;
  return `npm run verify:gateway -- --route-key=${shellQuote(candidate.routeKey)} --amounts=${shellQuote(candidate.amount)}`;
}

function exactGasCommand(address, candidate) {
  if (!candidate?.routeKey || !candidate?.amount) return null;
  const fromArg = address ? ` --from=${shellQuote(address)}` : "";
  return `npm run estimate:gateway-gas -- --route-key=${shellQuote(candidate.routeKey)} --amount=${shellQuote(candidate.amount)}${fromArg}`;
}

function dexRefreshCommand(candidate) {
  if (!candidate?.routeKey || !candidate?.amount) return null;
  return `npm run quote:dex -- --route-key=${shellQuote(candidate.routeKey)} --amount=${shellQuote(candidate.amount)} --include-stable-entry && npm run score:gateway -- --write --route-key=${shellQuote(candidate.routeKey)} --amount=${shellQuote(candidate.amount)}`;
}

function scoreRefreshCommand(candidate) {
  if (!candidate?.routeKey || !candidate?.amount) return null;
  return `npm run score:gateway -- --write --route-key=${shellQuote(candidate.routeKey)} --amount=${shellQuote(candidate.amount)}`;
}

export function shadowActionForCandidate(candidate, { address = null } = {}) {
  if (!candidate?.routeKey || !candidate?.amount) return null;

  if (hasEthereumL1PhaseBlock(candidate)) {
    return {
      code: "hold_policy_review",
      label: "hold for Ethereum L1 fee review",
      reason: ETHEREUM_L1_PHASE_DISABLED_REASON,
      command: null,
    };
  }

  if (!candidate.txReady) {
    return {
      code: "capture_tx_payload",
      label: "capture route payload",
      reason: "missing_tx_data",
      command: verifyRouteCommand(candidate),
    };
  }

  if (candidate.prepBlockers?.includes("wallet_not_checked") || candidate.readinessFailureReason || (candidate.prepBlockers || []).length > 0) {
    return {
      code: "check_wallet_readiness",
      label: "refresh wallet readiness",
      reason: candidate.readinessFailureReason || candidate.prepBlockers?.[0] || "wallet_not_checked",
      command: readinessCommand(address, candidate),
    };
  }

  if (candidate.scoreDisqualifiers?.includes("exact_src_execution_gas_reverted")) {
    return {
      code: "hold_blocked_exact_gas",
      label: "hold on exact gas revert",
      reason: "exact_src_execution_gas_reverted",
      command: null,
    };
  }

  if (!candidate.exactGasDone || candidate.scoreDisqualifiers?.includes("stale_src_gas_snapshot")) {
    return {
      code: "refresh_exact_gas",
      label: "refresh exact gas",
      reason: candidate.scoreDisqualifiers?.includes("stale_src_gas_snapshot") ? "stale_src_gas_snapshot" : "exact_src_execution_gas_not_estimated",
      command: exactGasCommand(address, candidate),
    };
  }

  if (candidate.tradeReadiness === "insufficient_data") {
    return {
      code: "refresh_dex_and_score",
      label: "refresh DEX legs and rescore",
      reason: "insufficient_data",
      command: dexRefreshCommand(candidate),
    };
  }

  if (candidate.tradeReadiness === "reject_no_net_edge") {
    return {
      code: "wait_for_fresh_inputs",
      label: "wait for fresher market inputs",
      reason: "reject_no_net_edge",
      command: null,
    };
  }

  if (candidate.tradeReadiness === "shadow_candidate_review_only") {
    return {
      code: "review_candidate",
      label: "manual review candidate",
      reason: "shadow_candidate_review_only",
      command: scoreRefreshCommand(candidate),
    };
  }

  return {
    code: "rescore_candidate",
    label: "rescore candidate",
    reason: candidate.tradeReadiness || "unknown",
    command: scoreRefreshCommand(candidate),
  };
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

export function stripVolatileShadowCycleFields(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return summary;
  const { observedAt, ...stable } = summary;
  return stable;
}

export function buildRouteDemandFromCanaryState(routePlan) {
  return (routePlan?.topCandidates || [])
    .filter((item) => item.viableForPrep)
    .flatMap((item) => [
      { chain: item.srcChain },
      { chain: item.srcChain, token: item.routeKey.split(":")[1]?.split("->")[0] || null },
    ]);
}

function shadowRosterRole(candidate, index) {
  if (index === 0) return "active_canary";
  if (candidate?.viableForPrep) return "prep_candidate";
  if (candidate?.txReady) return "tx_ready_shadow";
  return "research_candidate";
}

function summarizeShadowRoster(routePlan, evidenceInput = {}, limit = 5) {
  const topCandidates = routePlan?.topCandidates || [];
  const activeCandidate = topCandidates[0] || null;
  const shadowCandidates = topCandidates.slice(1).map((candidate) => {
    const evidence = summarizeShadowCandidateEvidence({
      candidate,
      quotes: evidenceInput.quotes || [],
      quoteFailures: evidenceInput.quoteFailures || [],
      shadowObservations: evidenceInput.shadowObservations || [],
      scores: evidenceInput.scores || [],
    });
    const priority = evidencePriority(candidate, evidence);
    return { candidate, evidence, priority };
  });
  shadowCandidates.sort((left, right) =>
    right.priority.score - left.priority.score ||
    candidatePriority(left.candidate) - candidatePriority(right.candidate) ||
    String(left.candidate.amount).localeCompare(String(right.candidate.amount)),
  );
  const ordered = [activeCandidate, ...shadowCandidates.map((item) => item.candidate)].filter(Boolean).slice(0, limit);
  return {
    candidateCount: routePlan?.candidateCount ?? ordered.length,
    viableCount: routePlan?.viableCount ?? ordered.filter((item) => item?.viableForPrep).length,
    txReadyCount: routePlan?.txReadyCount ?? ordered.filter((item) => item?.txReady).length,
    candidates: ordered.map((candidate, index) => {
      const evidence = summarizeShadowCandidateEvidence({
        candidate,
        quotes: evidenceInput.quotes || [],
        quoteFailures: evidenceInput.quoteFailures || [],
        shadowObservations: evidenceInput.shadowObservations || [],
        scores: evidenceInput.scores || [],
      });
      const priority = evidencePriority(candidate, evidence);
      return ({
      role: shadowRosterRole(candidate, index),
      routeKey: candidate.routeKey,
      label: candidate.label,
      amount: candidate.amount,
      srcChain: candidate.srcChain || null,
      dstChain: candidate.dstChain || null,
      viableForPrep: Boolean(candidate.viableForPrep),
      txReady: Boolean(candidate.txReady),
      tradeReadiness: candidate.tradeReadiness || null,
      prepFundingUsd: candidate.prepFundingUsd ?? null,
      netEdgeUsd: candidate.netEdgeUsd ?? null,
      prepBlockers: candidate.prepBlockers || [],
      scoreDisqualifiers: candidate.scoreDisqualifiers || [],
      readinessFailureReason: candidate.readinessFailureReason || null,
      shadowPriorityScore: priority.score,
      shadowPriorityReason: priority.reason,
      evidence,
    });
    }),
  };
}

function summarizeShadowActions(routePlan, { address = null, limit = 4 } = {}) {
  return (routePlan?.topCandidates || [])
    .slice(0, limit)
    .map((candidate, index) => {
      const nextAction = shadowActionForCandidate(candidate, { address });
      if (!nextAction) return null;
      return {
        role: shadowRosterRole(candidate, index),
        routeKey: candidate.routeKey,
        label: candidate.label,
        amount: candidate.amount,
        code: nextAction.code,
        actionLabel: nextAction.label,
        reason: nextAction.reason,
        command: nextAction.command,
      };
    })
    .filter(Boolean);
}

export function buildShadowCycleSummary({
  canaryState,
  treasuryPlan,
  fundingSourcePlan,
  refillJobs,
  routePerformance,
  riskState,
  quotes = [],
  quoteFailures = [],
  shadowObservations = [],
  scoreSnapshot = null,
  strategy = null,
  ethFamilyWatch = null,
}) {
  const nextStep = canaryState?.nextStep || null;
  const topRoute = canaryState?.routePlan?.topCandidates?.[0] || null;
  const readinessChecks = summarizeReadinessChecks(canaryState?.routePlan, treasuryPlan);
  const nextReadinessCheck = readinessChecks[0] || null;
  const nextReadinessRefresh = summarizeNextReadinessRefresh(canaryState, nextReadinessCheck);
  const enabledRoutes = routePerformance?.routes?.filter((item) => item.enabledState === "enabled_review_only") || [];
  const shadowActions = summarizeShadowActions(canaryState?.routePlan, { address: canaryState?.address || null });
  const strategyPlans = buildStrategyRefreshPlans({
    crossAssetArbitrage: strategy?.crossAssetArbitrage || null,
    btcProxySpreads: strategy?.btcProxySpreads || null,
  });
  const objectivePlans = buildObjectivePlans({
    routePlan: canaryState?.routePlan || null,
    scoreSnapshot,
    shadowObservations,
    dexQuotes: canaryState?.dexQuotes || [],
    address: canaryState?.address || null,
  });
  const edgeViability = buildEdgeViabilitySummary({
    scoreSnapshot,
    dexQuotes: canaryState?.dexQuotes || [],
  });
  const edgeResearch = buildEdgeResearchSummary({
    scoreSnapshot,
    shadowObservations,
  });
  const noEdgePersistence = buildNoEdgePersistenceSummary({
    scoreSnapshot,
    dexQuotes: canaryState?.dexQuotes || [],
  });
  const economicsAudit = buildRouteEconomicsAudit({
    scoreSnapshot,
    routePlan: canaryState?.routePlan || null,
    edgeViability,
    edgeResearch,
    noEdgePersistence,
    quotes,
    quoteFailures,
    shadowObservations,
  });
  const pivotDecision = buildPivotDecisionSummary({
    economicsAudit,
    objectivePlans,
  });

  const blockers = dedupe([
    ...(nextStep?.reasons || []),
    ...(treasuryPlan?.reasons || []),
    ...(treasuryPlan?.blockers || []).map((item) => item.type),
    ...(fundingSourcePlan?.reasons || []),
    ...(enabledRoutes.length === 0 ? ["no_realized_enabled_routes"] : []),
  ]);
  const economicallyBlocked =
    fundingSourcePlan?.reasons?.includes("route_refill_economically_unjustified") ||
    fundingSourcePlan?.summary?.economicallyJustified === false ||
    (Number.isFinite(fundingSourcePlan?.summary?.effectiveSystemNetPnlUsd) && fundingSourcePlan.summary.effectiveSystemNetPnlUsd <= 0);

  let mode = "SHADOW_ONLY";
  let headline = "Collect more shadow and realized data";

  if (economicallyBlocked) {
    mode = "CANARY_PREP_BLOCKED";
    headline = "Best prepared route is still economically blocked after refill costs";
  } else if (nextStep?.decision === "FUND_AND_APPROVE_WALLET" || String(nextStep?.decision || "").startsWith("BLOCKED")) {
    mode = "CANARY_PREP_BLOCKED";
    headline = nextStep?.headline || "Canary prep is blocked by wallet or route prerequisites";
  } else if (enabledRoutes.length > 0 && nextStep && !String(nextStep.decision).startsWith("BLOCKED")) {
    mode = "REVIEW_CANARY_PROGRESS";
    headline = "At least one route has positive realized review-only status";
  } else if (topRoute?.tradeReadiness === "shadow_candidate_review_only") {
    mode = "SHADOW_REVIEW_ONLY";
    headline = "Estimated route quality exists, but realized evidence is still missing";
  }

  const refreshQueue = buildShadowRefreshQueue({
    address: canaryState?.address || null,
    nextReadinessCheck,
    readinessRecords: canaryState?.readinessRecords || [],
    readinessFailures: canaryState?.readinessFailures || [],
    shadowActions,
    objectivePlans,
    strategyPlans,
    ethFamilyWatch,
    mode,
    enabledRouteCount: enabledRoutes.length,
    treasuryDecision: treasuryPlan?.decision || null,
    fundingReasonCount: fundingSourcePlan?.reasons?.length || 0,
    now: new Date(),
  });

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
    shadowRoster: summarizeShadowRoster(
      canaryState?.routePlan,
      {
        quotes,
        quoteFailures,
        shadowObservations,
        scores: scoreSnapshot?.scores || [],
      },
    ),
    objectivePlans,
    pivotDecision,
    strategyPlans,
    shadowActions,
    refreshQueue,
    ethFamilyWatch: ethFamilyWatch
      ? {
          observedAt: ethFamilyWatch.observedAt || null,
          routeCount: Number.isFinite(ethFamilyWatch.routeCount) ? ethFamilyWatch.routeCount : 0,
          surfaceChanged: Boolean(ethFamilyWatch.surfaceChanged),
          addedRoutes: dedupe(ethFamilyWatch.addedRoutes || []),
          removedRoutes: dedupe(ethFamilyWatch.removedRoutes || []),
          chainPairs: dedupe(ethFamilyWatch.chainPairs || []),
          addedChainPairs: dedupe(ethFamilyWatch.addedChainPairs || []),
          removedChainPairs: dedupe(ethFamilyWatch.removedChainPairs || []),
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
          reasonCount: fundingSourcePlan.reasons?.length ?? 0,
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
      pivotDecision?.command,
      ...refreshQueue.map((item) => item.command),
    ]),
  };
}
