import { buildDefaultRiskPolicy } from "../risk/policy.mjs";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function inputBlockers(inputFreshness = null) {
  if (!inputFreshness) return [];
  const fields = [
    ["gatewayQuote", "gateway_quote"],
    ["exactGas", "exact_gas"],
    ["srcGas", "src_gas"],
    ["dexQuote", "dex_quote"],
    ["bitcoinFee", "bitcoin_fee"],
    ["marketSnapshot", "market"],
  ];
  return fields.flatMap(([field, code]) => {
    const state = inputFreshness[field]?.state || null;
    if (state === "stale") return [`stale_${code}`];
    if (state === "missing") return [`missing_${code}`];
    if (state === "blocked") return [`blocked_${code}`];
    return [];
  });
}

export function buildTinyCanaryAdmission({
  prelive = null,
  executionStage = null,
  manualReviewCandidate = null,
  overall = null,
} = {}) {
  const riskPolicy = buildDefaultRiskPolicy();
  const candidate = manualReviewCandidate || null;
  const strategyCandidate = candidate?.candidateType === "strategy";
  const candidateReady = Boolean(
    strategyCandidate ? candidate?.candidateId || candidate?.candidateLabel : candidate?.routeLabel || candidate?.routeKey,
  ) && Boolean(strategyCandidate ? Number.isFinite(candidate?.perTradeCapUsd) || candidate?.amount : candidate?.amount);
  const freshnessBlockers = strategyCandidate ? [] : inputBlockers(candidate?.inputFreshness || null);
  const strategyEvidenceBlockers = strategyCandidate ? unique([...(candidate?.evidenceBlockers || []), ...(candidate?.blockerReasons || [])]) : [];
  const preliveBlockers = strategyCandidate
    ? strategyEvidenceBlockers
    : unique([
        ...(prelive?.tinyLiveCanary?.blockers || []),
        ...(executionStage?.reviewReasons || []),
      ]);
  const reviewReady = strategyCandidate
    ? candidate?.reviewReady === true || candidate?.tradeReadiness === "strategy_candidate_review_only"
    : executionStage?.reviewStage === "READY_FOR_MANUAL_CANARY_REVIEW";
  const preliveReady = strategyCandidate ? candidate?.preliveReady === true && strategyEvidenceBlockers.length === 0 : Boolean(prelive?.tinyLiveCanary?.ready);
  const tradeReady =
    (strategyCandidate && reviewReady) ||
    candidate?.tradeReadiness === "shadow_candidate_review_only" ||
    candidate?.tradeReadiness === "review_only_canary_candidate" ||
    reviewReady;
  const livePolicyBlocked = (overall?.liveTrading || "BLOCKED") === "BLOCKED";

  const requirements = [
    {
      code: "candidate_selected",
      label: "manual review candidate selected",
      status: candidateReady ? "passed" : "blocked",
      blockers: candidateReady ? [] : ["missing_manual_review_candidate"],
    },
    {
      code: "objective_review_ready",
      label: "objective review reached manual canary stage",
      status: reviewReady && tradeReady ? "passed" : "blocked",
      blockers: reviewReady && tradeReady ? [] : unique([strategyCandidate ? "strategy_candidate_not_ready" : "manual_review_stage_not_ready", ...preliveBlockers]),
    },
    {
      code: "fresh_inputs",
      label: "required gateway, gas, DEX, and market inputs are fresh",
      status: freshnessBlockers.length === 0 ? "passed" : "blocked",
      blockers: freshnessBlockers,
    },
    {
      code: "prelive_evidence_complete",
      label: "shadow replay, simulation, and fork evidence are complete",
      status: preliveReady ? "passed" : "blocked",
      blockers: preliveReady ? [] : preliveBlockers,
    },
    {
      code: "live_policy_blocked_for_manual_review",
      label: "live trading remains blocked until manual approval",
      status: livePolicyBlocked ? "passed" : "blocked",
      blockers: livePolicyBlocked ? [] : ["live_policy_state_changed"],
    },
    {
      code: "manual_approval_required",
      label: "manual approval is still required before any live canary",
      status: "required",
      blockers: [],
    },
  ];

  const blockers = unique(
    requirements
      .filter((item) => item.status === "blocked")
      .flatMap((item) => item.blockers),
  );
  const decision = blockers.length === 0 ? "GO_FOR_MANUAL_APPROVAL" : "NO_GO";

  return {
    schemaVersion: 1,
    decision,
    status: decision === "GO_FOR_MANUAL_APPROVAL" ? "manual_approval_required" : "blocked",
    blockers,
    requirements,
    candidate: candidate
      ? {
          candidateType: candidate.candidateType || "route",
          candidateId: candidate.candidateId || candidate.routeKey || null,
          candidateLabel: candidate.candidateLabel || candidate.routeLabel || null,
          routeKey: candidate.routeKey || null,
          routeLabel: candidate.routeLabel || null,
          amount: candidate.amount || null,
          amountUnit: candidate.amountUnit || null,
          perTradeCapUsd: candidate.perTradeCapUsd ?? null,
          tradeReadiness: candidate.tradeReadiness || null,
          viableForPrep: candidate.viableForPrep ?? null,
          txReady: candidate.txReady ?? null,
          netEdgeUsd: candidate.netEdgeUsd ?? null,
          prepFundingUsd: candidate.prepFundingUsd ?? null,
        }
      : null,
    constraints: {
      liveTradingPolicy: overall?.liveTrading || "BLOCKED",
      capitalRule: overall?.capitalRule || null,
      riskBudgetUsd: overall?.riskBudgetUsd ?? riskPolicy.projectLossCapUsd ?? null,
      projectLossCapUsd: riskPolicy.projectLossCapUsd ?? null,
      dailyLossCapUsd: riskPolicy.dailyLossCapUsd ?? null,
      canaryWalletFloorUsd: riskPolicy.canaryWalletFloorUsd ?? null,
      minNetProfitUsd: riskPolicy.minNetProfitUsd,
      minNetProfitPct: riskPolicy.minNetProfitPct,
    },
    nextActionCode: decision === "GO_FOR_MANUAL_APPROVAL" ? "manual_approval_required" : candidate?.nextAction?.code || "clear_admission_blockers",
    nextActionCommand: decision === "GO_FOR_MANUAL_APPROVAL" ? null : candidate?.nextAction?.command || null,
  };
}
