function findChainFunding(chainPlans, chain) {
  return chainPlans.find((item) => item.chain === chain) || null;
}

function requiredFundingActions(candidate, fundingPlan) {
  const chainPlan = findChainFunding(fundingPlan.chains || [], candidate.srcChain);
  if (!chainPlan) return [];

  const actions = [];
  if (candidate.prepBlockers.includes("native") && chainPlan.native && !chainPlan.native.ok) {
    actions.push({
      type: "fund_native",
      chain: candidate.srcChain,
      ticker: chainPlan.native.ticker,
      shortfall: chainPlan.native.shortfall,
      shortfallDecimal: chainPlan.native.shortfallDecimal,
    });
  }

  if (candidate.prepBlockers.includes("token")) {
    for (const token of chainPlan.tokens || []) {
      if (token.ok) continue;
      actions.push({
        type: "fund_token",
        chain: candidate.srcChain,
        ticker: token.ticker,
        token: token.token,
        shortfall: token.shortfall,
        shortfallDecimal: token.shortfallDecimal,
      });
    }
  }

  if (candidate.prepBlockers.includes("allowance")) {
    for (const allowance of chainPlan.allowances || []) {
      if (allowance.ok) continue;
      actions.push({
        type: "approve_allowance",
        chain: candidate.srcChain,
        ticker: allowance.ticker,
        token: allowance.token,
        spender: allowance.spender,
        shortfall: allowance.shortfall,
        shortfallDecimal: allowance.shortfallDecimal,
      });
    }
  }

  return actions;
}

function economicPrepRejectionReasons(candidate = {}) {
  if (Number.isFinite(candidate.effectiveSystemNetPnlUsd) && candidate.effectiveSystemNetPnlUsd <= 0) {
    return ["effective_system_net_pnl_not_positive"];
  }
  if (Number.isFinite(candidate.executableNetEdgeUsd) && candidate.executableNetEdgeUsd <= 0) {
    return ["executable_net_edge_not_positive"];
  }
  return [];
}

export function determineCanaryNextStep({ routePlan, fundingPlan }) {
  const best = routePlan?.topCandidates?.[0] || null;

  if (!best) {
    return {
      decision: "BLOCKED_NO_CANDIDATES",
      headline: "No canary route candidate available",
      route: null,
      actions: [],
      reasons: ["no_candidate_route"],
    };
  }

  if (!best.viableForPrep) {
    const staleGasOnly =
      best.txReady &&
      !best.prepBlockers?.length &&
      !best.readinessFailureReason &&
      (best.scoreDisqualifiers || []).length > 0 &&
      (best.scoreDisqualifiers || []).every((reason) => reason === "stale_src_gas_snapshot");
    if (staleGasOnly) {
      return {
        decision: "RUN_EXACT_GAS",
        headline: "Rerun exact gas for the best route after stale gas data",
        route: best,
        actions: [
          {
            type: "estimate_exact_gas",
            routeKey: best.routeKey,
            amount: best.amount,
            chain: best.srcChain,
          },
        ],
        reasons: ["stale_src_gas_snapshot"],
      };
    }
    return {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      headline: "No viable route is ready for canary prep",
      route: best,
      actions: [],
      reasons: [
        ...(best.readinessFailureReason ? [best.readinessFailureReason] : []),
        ...(best.scoreDisqualifiers || []),
        ...(best.txReady ? [] : ["missing_tx_data"]),
      ],
    };
  }

  const economicPrepReasons = economicPrepRejectionReasons(best);
  if (economicPrepReasons.length) {
    return {
      decision: "BLOCKED_ECONOMICALLY_UNJUSTIFIED_PREP",
      headline: "Canary prep is blocked because estimated route economics are non-positive",
      route: best,
      actions: [],
      reasons: [...economicPrepReasons, ...(best.tradeReadiness ? [best.tradeReadiness] : [])],
    };
  }

  if (best.prepBlockers?.length) {
    return {
      decision: "FUND_AND_APPROVE_WALLET",
      headline: "Fund and approve the estimator wallet before exact gas",
      route: best,
      actions: requiredFundingActions(best, fundingPlan),
      reasons: best.prepBlockers,
    };
  }

  if ((best.scoreDisqualifiers || []).includes("exact_src_execution_gas_reverted")) {
    return {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      headline: "Best prepared route is blocked by exact gas revert",
      route: best,
      actions: [],
      reasons: ["exact_src_execution_gas_reverted"],
    };
  }

  if (!best.exactGasDone) {
    return {
      decision: "RUN_EXACT_GAS",
      headline: "Run exact gas estimate for the best prepared route",
      route: best,
      actions: [
        {
          type: "estimate_exact_gas",
          routeKey: best.routeKey,
          amount: best.amount,
          chain: best.srcChain,
        },
      ],
      reasons: ["exact_src_execution_gas_not_estimated"],
    };
  }

  if (best.tradeReadiness === "shadow_candidate_review_only") {
    return {
      decision: "REVIEW_CANARY_CANDIDATE",
      headline: "Best route is prepared for manual canary review",
      route: best,
      actions: [],
      reasons: [],
    };
  }

  if (best.tradeReadiness) {
    return {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      headline: "Best prepared route still fails objective score review",
      route: best,
      actions: [],
      reasons: [best.tradeReadiness],
    };
  }

  return {
    decision: "RERUN_SCORING",
    headline: "Rerun route scoring with exact gas",
    route: best,
    actions: [
      {
        type: "rerun_scoring",
        routeKey: best.routeKey,
        amount: best.amount,
      },
    ],
    reasons: [],
  };
}
