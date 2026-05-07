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
  const livePolicyAllowed = overall?.liveTrading === "ALLOWED";

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
      code: "live_policy_gate_recorded",
      label: "live policy gate state is recorded",
      status: livePolicyBlocked || livePolicyAllowed ? "passed" : "blocked",
      blockers: livePolicyBlocked || livePolicyAllowed ? [] : ["live_policy_state_unknown"],
    },
    {
      code: livePolicyAllowed ? "auto_execute_policy_ready" : "policy_waiting",
      label: livePolicyAllowed
        ? "auto-execute policy is ready for the selected strategy"
        : "policy approval is still required before any live canary",
      status: livePolicyAllowed ? "passed" : "required",
      blockers: [],
    },
  ];

  const blockers = unique(
    requirements
      .filter((item) => item.status === "blocked")
      .flatMap((item) => item.blockers),
  );
  const decision = blockers.length === 0 ? "GO_FOR_POLICY_READY" : "NO_GO";
  const reconciledDecision = decision === "GO_FOR_POLICY_READY" && livePolicyAllowed ? "GO_FOR_AUTO_EXECUTE" : decision;
  const status = reconciledDecision === "GO_FOR_AUTO_EXECUTE"
    ? "auto_execute_policy_ready"
    : reconciledDecision === "GO_FOR_POLICY_READY"
      ? "policy_waiting"
      : "blocked";
  const nextActionCode = reconciledDecision === "GO_FOR_AUTO_EXECUTE"
    ? "auto_execute_policy_ready"
    : reconciledDecision === "GO_FOR_POLICY_READY"
      ? "policy_waiting"
      : candidate?.nextAction?.code || "clear_admission_blockers";

  return {
    schemaVersion: 1,
    decision: reconciledDecision,
    status,
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
    nextActionCode,
    nextActionCommand: status === "blocked" ? candidate?.nextAction?.command || null : null,
  };
}

export function reconcileTinyCanaryAdmissionWithLivePolicy(admission = null, overall = null) {
  if (!admission) return null;
  const liveTradingPolicy = overall?.liveTrading || admission.constraints?.liveTradingPolicy || "BLOCKED";
  const blockers = admission.blockers || [];
  const staleAutoExecute =
    liveTradingPolicy !== "ALLOWED" &&
    blockers.length === 0 &&
    (admission.decision === "GO_FOR_AUTO_EXECUTE" || admission.status === "auto_execute_policy_ready");
  if (staleAutoExecute) {
    return {
      ...admission,
      decision: "GO_FOR_POLICY_READY",
      status: "policy_waiting",
      requirements: (admission.requirements || []).map((requirement) =>
        requirement?.code === "auto_execute_policy_ready"
          ? {
              ...requirement,
              code: "policy_waiting",
              label: "policy approval is still required before any live canary",
              status: "required",
              blockers: [],
            }
          : requirement,
      ),
      nextActionCode: "policy_waiting",
      nextActionCommand: null,
      constraints: {
        ...(admission.constraints || {}),
        liveTradingPolicy,
      },
    };
  }
  if (overall?.liveTrading !== "ALLOWED" || (admission.blockers || []).length > 0) {
    return {
      ...admission,
      constraints: {
        ...(admission.constraints || {}),
        liveTradingPolicy,
      },
    };
  }
  return {
    ...admission,
    decision: "GO_FOR_AUTO_EXECUTE",
    status: "auto_execute_policy_ready",
    requirements: (admission.requirements || []).map((requirement) =>
      requirement?.code === "policy_waiting"
        ? {
            ...requirement,
            code: "auto_execute_policy_ready",
            label: "auto-execute policy is ready for the selected strategy",
            status: "passed",
            blockers: [],
          }
        : requirement,
    ),
    nextActionCode: "auto_execute_policy_ready",
    nextActionCommand: null,
    constraints: {
      ...(admission.constraints || {}),
      liveTradingPolicy: "ALLOWED",
    },
  };
}
