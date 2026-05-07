import { buildCanaryStageChecklist, buildExecutionStageSummary } from "../status/canary-inputs.mjs";
import { buildAdmissionRemediationPlan, summarizeAdmissionRemediationPlan } from "./admission-remediation.mjs";
import { buildTinyCanaryAdmission } from "./tiny-canary-admission.mjs";
import { defaultDexQuoteProvider, noSupportedRouterReason } from "../dex/odos.mjs";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function sameCandidate(candidate, canaryInputs) {
  if (!candidate || !canaryInputs) return false;
  if (candidate.label && canaryInputs.routeLabel && candidate.label === canaryInputs.routeLabel) {
    return String(candidate.amount) === String(canaryInputs.amount);
  }
  return false;
}

function validationById(report = null, id = null) {
  return (report?.validations || []).find((item) => item.id === id) || null;
}

function watcherById(report = null, id = null) {
  return (report?.watchers || []).find((item) => item.id === id) || null;
}

function strategyLiveCandidateConfigs({
  wrappedBtcLendingLoopSlice = null,
  wrappedBtcLoopDryRun = null,
  recursiveWrappedBtcLoop = null,
  recursiveWrappedBtcLoopDryRun = null,
  recursiveStablecoinLoop = null,
  recursiveStablecoinLoopDryRun = null,
} = {}) {
  return [
    recursiveWrappedBtcLoop?.strategy?.id
      ? {
          scaffold: recursiveWrappedBtcLoop,
          dryRunSummary: recursiveWrappedBtcLoopDryRun || recursiveWrappedBtcLoop?.dryRunSummary || null,
          validationId: `${recursiveWrappedBtcLoop.strategy.id}_validation`,
          watcherId: `${recursiveWrappedBtcLoop.strategy.id}_market_watch`,
        }
      : null,
    recursiveStablecoinLoop?.strategy?.id
      ? {
          scaffold: recursiveStablecoinLoop,
          dryRunSummary: recursiveStablecoinLoopDryRun || recursiveStablecoinLoop?.dryRunSummary || null,
          validationId: `${recursiveStablecoinLoop.strategy.id}_validation`,
          watcherId: `${recursiveStablecoinLoop.strategy.id}_market_watch`,
        }
      : null,
    wrappedBtcLendingLoopSlice?.strategy?.id
      ? {
          scaffold: wrappedBtcLendingLoopSlice,
          dryRunSummary: wrappedBtcLoopDryRun || wrappedBtcLendingLoopSlice?.dryRunSummary || null,
          validationId: "wrapped_btc_loop_validation",
          watcherId: "wrapped_btc_loop_market_watch",
        }
      : null,
  ].filter(Boolean);
}

function matchedCanaryCandidate(dashboardStatus = null, canaryInputs = null) {
  return (dashboardStatus?.shadowCycle?.shadowRoster?.candidates || []).find((candidate) => sameCandidate(candidate, canaryInputs)) || null;
}

function freshnessSummary(canaryInputs = null) {
  if (!canaryInputs) return null;
  return {
    gatewayQuote: canaryInputs.gatewayQuote || null,
    exactGas: canaryInputs.exactGas || null,
    srcGas: canaryInputs.srcGas || null,
    dexQuote: canaryInputs.dexQuote || null,
    bitcoinFee: canaryInputs.bitcoinFee || null,
    marketSnapshot: canaryInputs.marketSnapshot || null,
  };
}

function parseRouteChains(routeKey = null) {
  const [src = "", dst = ""] = String(routeKey || "").split("->");
  return {
    srcChain: src.split(":")[0] || null,
    dstChain: dst.split(":")[0] || null,
  };
}

function structuralDexFailureReason({ routeKey = null, srcChain = null, dstChain = null } = {}) {
  const inferred = parseRouteChains(routeKey);
  const chains = [srcChain || inferred.srcChain, dstChain || inferred.dstChain].filter(Boolean);
  for (const chain of chains) {
    if (!defaultDexQuoteProvider(chain)) {
      return noSupportedRouterReason(chain);
    }
  }
  return null;
}

function normalizeInputFreshness(inputFreshness = null, { routeKey = null, srcChain = null, dstChain = null } = {}) {
  if (!inputFreshness) return null;
  const normalized = { ...inputFreshness };
  const structuralDexReason = structuralDexFailureReason({ routeKey, srcChain, dstChain });
  if (structuralDexReason && ["missing", "stale"].includes(normalized?.dexQuote?.state)) {
    normalized.dexQuote = {
      ...normalized.dexQuote,
      state: "blocked",
      failureReason: structuralDexReason,
    };
  }
  return normalized;
}

function buildManualReviewCandidate({ dashboardStatus = null, canaryInputs = null, matchedCandidate = null, nextStep = null, address = null } = {}) {
  const topRoute = dashboardStatus?.shadowCycle?.topRoute || null;
  const route = nextStep?.route || null;
  const routeLabel = canaryInputs?.routeLabel || matchedCandidate?.label || route?.label || topRoute?.label || null;
  const amount = canaryInputs?.amount || matchedCandidate?.amount || route?.amount || topRoute?.amount || null;
  const routeKey = canaryInputs?.routeKey || route?.routeKey || null;
  const srcChain = route?.srcChain || matchedCandidate?.srcChain || topRoute?.srcChain || parseRouteChains(routeKey).srcChain;
  const dstChain = route?.dstChain || matchedCandidate?.dstChain || topRoute?.dstChain || parseRouteChains(routeKey).dstChain;
  const inputFreshness = normalizeInputFreshness(freshnessSummary(canaryInputs), { routeKey, srcChain, dstChain });
  const structuralDexReason = structuralDexFailureReason({ routeKey, srcChain, dstChain });
  if (!routeLabel && !amount && !canaryInputs?.routeKey) return null;
  return {
    address: address || null,
    candidateType: "route",
    economicsMode: "instant_route_edge",
    proofObjective: "transport_quote_execution_and_delivery",
    routeKey,
    routeLabel,
    amount,
    tradeReadiness: canaryInputs?.scoreTradeReadiness || matchedCandidate?.tradeReadiness || route?.tradeReadiness || topRoute?.tradeReadiness || null,
    netEdgeUsd: matchedCandidate?.netEdgeUsd ?? route?.netEdgeUsd ?? topRoute?.netEdgeUsd ?? null,
    prepFundingUsd: matchedCandidate?.prepFundingUsd ?? route?.prepFundingUsd ?? null,
    viableForPrep: matchedCandidate?.viableForPrep ?? route?.viableForPrep ?? null,
    txReady: matchedCandidate?.txReady ?? route?.txReady ?? null,
    blockerReasons: unique([
      ...(canaryInputs?.blockers || []),
      ...(matchedCandidate?.prepBlockers || []),
      ...(matchedCandidate?.scoreDisqualifiers || []),
      ...(nextStep?.reasons || []),
      structuralDexReason ? `blocked_dex_quote:${structuralDexReason}` : null,
    ]),
    scoreDataGaps: canaryInputs?.scoreDataGaps || [],
    inputFreshness,
    evidence: matchedCandidate?.evidence
      ? {
          quoteSampleCount: matchedCandidate.evidence.quoteSampleCount ?? 0,
          quoteFailureCount: matchedCandidate.evidence.quoteFailureCount ?? 0,
          quoteAttemptCount: matchedCandidate.evidence.quoteAttemptCount ?? 0,
          quoteSuccessRate: matchedCandidate.evidence.quoteSuccessRate ?? null,
          quoteLatencyP50Ms: matchedCandidate.evidence.quoteLatencyP50Ms ?? null,
          quoteLatencyP95Ms: matchedCandidate.evidence.quoteLatencyP95Ms ?? null,
          shadowObservationCount: matchedCandidate.evidence.shadowObservationCount ?? 0,
          latestObservedEdgeUsd: matchedCandidate.evidence.latestObservedEdgeUsd ?? null,
          latestKnownCostUsd: matchedCandidate.evidence.latestKnownCostUsd ?? null,
          latestExecutionGasUsd: matchedCandidate.evidence.latestExecutionGasUsd ?? null,
          latestRouteFailureRate: matchedCandidate.evidence.latestRouteFailureRate ?? null,
          latestTradeReadiness: matchedCandidate.evidence.latestTradeReadiness || null,
          rejectionReasons: matchedCandidate.evidence.rejectionReasons || [],
        }
      : null,
  };
}

function inputStates(inputFreshness = null) {
  if (!inputFreshness) return [];
  return Object.values(inputFreshness)
    .map((item) => item?.state || null)
    .filter(Boolean);
}

function normalizedReasonCodes(values = []) {
  return (values || [])
    .map((value) => {
      if (!value) return null;
      if (typeof value === "string") return value;
      if (typeof value === "object") return value.reason || value.code || null;
      return null;
    })
    .filter(Boolean);
}

function observedStatus(status = null) {
  const normalized = String(status || "").toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("simulated") || normalized.includes("paper") || normalized.includes("estimate")) return false;
  return normalized.includes("observed") || normalized.includes("receipt") || normalized.includes("realized") || normalized.includes("live");
}

function railStage({ id, label, complete = false, ready = false, blocker = null, command = null } = {}) {
  return {
    id,
    label,
    status: complete ? "complete" : ready ? "ready_for_proof" : "blocked",
    blockers: complete ? [] : unique([blocker]),
    command: complete ? null : command || null,
  };
}

function buildStrategyRailProof({ scaffold = null, summary = null, validation = null, nextAction = null } = {}) {
  const paper = scaffold?.pnl?.paper || null;
  const estimated = scaffold?.pnl?.estimated || null;
  const realized = scaffold?.pnl?.realized || null;
  const entryActionCount = scaffold?.executionPlan?.actionCount ?? scaffold?.executionPlan?.actions?.length ?? 0;
  const unwindActionCount = scaffold?.unwindPlan?.actions?.length ?? 0;
  const watcherCheckCount = scaffold?.watcherPlan?.checks?.length ?? 0;
  const readyForDryRun = scaffold?.readiness?.readyForDryRun === true;
  const readyForLive = scaffold?.readiness?.readyForLive === true;
  const liveRoundtripProofStatus = validation?.evidence?.liveRoundtripProofStatus || null;
  const liveRoundtripEntryCount = validation?.evidence?.liveRoundtripEntryCount ?? 0;
  const liveRoundtripUnwindCount = validation?.evidence?.liveRoundtripUnwindCount ?? 0;
  const liveRealizedNetCarryUsd = validation?.evidence?.realizedNetCarryUsd ?? null;
  const extendedReceiptContextReady = validation?.evidence?.extendedReceiptContextReady === true;
  const observedCarrySampleRecorded =
    (extendedReceiptContextReady && Number.isFinite(liveRealizedNetCarryUsd)) ||
    (observedStatus(realized?.status) && (realized?.sampleCount ?? 0) > 0);
  const protocolPlanReady = entryActionCount > 0 && unwindActionCount > 0 && watcherCheckCount > 0 && readyForDryRun;
  const entryReceiptRecorded = liveRoundtripEntryCount > 0;
  const unwindAttemptRecorded = liveRoundtripUnwindCount > 0;
  const unwindReceiptRecorded = unwindAttemptRecorded && extendedReceiptContextReady;
  const btcReconciled = liveRoundtripProofStatus === "signer_backed_roundtrip_recorded" && extendedReceiptContextReady;
  const receiptCommand = nextAction?.command || null;
  const stages = [
    railStage({
      id: "protocol_plan_ready",
      label: "strategy entry, watcher, and unwind plan is declared",
      complete: protocolPlanReady,
      ready: entryActionCount > 0 || unwindActionCount > 0 || watcherCheckCount > 0,
      blocker: "protocol_plan_incomplete",
    }),
    railStage({
      id: "native_btc_funding_delivery",
      label: "native BTC reaches destination-chain protocol collateral",
      complete: entryReceiptRecorded,
      ready: readyForDryRun,
      blocker: "native_btc_to_protocol_funding_receipt_missing",
      command: receiptCommand,
    }),
    railStage({
      id: "protocol_entry_receipt",
      label: "protocol deposit/borrow/supply entry receipt is recorded",
      complete: entryReceiptRecorded,
      ready: entryActionCount > 0,
      blocker: "protocol_entry_receipt_missing",
      command: receiptCommand,
    }),
    railStage({
      id: "holding_period_carry_observation",
      label: "holding-period carry/accrual is observed from receipts or live snapshots",
      complete: observedCarrySampleRecorded,
      ready: entryReceiptRecorded || readyForDryRun,
      blocker: "observed_holding_period_carry_missing",
      command: receiptCommand,
    }),
    railStage({
      id: "protocol_unwind_receipt",
      label: "protocol unwind receipt records gas, slippage, and health-factor path",
      complete: unwindReceiptRecorded,
      ready: unwindAttemptRecorded || unwindActionCount > 0,
      blocker: "protocol_unwind_receipt_missing",
      command: receiptCommand,
    }),
    railStage({
      id: "btc_reconciliation",
      label: "BTC-denominated reconciliation reaches treasury/payback accounting",
      complete: btcReconciled,
      ready: entryReceiptRecorded && unwindAttemptRecorded,
      blocker: "btc_denominated_reconciliation_missing",
    }),
  ];
  const nextStage = stages.find((stage) => stage.status !== "complete") || null;
  return {
    entryActionCount,
    unwindActionCount,
    watcherCheckCount,
    readyForDryRun,
    readyForLive,
    paperAnnualNetCarryUsd: paper?.annualNetCarryUsd ?? null,
    estimatedCarryStatus: estimated?.status || null,
    estimatedCarrySampleCount: estimated?.sampleCount ?? 0,
    realizedCarryStatus: realized?.status || null,
    realizedCarrySampleCount: realized?.sampleCount ?? 0,
    liveRealizedNetCarryUsd,
    extendedReceiptContextReady,
    requiredProofs: [
      "native BTC funded route into destination-chain collateral",
      "protocol entry receipt for deposit/borrow/supply path",
      "holding-period carry snapshot or receipt-backed accrual sample",
      "unwind receipt with realized gas, slippage, and health-factor path",
      "BTC-denominated reconciliation back to treasury/payback accounting",
    ],
    stages,
    stageCount: stages.length,
    completeStageCount: stages.filter((stage) => stage.status === "complete").length,
    blockers: unique(stages.flatMap((stage) => stage.blockers || [])),
    nextStage,
  };
}

function isRouteStructurallyBlocked(candidate = null) {
  const tradeReadiness = String(candidate?.tradeReadiness || "");
  return (
    tradeReadiness.startsWith("reject_") ||
    (candidate?.blockerReasons || []).some((item) => String(item || "").startsWith("reject_")) ||
    inputStates(candidate?.inputFreshness).includes("blocked")
  );
}

function isRouteReviewReady(candidate = null) {
  return (
    ["shadow_candidate_review_only", "review_only_canary_candidate"].includes(candidate?.tradeReadiness) &&
    !inputStates(candidate?.inputFreshness).includes("blocked")
  );
}

function isRouteEconomicallyBlocked(candidate = null, dashboardStatus = null) {
  if (!candidate || candidate.candidateType === "strategy") return false;
  const blockerReasons = candidate?.blockerReasons || [];
  const rejectionReasons = normalizedReasonCodes(candidate?.evidence?.rejectionReasons || []);
  const latestObservedEdgeUsd = candidate?.evidence?.latestObservedEdgeUsd;
  const policyReadyMeasuredRoutes = dashboardStatus?.prelive?.shadowReplay?.policyReadyMeasuredRoutes;
  if (
    blockerReasons.some((reason) =>
      ["reject_no_net_edge", "reject_effective_system_pnl", "route_refill_economically_unjustified"].includes(String(reason || "")),
    )
  ) {
    return true;
  }
  if (
    rejectionReasons.some((reason) =>
      ["reject_no_net_edge", "reject_effective_system_pnl", "reject_treasury_execution_refill_cost"].includes(String(reason || "")),
    )
  ) {
    return true;
  }
  if (Number.isFinite(candidate?.netEdgeUsd) && candidate.netEdgeUsd <= 0) {
    return true;
  }
  if (Number.isFinite(latestObservedEdgeUsd) && latestObservedEdgeUsd <= 0) {
    return true;
  }
  if (Number.isFinite(policyReadyMeasuredRoutes) && policyReadyMeasuredRoutes <= 0) {
    return true;
  }
  const fundingNetUsd = dashboardStatus?.shadowCycle?.funding?.effectiveSystemNetPnlUsd;
  return Number.isFinite(fundingNetUsd) && fundingNetUsd <= 0;
}

function buildStrategyLiveCandidate({
  scaffold = null,
  dryRunSummary = null,
  validationId = null,
  watcherId = null,
  phase3Validation = null,
  protocolMarketWatchers = null,
} = {}) {
  const strategy = scaffold?.strategy || null;
  if (!strategy?.id) return null;
  const validation = validationById(phase3Validation, validationId);
  const watcher = watcherById(protocolMarketWatchers, watcherId);
  const summary = dryRunSummary || scaffold?.dryRunSummary || null;
  const evidenceBlockers = unique([...(validation?.blockers || []), ...(watcher?.blockers || [])]);
  const perTradeCapUsd = strategy?.perTradeCapUsd ?? null;
  const nextAction = watcher?.nextAction || validation?.nextAction || null;
  const railProof = buildStrategyRailProof({ scaffold, summary, validation, nextAction });
  const blockerReasons = unique([...evidenceBlockers, ...(railProof.blockers || [])]);
  const reviewReady = blockerReasons.length === 0 && summary?.dryRunReceiptRecorded === true;
  return {
    candidateType: "strategy",
    candidateId: strategy.id,
    candidateLabel: strategy.label || strategy.id,
    economicsMode: "holding_period_carry",
    proofObjective: "protocol_rail_entry_hold_unwind_receipts",
    routeKey: null,
    routeLabel: null,
    address: null,
    amount: Number.isFinite(perTradeCapUsd) ? String(perTradeCapUsd) : null,
    amountUnit: "usd_cap",
    perTradeCapUsd,
    tradeReadiness: reviewReady ? "strategy_candidate_review_only" : "strategy_evidence_blocked",
    viableForPrep: reviewReady,
    txReady: reviewReady,
    blockerReasons,
    evidenceBlockers: blockerReasons,
    inputFreshness: null,
    nextAction,
    reviewReady,
    preliveReady: reviewReady,
    evidence: {
      strategyId: strategy.id,
      strategyType: strategy.strategyType || null,
      chain: strategy.chain || null,
      protocol: strategy.protocol || null,
      arrivalFamily: strategy.arrivalFamily || null,
      dryRunReceiptRecorded: summary?.dryRunReceiptRecorded === true,
      autoUnwindPassCount: summary?.autoUnwindPassCount ?? 0,
      signerBackedRunCount: summary?.signerBackedRunCount ?? 0,
      oosSplitStatus: validation?.oosSplitStatus || null,
      oosEvidenceStatus: validation?.evidence?.oosEvidenceStatus || validation?.oosSplitStatus || null,
      liveRoundtripProofStatus: validation?.evidence?.liveRoundtripProofStatus || null,
      liveRoundtripEntryCount: validation?.evidence?.liveRoundtripEntryCount ?? 0,
      liveRoundtripUnwindCount: validation?.evidence?.liveRoundtripUnwindCount ?? 0,
      extendedReceiptContextReady: validation?.evidence?.extendedReceiptContextReady === true,
      actualLoopFeesUsd: validation?.evidence?.actualLoopFeesUsd ?? null,
      actualUnwindCostUsd: validation?.evidence?.actualUnwindCostUsd ?? null,
      realizedNetCarryUsd: validation?.evidence?.realizedNetCarryUsd ?? null,
    },
    railProof,
  };
}

function buildStrategyLiveCandidates({
  wrappedBtcLendingLoopSlice = null,
  wrappedBtcLoopDryRun = null,
  recursiveWrappedBtcLoop = null,
  recursiveWrappedBtcLoopDryRun = null,
  recursiveStablecoinLoop = null,
  recursiveStablecoinLoopDryRun = null,
  phase3Validation = null,
  protocolMarketWatchers = null,
} = {}) {
  return strategyLiveCandidateConfigs({
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRun,
    recursiveWrappedBtcLoop,
    recursiveWrappedBtcLoopDryRun,
    recursiveStablecoinLoop,
    recursiveStablecoinLoopDryRun,
  })
    .map((config) =>
      buildStrategyLiveCandidate({
        ...config,
        phase3Validation,
        protocolMarketWatchers,
      }),
    )
    .filter((candidate) => candidate?.candidateId);
}

function strategyCandidateRank(candidate = null) {
  const blockerCount = candidate?.blockerReasons?.length ?? Number.MAX_SAFE_INTEGER;
  const liveRoundtripRecorded = candidate?.evidence?.liveRoundtripProofStatus === "signer_backed_roundtrip_recorded";
  const signerBackedRecorded = (candidate?.evidence?.signerBackedRunCount ?? 0) > 0;
  const dryRunRecorded = candidate?.evidence?.dryRunReceiptRecorded === true;
  const autoUnwindPassCount = candidate?.evidence?.autoUnwindPassCount ?? 0;
  return [
    candidate?.reviewReady === true ? 1 : 0,
    liveRoundtripRecorded ? 1 : 0,
    signerBackedRecorded ? 1 : 0,
    dryRunRecorded ? 1 : 0,
    -blockerCount,
    autoUnwindPassCount,
  ];
}

function compareStrategyCandidateRanks(left = null, right = null) {
  const leftRank = strategyCandidateRank(left);
  const rightRank = strategyCandidateRank(right);
  for (let index = 0; index < Math.max(leftRank.length, rightRank.length); index += 1) {
    const difference = (rightRank[index] ?? 0) - (leftRank[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function selectBestStrategyLiveCandidate(strategyLiveCandidates = []) {
  return strategyLiveCandidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => compareStrategyCandidateRanks(left.candidate, right.candidate) || left.index - right.index)
    .map((item) => item.candidate)
    .find((candidate) => candidate?.candidateId) || null;
}

function selectPrimaryLiveCandidate({
  manualReviewCandidate = null,
  strategyLiveCandidate = null,
  dashboardStatus = null,
} = {}) {
  if (isRouteEconomicallyBlocked(manualReviewCandidate, dashboardStatus) && strategyLiveCandidate) return strategyLiveCandidate;
  if (isRouteReviewReady(manualReviewCandidate)) return manualReviewCandidate;
  if (isRouteStructurallyBlocked(manualReviewCandidate) && strategyLiveCandidate) return strategyLiveCandidate;
  return manualReviewCandidate || strategyLiveCandidate || null;
}

function buildMeasuredLeaderReview({ canarySelectionGap = null, executionReview = null } = {}) {
  const measuredLeader = canarySelectionGap?.measuredLeader || null;
  const reviewPlan = canarySelectionGap?.reviewPlan || null;
  const preferredNextActionCode = reviewPlan?.actionCodes?.[0] || executionReview?.nextActionCode || null;
  const preferredExecutionStep =
    executionReview?.steps?.find((step) => step.code === preferredNextActionCode && step.command) ||
    executionReview?.steps?.find((step) => step.command) ||
    null;
  if (!measuredLeader?.routeKey && !executionReview?.routeKey) return null;
  return {
    selectionCode: canarySelectionGap?.selectionCode || executionReview?.selectionCode || null,
    selectionLabel: canarySelectionGap?.selectionLabel || executionReview?.selectionLabel || null,
    routeKey: measuredLeader?.routeKey || executionReview?.routeKey || null,
    routeLabel: measuredLeader?.label || executionReview?.routeLabel || null,
    amount: measuredLeader?.amount || executionReview?.amount || null,
    tradeReadiness: measuredLeader?.tradeReadiness || executionReview?.tradeReadiness || null,
    measuredNetUsd: measuredLeader?.measuredNetUsd ?? executionReview?.measuredNetUsd ?? null,
    executableNetUsd: measuredLeader?.executableNetUsd ?? executionReview?.executableNetUsd ?? null,
    viableForPrep: measuredLeader?.viableForPrep ?? null,
    txReady: measuredLeader?.txReady ?? null,
    exactGasDone: measuredLeader?.exactGasDone ?? null,
    reasons: canarySelectionGap?.reasonLabels || executionReview?.reasonLabels || [],
    blockers: canarySelectionGap?.blockerLabels || executionReview?.blockerLabels || executionReview?.blockers || [],
    nextActionCode: preferredNextActionCode,
    nextActionLabels: reviewPlan?.actionLabels || executionReview?.steps?.map((step) => step.label).filter(Boolean) || [],
    command: preferredExecutionStep?.command || executionReview?.command || null,
    hypothesisGuard: canarySelectionGap?.hypothesisGuard || executionReview?.hypothesisGuard || null,
  };
}

function buildAntiOverfitCaveats({ dashboardStatus = null, measuredLeaderReview = null, readyForManualReview = false } = {}) {
  return unique([
    ...(dashboardStatus?.prelive?.notes || []),
    measuredLeaderReview?.hypothesisGuard || null,
    dashboardStatus?.gateway?.ethFamilyWatch?.routeCount > 0
      ? "ETH-family routes remain evidence-gated until route persistence, amount diversity, and ETH-family overfit audit all clear."
      : null,
    !readyForManualReview
      ? "Do not promote any route to canary or live execution while review blockers, stale inputs, or missing pre-live evidence remain."
      : null,
    dashboardStatus?.overall?.liveTrading === "BLOCKED"
      ? "liveTrading remains BLOCKED; this review package summarizes readiness and does not grant execution permission."
      : null,
    measuredLeaderReview && measuredLeaderReview.routeKey !== dashboardStatus?.canaryInputs?.routeKey
      ? "The measured leader and the current canary can diverge; keep them separate until the measured leader clears objective review."
      : null,
  ]);
}

function buildStrategyCandidateChecklist(candidate = null) {
  if (candidate?.candidateType !== "strategy") return null;
  const blockerReasons = candidate?.blockerReasons || [];
  const stages = candidate?.railProof?.stages || [];
  return {
    completed: unique([
      "primary live strategy selected",
      Number.isFinite(candidate?.perTradeCapUsd) ? "per-trade cap declared" : null,
      candidate?.evidence?.dryRunReceiptRecorded ? "dry-run receipt recorded" : null,
      (candidate?.evidence?.autoUnwindPassCount || 0) > 0 ? "auto-unwind path simulated" : null,
      ...stages.filter((stage) => stage.status === "complete").map((stage) => `rail proof complete: ${stage.label}`),
    ]),
    remaining: unique([
      blockerReasons.includes("signer_backed_oos_receipts_missing") ? "ingest signer-backed wrapped-loop receipts" : null,
      blockerReasons.includes("recursive_observed_receipts_missing") ? "ingest recursive lending-loop observed receipts" : null,
      blockerReasons.length ? `clear strategy evidence blockers (${blockerReasons.join(",")})` : null,
      ...stages.filter((stage) => stage.status !== "complete").map((stage) => `rail proof needed: ${stage.label}`),
      "manual approval before live canary",
    ]),
  };
}

function buildEthFamilyObservation(dashboardStatus = null) {
  const watch = dashboardStatus?.gateway?.ethFamilyWatch || null;
  if (!watch) return null;
  const routeCount = Number(watch.routeCount || 0);
  const surfaceChanged = Boolean(watch.surfaceChanged);
  const addedChainPairs = watch.addedChainPairs || [];
  const removedChainPairs = watch.removedChainPairs || [];
  const command = "npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard";

  return {
    routeCount,
    surfaceChanged,
    addedRoutesCount: Number(watch.addedRoutesCount || 0),
    removedRoutesCount: Number(watch.removedRoutesCount || 0),
    chainPairs: watch.chainPairs || [],
    addedChainPairs,
    removedChainPairs,
    status: routeCount <= 0 ? "idle" : surfaceChanged ? "ready_for_evidence" : "monitoring",
    reason: routeCount <= 0 ? "no_eth_family_surface" : surfaceChanged ? "eth_family_surface_changed" : "eth_family_surface_present",
    nextAction:
      routeCount > 0 && surfaceChanged
        ? {
            code: "collect_eth_family_evidence",
            label: "collect ETH family evidence",
            command,
          }
        : null,
  };
}

function buildEthFamilyProfitability(dashboardStatus = null) {
  const profitability = dashboardStatus?.strategy?.ethProfitability || null;
  if (
    !profitability ||
    (
      !profitability.bestMeasuredRoute &&
      !profitability.bestResearchRoute &&
      !profitability.closestPolicyRoute &&
      (profitability.gatewayRouteCount || 0) <= 0 &&
      (profitability.routeCount || 0) <= 0
    )
  ) {
    return null;
  }
  return {
    gatewayRouteCount: profitability.gatewayRouteCount ?? 0,
    routeCount: profitability.routeCount ?? 0,
    measuredClosedLoopCount: profitability.measuredClosedLoopCount ?? 0,
    profitableClosedLoopCount: profitability.profitableClosedLoopCount ?? 0,
    loopObservableRouteCount: profitability.loopObservableRouteCount ?? 0,
    stableRouteCount: profitability.stableRouteCount ?? 0,
    policyBlockedCount: profitability.policyBlockedCount ?? 0,
    verdictCode: profitability.verdictCode || null,
    verdictLabel: profitability.verdictLabel || null,
    verdictDetail: profitability.verdictDetail || null,
    recommendationCode: profitability.recommendationCode || null,
    recommendationLabel: profitability.recommendationLabel || null,
    recommendationDetail: profitability.recommendationDetail || null,
    bestMeasuredRoute: profitability.bestMeasuredRoute || null,
    closestPolicyRoute: profitability.closestPolicyRoute || null,
    bestResearchRoute: profitability.bestResearchRoute || null,
    followUpActionCode: profitability.followUpActionCode || null,
    followUpActionLabel: profitability.followUpActionLabel || null,
    followUpCommand: profitability.followUpCommand || null,
    overfitRisks: profitability.overfitRisks || [],
  };
}

function summarizeDestinationAllocator({ destinationAllocationPlan = null, destinationPromotionGate = null } = {}) {
  if (!destinationAllocationPlan && !destinationPromotionGate) return null;
  const topActive = destinationAllocationPlan?.activePlan?.[0] || null;
  const topReviewOnly =
    destinationAllocationPlan?.summary?.topReviewOnly?.[0] || destinationPromotionGate?.summary?.topReviewOnly?.[0] || null;
  return {
    promotableCount: destinationPromotionGate?.summary?.promotableCount ?? destinationAllocationPlan?.summary?.promotableCount ?? 0,
    allocationReadyCount:
      destinationPromotionGate?.summary?.allocationReadyCount ?? destinationAllocationPlan?.summary?.allocationReadyCount ?? 0,
    reviewOnlyCount:
      destinationPromotionGate?.summary?.reviewOnlyCount ?? destinationAllocationPlan?.summary?.reviewOnlyCount ?? 0,
    activeAllocationCount: destinationAllocationPlan?.summary?.activeAllocationCount ?? 0,
    planningAllocationCount: destinationAllocationPlan?.summary?.planningAllocationCount ?? 0,
    topActiveCandidate: topActive
      ? {
          templateId: topActive.templateId || null,
          chain: topActive.chain || null,
          familyId: topActive.familyId || null,
          label: topActive.label || null,
          estimatedNetBps: topActive.estimatedNetBps ?? null,
          estimatedNetUsd: topActive.estimatedNetUsd ?? null,
        }
      : null,
    topReviewOnlyCandidate: topReviewOnly
      ? {
          templateId: topReviewOnly.templateId || null,
          chain: topReviewOnly.chain || null,
          familyId: topReviewOnly.familyId || null,
          label: topReviewOnly.label || null,
          blockers: topReviewOnly.blockers || topReviewOnly.allocationGate?.blockers || [],
          nextAction: topReviewOnly.nextAction || topReviewOnly.allocationGate?.nextAction || null,
        }
      : null,
    note:
      "Destination allocator candidates are research and manual-review inputs only; they do not authorize route execution or live trading.",
  };
}

export function buildPreliveReviewPackage({
  dashboardStatus = null,
  canaryInputs = null,
  canarySelectionGap = null,
  nextStep = null,
  advanceCanary = null,
  address = null,
  strategySnapshot = null,
  executionRunbook = null,
  preliveValidation = null,
  connectedRefreshPackage = null,
  exactRouteForkPackage = null,
  operationalJudgmentReview = null,
  wrappedBtcLendingLoopSlice = null,
  wrappedBtcLoopDryRun = null,
  recursiveWrappedBtcLoop = null,
  recursiveWrappedBtcLoopDryRun = null,
  recursiveStablecoinLoop = null,
  recursiveStablecoinLoopDryRun = null,
  phase3Validation = null,
  protocolMarketWatchers = null,
  destinationAllocationPlan = null,
  destinationPromotionGate = null,
  now = null,
} = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const effectiveStatus = canaryInputs ? { ...dashboardStatus, canaryInputs } : dashboardStatus;
  const executionStage = buildExecutionStageSummary({
    nextStep,
    dashboardStatus: effectiveStatus,
  });
  const checklist = buildCanaryStageChecklist({
    route: nextStep?.route || null,
    nextStep,
    inputSummary: canaryInputs,
    shadowCycle: dashboardStatus?.shadowCycle || null,
    advanceCanary: advanceCanary || dashboardStatus?.canaryAdvance || null,
  });
  const matchedCandidate = matchedCanaryCandidate(dashboardStatus, canaryInputs);
  const manualReviewCandidate = buildManualReviewCandidate({
    dashboardStatus,
    canaryInputs,
    matchedCandidate,
    nextStep,
    address,
  });
  const strategyLiveCandidates = buildStrategyLiveCandidates({
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRun,
    recursiveWrappedBtcLoop,
    recursiveWrappedBtcLoopDryRun,
    recursiveStablecoinLoop,
    recursiveStablecoinLoopDryRun,
    phase3Validation,
    protocolMarketWatchers,
  });
  const bestStrategyLiveCandidate = selectBestStrategyLiveCandidate(strategyLiveCandidates);
  const primaryLiveCandidate = selectPrimaryLiveCandidate({
    manualReviewCandidate,
    strategyLiveCandidate: bestStrategyLiveCandidate,
    dashboardStatus,
  });
  const strategyChecklist = buildStrategyCandidateChecklist(primaryLiveCandidate);
  const measuredLeaderReview = buildMeasuredLeaderReview({
    canarySelectionGap,
    executionReview: dashboardStatus?.shadowCycle?.objectivePlans?.executionReview || null,
  });
  const prelive = dashboardStatus?.prelive || {};
  const tinyCanaryAdmission = buildTinyCanaryAdmission({
    prelive,
    executionStage,
    manualReviewCandidate: primaryLiveCandidate || manualReviewCandidate,
    overall: dashboardStatus?.overall || null,
  });
  const ethFamilyObservation = buildEthFamilyObservation(dashboardStatus);
  const ethFamilyProfitability = buildEthFamilyProfitability(dashboardStatus);
  const readyForManualReview = ["GO_FOR_POLICY_READY", "GO_FOR_AUTO_EXECUTE"].includes(tinyCanaryAdmission.decision);
  const reviewBlockers = readyForManualReview ? [] : tinyCanaryAdmission.blockers;
  const liveBlockers = unique([...(executionStage.liveReasons || []), ...(dashboardStatus?.overall?.blockers || [])]);
  const reviewDecision = readyForManualReview ? "READY_FOR_MANUAL_CANARY_REVIEW" : executionStage.reviewStage;

  const reviewPackage = {
    schemaVersion: 1,
    generatedAt,
    reviewScope: "tiny_live_canary",
    packageStatus: readyForManualReview ? "ready_for_manual_review" : "not_ready_for_manual_review",
    readyForManualReview,
    currentStage: executionRunbook?.currentStageId || preliveValidation?.currentStageId || prelive?.currentStage || null,
    reviewDecision,
    reviewBlockers,
    liveDecision: executionStage.liveStage,
    liveBlockers,
    tinyCanaryAdmission,
    pivotDecision:
      dashboardStatus?.strategy?.pivotDecision ||
      dashboardStatus?.shadowCycle?.pivotDecision ||
      null,
    pivotPlan: dashboardStatus?.strategy?.pivotPlan || null,
    yieldShadowBook: dashboardStatus?.strategy?.yieldShadowBook || null,
    proxySpreadCoveragePlan: dashboardStatus?.strategy?.proxySpreadCoveragePlan || null,
    destinationAllocator: summarizeDestinationAllocator({ destinationAllocationPlan, destinationPromotionGate }),
    strategySnapshot: strategySnapshot || dashboardStatus?.strategy?.strategySnapshot || null,
    executionRunbook: executionRunbook || dashboardStatus?.prelive?.executionRunbook || null,
    preliveValidation: preliveValidation || dashboardStatus?.prelive?.validation || null,
    connectedRefreshPackage,
    connectedRefreshExecution: dashboardStatus?.prelive?.connectedRefreshExecution || null,
    currentRoutePrelivePass: dashboardStatus?.prelive?.currentRoutePrelivePass || null,
    exactRouteForkPackage,
    operationalJudgmentReview,
    liveTradingPolicy: prelive?.liveTradingPolicy || dashboardStatus?.overall?.liveTrading || "BLOCKED",
    decisionContext: {
      currentDecision: nextStep?.decision || dashboardStatus?.canaryAdvance?.final?.decision || dashboardStatus?.shadowCycle?.canaryDecision || null,
      headline: nextStep?.headline || dashboardStatus?.canaryAdvance?.final?.headline || dashboardStatus?.shadowCycle?.headline || null,
      reasons: nextStep?.reasons || [],
    },
    primaryLiveCandidate,
    manualReviewCandidate,
    measuredLeaderReview,
    ethFamilyObservation,
    ethFamilyProfitability,
    operatorChecklist: strategyChecklist || checklist,
    preliveEvidence: {
      shadowReplay: prelive?.shadowReplay
        ? {
            status: prelive.shadowReplay.status || null,
            blockers: prelive.shadowReplay.blockers || [],
            auditDecision: prelive.shadowReplay.auditDecision || null,
            policyReadyMeasuredRoutes: prelive.shadowReplay.policyReadyMeasuredRoutes ?? 0,
          }
        : null,
      mechanicalSimulation: prelive?.mechanicalSimulation
        ? {
            status: prelive.mechanicalSimulation.status || null,
            blockers: prelive.mechanicalSimulation.blockers || [],
            successCount: prelive.mechanicalSimulation.successCount ?? 0,
            targetSuccessCount: prelive.mechanicalSimulation.targetSuccessCount ?? 0,
            failureCount: prelive.mechanicalSimulation.failureCount ?? 0,
          }
        : null,
      forkExecution: prelive?.forkExecution
        ? {
            status: prelive.forkExecution.status || null,
            blockers: prelive.forkExecution.blockers || [],
            planCount: prelive.forkExecution.planCount ?? 0,
            submittedCount: prelive.forkExecution.submittedCount ?? 0,
            confirmedCount: prelive.forkExecution.confirmedCount ?? 0,
            targetConfirmedCount: prelive.forkExecution.targetConfirmedCount ?? 0,
            failedCount: prelive.forkExecution.failedCount ?? 0,
            pendingOutputCount: prelive.forkExecution.pendingOutputCount ?? 0,
            realizedSampleCount: prelive.forkExecution.realizedSampleCount ?? 0,
            realizedNetPnlUsd: prelive.forkExecution.realizedNetPnlUsd ?? null,
            medianRealizedNetPnlUsd: prelive.forkExecution.medianRealizedNetPnlUsd ?? null,
            medianNetDriftUsd: prelive.forkExecution.medianNetDriftUsd ?? null,
            medianExecutionGasDriftUsd: prelive.forkExecution.medianExecutionGasDriftUsd ?? null,
            medianFillDriftBps: prelive.forkExecution.medianFillDriftBps ?? null,
            estimatedPositiveRealizedNegativeCount: prelive.forkExecution.estimatedPositiveRealizedNegativeCount ?? 0,
            latestPendingOutput: prelive.forkExecution.latestPendingOutput
              ? {
                  observedAt: prelive.forkExecution.latestPendingOutput.observedAt || null,
                  planId: prelive.forkExecution.latestPendingOutput.planId || null,
                  routeLabel: prelive.forkExecution.latestPendingOutput.routeLabel || null,
                  routeKey: prelive.forkExecution.latestPendingOutput.routeKey || null,
                  amount: prelive.forkExecution.latestPendingOutput.amount || null,
                  txHash: prelive.forkExecution.latestPendingOutput.txHash || null,
                  outputRequirements: prelive.forkExecution.latestPendingOutput.outputRequirements || null,
                  resolutionCommand: prelive.forkExecution.latestPendingOutput.resolutionCommand || null,
                }
              : null,
          }
        : null,
      executionAudit: prelive?.executionAudit
        ? {
            status: prelive.executionAudit.status || null,
            blockers: prelive.executionAudit.blockers || [],
            missingRecordCount: prelive.executionAudit.missingRecordCount ?? 0,
          }
        : null,
    },
    recentTransitions: prelive?.executionAudit?.recentTransitions || [],
    queueFollowUps: prelive?.nextActions || [],
    antiOverfitCaveats: buildAntiOverfitCaveats({
      dashboardStatus: effectiveStatus,
      measuredLeaderReview,
      readyForManualReview,
    }),
  };
  reviewPackage.remediationPlan = buildAdmissionRemediationPlan({
    reviewPackage,
    address,
    advanceCanary: advanceCanary || dashboardStatus?.canaryAdvance || null,
  });
  return reviewPackage;
}

export function summarizePreliveReviewPackage(reviewPackage = null) {
  if (!reviewPackage) return null;
  const candidate = reviewPackage.primaryLiveCandidate || reviewPackage.manualReviewCandidate || null;
  return {
    generatedAt: reviewPackage.generatedAt || null,
    packageStatus: reviewPackage.packageStatus || null,
    readyForManualReview: Boolean(reviewPackage.readyForManualReview),
    currentStage: reviewPackage.currentStage || null,
    reviewDecision: reviewPackage.reviewDecision || null,
    reviewBlockers: reviewPackage.reviewBlockers || [],
    liveDecision: reviewPackage.liveDecision || null,
    liveBlockers: reviewPackage.liveBlockers || [],
    tinyCanaryAdmissionDecision: reviewPackage.tinyCanaryAdmission?.decision || null,
    tinyCanaryAdmissionStatus: reviewPackage.tinyCanaryAdmission?.status || null,
    tinyCanaryAdmissionBlockers: reviewPackage.tinyCanaryAdmission?.blockers || [],
    tinyCanaryAdmissionNextActionCode: reviewPackage.tinyCanaryAdmission?.nextActionCode || null,
    remediationPlan: summarizeAdmissionRemediationPlan(reviewPackage.remediationPlan || null),
    candidateType: candidate?.candidateType || (candidate ? "route" : null),
    candidateId: candidate?.candidateId || candidate?.routeKey || null,
    candidateLabel: candidate?.candidateLabel || candidate?.routeLabel || null,
    routeLabel: candidate?.routeLabel || null,
    routeKey: candidate?.routeKey || null,
    amount: candidate?.amount || null,
    tradeReadiness: candidate?.tradeReadiness || null,
    economicsMode: candidate?.economicsMode || null,
    proofObjective: candidate?.proofObjective || null,
    railProof: candidate?.railProof || null,
    railProofStageCount: candidate?.railProof?.stageCount ?? 0,
    railProofCompleteStageCount: candidate?.railProof?.completeStageCount ?? 0,
    railProofNextStageId: candidate?.railProof?.nextStage?.id || null,
    railProofNextStageStatus: candidate?.railProof?.nextStage?.status || null,
    railProofBlockers: candidate?.railProof?.blockers || [],
    simulationSuccessCount: reviewPackage.preliveEvidence?.mechanicalSimulation?.successCount ?? 0,
    simulationTargetCount: reviewPackage.preliveEvidence?.mechanicalSimulation?.targetSuccessCount ?? 0,
    forkConfirmedCount: reviewPackage.preliveEvidence?.forkExecution?.confirmedCount ?? 0,
    forkTargetCount: reviewPackage.preliveEvidence?.forkExecution?.targetConfirmedCount ?? 0,
    recentTransitionCount: reviewPackage.recentTransitions?.length || 0,
    queueFollowUpCount: reviewPackage.queueFollowUps?.length || 0,
    pivotTopRecommendationId: reviewPackage.pivotPlan?.topRecommendation?.id || null,
    pivotTopRecommendationLabel: reviewPackage.pivotPlan?.topRecommendation?.label || null,
    pivotTopRecommendationStatus: reviewPackage.pivotPlan?.topRecommendation?.status || null,
    pivotCurrentBudgetUsd: reviewPackage.pivotPlan?.currentBudgetUsd ?? null,
    pivotObservedCapitalFloorUsd: reviewPackage.pivotPlan?.topRecommendation?.observedCapitalFloorUsd ?? null,
    pivotResearchPilotMinimumUsd: reviewPackage.pivotPlan?.topRecommendation?.researchPilotMinimumUsd ?? null,
    pivotPlanningBudgetScenarios: reviewPackage.pivotPlan?.budgetScenarios || [],
    yieldTopProfileId: reviewPackage.yieldShadowBook?.topProfile?.id || null,
    yieldTopProfileCapitalRequiredUsd: reviewPackage.yieldShadowBook?.topProfile?.capitalRequiredUsd ?? null,
    proxyCoverageNextAction: reviewPackage.proxySpreadCoveragePlan?.nextAction || null,
    proxyCoverageNextProxyGroup: reviewPackage.proxySpreadCoveragePlan?.nextProxyGroup || null,
    destinationAllocatorPromotableCount: reviewPackage.destinationAllocator?.promotableCount ?? 0,
    destinationAllocatorAllocationReadyCount: reviewPackage.destinationAllocator?.allocationReadyCount ?? 0,
    destinationAllocatorReviewOnlyCount: reviewPackage.destinationAllocator?.reviewOnlyCount ?? 0,
    destinationAllocatorTopActiveTemplateId: reviewPackage.destinationAllocator?.topActiveCandidate?.templateId || null,
    destinationAllocatorTopReviewOnlyTemplateId: reviewPackage.destinationAllocator?.topReviewOnlyCandidate?.templateId || null,
    strategySnapshotStrategyCount: reviewPackage.strategySnapshot?.implementedStrategyCount ?? 0,
    strategySnapshotTopImplementedId: reviewPackage.strategySnapshot?.topImplementedStrategy?.id || null,
    executionRunbookCurrentStage: reviewPackage.executionRunbook?.currentStageId || null,
    executionRunbookNextStageId: reviewPackage.executionRunbook?.nextStageId || null,
    executionRunbookNextActionCode: reviewPackage.executionRunbook?.nextActionCode || null,
    executionRunbookForkPlanId: reviewPackage.executionRunbook?.exactRouteForkPlanId || null,
    executionRunbookForkPlanStatus: reviewPackage.executionRunbook?.exactRouteForkPlanStatus || null,
    preliveValidationStatus: reviewPackage.preliveValidation?.validationStatus || null,
    preliveValidationNextActionCode: reviewPackage.preliveValidation?.nextActionCode || null,
    connectedRefreshStatus: reviewPackage.connectedRefreshPackage?.status || null,
    connectedRefreshRequiredCount:
      reviewPackage.connectedRefreshPackage?.summary?.requiredRefreshCount ??
      reviewPackage.connectedRefreshPackage?.requiredRefreshCount ??
      0,
    connectedRefreshNextActionCode:
      reviewPackage.connectedRefreshPackage?.summary?.nextActionCode ||
      reviewPackage.connectedRefreshPackage?.nextActionCode ||
      reviewPackage.connectedRefreshPackage?.nextAction?.code ||
      null,
    connectedRefreshExecutionRunCount: reviewPackage.connectedRefreshExecution?.runCount ?? 0,
    connectedRefreshExecutionPreviewCount: reviewPackage.connectedRefreshExecution?.previewCount ?? 0,
    connectedRefreshExecutionSuccessCount: reviewPackage.connectedRefreshExecution?.successCount ?? 0,
    connectedRefreshExecutionFailureCount: reviewPackage.connectedRefreshExecution?.failureCount ?? 0,
    connectedRefreshExecutionLatestStatus: reviewPackage.connectedRefreshExecution?.latestStatus || null,
    currentRoutePrelivePassRunCount: reviewPackage.currentRoutePrelivePass?.runCount ?? 0,
    currentRoutePrelivePassPreviewCount: reviewPackage.currentRoutePrelivePass?.previewCount ?? 0,
    currentRoutePrelivePassLatestStatus: reviewPackage.currentRoutePrelivePass?.latestStatus || null,
    currentRoutePrelivePassNextActionCode: reviewPackage.currentRoutePrelivePass?.nextAction?.code || null,
    exactRouteForkPackageStatus: reviewPackage.exactRouteForkPackage?.status || null,
    exactRouteForkPackagePlanId:
      reviewPackage.exactRouteForkPackage?.plan?.planId ||
      reviewPackage.exactRouteForkPackage?.planId ||
      null,
    exactRouteForkEconomicStatus:
      reviewPackage.exactRouteForkPackage?.readiness?.economicStatus ||
      reviewPackage.exactRouteForkPackage?.economicStatus ||
      null,
    operationalJudgmentStatus: reviewPackage.operationalJudgmentReview?.status || null,
    operationalJudgmentIssueCount:
      reviewPackage.operationalJudgmentReview?.issueCount ??
      reviewPackage.operationalJudgmentReview?.issues?.length ??
      0,
    ethFamilyVerdictCode: reviewPackage.ethFamilyProfitability?.verdictCode || null,
    ethFamilyRecommendationCode: reviewPackage.ethFamilyProfitability?.recommendationCode || null,
    ethFamilyRouteCount: reviewPackage.ethFamilyProfitability?.routeCount ?? 0,
  };
}
