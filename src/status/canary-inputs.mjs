import { isFreshPriceSnapshot, latestPriceSnapshot } from "../market/prices.mjs";
import { isStructuralDexSupportFailure, normalizeDexSupportReason } from "../dex/odos.mjs";

const DEX_ROUTE_BLOCKED_FAILURE_REASONS = new Set([
  "odos_chain_not_supported",
  "stable_quote_token_missing",
  "input_token_not_evm",
]);

const ROUTE_DEX_FAILURE_SOURCES = new Set([
  "gateway_dst_leg",
  "gateway_src_entry_leg",
]);

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function observedAtMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function ageMinutes(observedAt, now) {
  const observedMs = observedAtMs(observedAt);
  const nowMs = observedAtMs(now || new Date().toISOString());
  if (observedMs === null || nowMs === null) return null;
  return (nowMs - observedMs) / 60_000;
}

function latestMatching(items = [], predicate) {
  let latest = null;
  let latestMs = null;
  for (const item of items) {
    if (!predicate(item)) continue;
    const itemMs = observedAtMs(item.observedAt);
    if (itemMs === null) continue;
    if (latestMs === null || itemMs > latestMs) {
      latest = item;
      latestMs = itemMs;
    }
  }
  return latest;
}

function latestRelevantDexFailures(dexFailures = [], route = null) {
  if (!route?.routeKey || !route?.amount) return [];
  return [...(dexFailures || [])]
    .filter((item) => item?.gatewayRouteKey === route.routeKey)
    .filter((item) => String(item?.gatewayAmount) === String(route.amount))
    .filter((item) => ROUTE_DEX_FAILURE_SOURCES.has(item?.source))
    .sort((left, right) => (observedAtMs(right?.observedAt) || 0) - (observedAtMs(left?.observedAt) || 0));
}

function latestRelevantExactGasFailures(gasEstimateFailures = [], route = null) {
  if (!route?.routeKey || !route?.amount) return [];
  return [...(gasEstimateFailures || [])]
    .filter((item) => item?.routeKey === route.routeKey)
    .filter((item) => String(item?.amount) === String(route.amount))
    .sort((left, right) => (observedAtMs(right?.observedAt) || 0) - (observedAtMs(left?.observedAt) || 0));
}

function freshnessSummary({ observedAt = null, now, maxAgeMinutes = null, required = true, available = true } = {}) {
  if (!required) {
    return {
      state: "not_needed",
      observedAt: null,
      ageMinutes: null,
    };
  }
  if (!available || !observedAt) {
    return {
      state: "missing",
      observedAt: null,
      ageMinutes: null,
    };
  }
  const minutes = ageMinutes(observedAt, now);
  if (Number.isFinite(maxAgeMinutes) && Number.isFinite(minutes) && minutes > maxAgeMinutes) {
    return {
      state: "stale",
      observedAt,
      ageMinutes: minutes,
    };
  }
  return {
    state: "fresh",
    observedAt,
    ageMinutes: minutes,
  };
}

const INPUT_STATE_KEYS = [
  ["gatewayQuote", "gateway_quote"],
  ["exactGas", "exact_gas"],
  ["srcGas", "src_gas"],
  ["dexQuote", "dex_quote"],
  ["bitcoinFee", "bitcoin_fee"],
  ["marketSnapshot", "market"],
];

function inputLabel(key) {
  return {
    gateway_quote: "gateway quote",
    exact_gas: "exact gas",
    src_gas: "source gas",
    dex_quote: "DEX quote",
    bitcoin_fee: "bitcoin fee",
    market: "market",
  }[key] || key;
}

function normalizeInputStates(summary) {
  if (!summary) return null;
  return Object.fromEntries(
    INPUT_STATE_KEYS.map(([field, key]) => [
      key,
      {
        state: summary[field]?.state || "unknown",
        observedAt: summary[field]?.observedAt || null,
        ageMinutes: Number.isFinite(summary[field]?.ageMinutes) ? summary[field].ageMinutes : null,
        failureReason: summary[field]?.failureReason || null,
        failureReasons: summary[field]?.failureReasons || [],
      },
    ]),
  );
}

function blockingInputs(summary) {
  const inputStates = normalizeInputStates(summary);
  if (!inputStates) return [];
  return Object.entries(inputStates)
    .filter(([, value]) => value.state === "missing" || value.state === "stale" || value.state === "blocked")
    .map(([key, value]) => ({
      key,
      ...value,
    }));
}

function dexQuoteSummary({ state = null, route = null, now = null } = {}) {
  const latestDexQuote = latestMatching(
    state?.dexQuotes,
    (item) =>
      item.source === "gateway_dst_leg" &&
      item.gatewayRouteKey === route.routeKey &&
      String(item.gatewayAmount) === String(route.amount),
  );
  if (latestDexQuote) {
    return {
      ...freshnessSummary({
        observedAt: latestDexQuote.observedAt || null,
        now,
        maxAgeMinutes: 30,
      }),
      failureReason: null,
      failureReasons: [],
    };
  }

  const failures = latestRelevantDexFailures(state?.dexFailures, route).map((item) => ({
    ...item,
    reason: normalizeDexSupportReason(item?.reason, item?.chain || route?.dstChain || route?.srcChain),
  }));
  const structuralFailure = failures.find(
    (item) => DEX_ROUTE_BLOCKED_FAILURE_REASONS.has(item?.reason) || isStructuralDexSupportFailure(item?.reason),
  ) || null;
  const latestFailure = failures[0] || null;
  if (structuralFailure) {
    return {
      state: "blocked",
      observedAt: structuralFailure.observedAt || null,
      ageMinutes: ageMinutes(structuralFailure.observedAt || null, now),
      failureReason: structuralFailure.reason || null,
      failureReasons: unique(failures.map((item) => item?.reason)),
    };
  }

  if (latestFailure) {
    return {
      state: "missing",
      observedAt: latestFailure.observedAt || null,
      ageMinutes: ageMinutes(latestFailure.observedAt || null, now),
      failureReason: latestFailure.reason || null,
      failureReasons: unique(failures.map((item) => item?.reason)),
    };
  }

  return {
    state: "missing",
    observedAt: null,
    ageMinutes: null,
    failureReason: null,
    failureReasons: [],
  };
}

function exactGasSummary({ state = null, route = null, now = null, required = true } = {}) {
  if (!required) {
    return {
      state: "not_needed",
      observedAt: null,
      ageMinutes: null,
      failureReason: null,
      failureReasons: [],
    };
  }

  const latestExactGas = latestMatching(
    state?.gasEstimateSnapshots,
    (item) => item.routeKey === route?.routeKey && String(item.amount) === String(route?.amount),
  );
  const failures = latestRelevantExactGasFailures(state?.gasEstimateFailures, route);
  const latestFailure = failures[0] || null;
  const latestSuccessObservedAt = latestExactGas?.observedAt || null;
  const latestFailureObservedAt = latestFailure?.observedAt || null;
  const useFailure =
    latestFailureObservedAt &&
    (!latestSuccessObservedAt || (observedAtMs(latestFailureObservedAt) || 0) >= (observedAtMs(latestSuccessObservedAt) || 0));

  if (useFailure) {
    return {
      ...freshnessSummary({
        observedAt: latestFailureObservedAt,
        now,
        maxAgeMinutes: 30,
      }),
      failureReason: latestFailure?.reason || null,
      failureReasons: unique(failures.map((item) => item?.reason)),
    };
  }

  return {
    ...freshnessSummary({
      observedAt: latestSuccessObservedAt,
      now,
      maxAgeMinutes: 30,
    }),
    failureReason: null,
    failureReasons: [],
  };
}

function lastAdvanceRoute(advanceCanary) {
  return (
    advanceCanary?.final ||
    advanceCanary?.afterWalletCheck ||
    advanceCanary?.initial ||
    null
  );
}

export function buildCanaryProgressSummary({ inputSummary = null, shadowCycle = null, advanceCanary = null, now = null } = {}) {
  const observedNow = now || new Date().toISOString();
  const currentRoute = inputSummary
    ? {
        routeLabel: inputSummary.routeLabel || shadowCycle?.topRoute?.label || null,
        routeKey: inputSummary.routeKey || null,
        amount: inputSummary.amount || shadowCycle?.topRoute?.amount || null,
        tradeReadiness: inputSummary.scoreTradeReadiness || shadowCycle?.topRoute?.tradeReadiness || null,
        routeBlockers: shadowCycle?.canary?.reasons || inputSummary.blockers || [],
        scoreDataGaps: inputSummary.scoreDataGaps || [],
        inputStates: normalizeInputStates(inputSummary),
        blockingInputs: blockingInputs(inputSummary),
      }
    : null;

  const advanceRoute = lastAdvanceRoute(advanceCanary);
  const lastAdvance = advanceCanary
    ? {
        observedAt: advanceCanary.observedAt || null,
        ageMinutes: ageMinutes(advanceCanary.observedAt, observedNow),
        actionCount: advanceCanary.actionCount ?? (advanceCanary.actions?.length || 0),
        actions: advanceCanary.actions || [],
        routeLabel: advanceRoute?.routeLabel || null,
        routeKey: advanceRoute?.routeKey || null,
        amount: advanceRoute?.amount || null,
        initialDecision: advanceCanary.initial?.decision || null,
        afterWalletCheckDecision: advanceCanary.afterWalletCheck?.decision || null,
        finalDecision: advanceCanary.final?.decision || null,
        finalReasons: advanceCanary.final?.reasons || [],
      }
    : null;

  if (!currentRoute && !lastAdvance) return null;

  return {
    currentRoute,
    lastAdvance,
  };
}

export function buildCanaryStageChecklist({ route = null, nextStep = null, inputSummary = null, shadowCycle = null, advanceCanary = null } = {}) {
  const completed = [];
  const remaining = [];

  if (route?.label || inputSummary?.routeLabel) completed.push("top canary route selected");
  if (route?.txReady) completed.push("tx payload captured");
  if (route && Array.isArray(route.prepBlockers) && route.prepBlockers.length === 0 && !route.readinessFailureReason) {
    completed.push("wallet readiness cleared");
  }
  if (route?.exactGasDone) completed.push("exact gas captured");

  const blockingInputItems = blockingInputs(inputSummary);
  const refreshableInputsList = blockingInputItems
    .filter((item) => item.state === "missing" || item.state === "stale")
    .map((item) => inputLabel(item.key));
  const blockedInputsList = blockingInputItems
    .filter((item) => item.state === "blocked")
    .map((item) => inputLabel(item.key));
  if (refreshableInputsList.length > 0) {
    remaining.push(`refresh stale/missing inputs (${refreshableInputsList.join(", ")})`);
  }
  if (blockedInputsList.length > 0) {
    remaining.push(`resolve blocked inputs (${blockedInputsList.join(", ")})`);
  }

  if (nextStep?.decision === "FUND_AND_APPROVE_WALLET") {
    remaining.push("fund or approve estimator wallet");
  } else if (nextStep?.decision === "RUN_EXACT_GAS") {
    remaining.push("rerun exact gas for the top route");
  } else if (nextStep?.decision === "RERUN_SCORING") {
    remaining.push("rerun scoring with the latest inputs");
  } else if (nextStep?.decision === "REVIEW_CANARY_CANDIDATE") {
    completed.push("route reached manual canary review state");
  } else if (String(nextStep?.decision || "").startsWith("BLOCKED")) {
    if ((nextStep?.reasons || []).length > 0) {
      remaining.push(`clear objective blocker (${nextStep.reasons.join(", ")})`);
    }
  }

  const finalDecision = advanceCanary?.final?.decision || shadowCycle?.canary?.decision || null;
  if (finalDecision && finalDecision !== "REVIEW_CANARY_CANDIDATE") {
    remaining.push(`advance canary beyond ${finalDecision}`);
  }

  return {
    completed: [...new Set(completed)],
    remaining: [...new Set(remaining)],
  };
}

export function buildExecutionStageSummary({ nextStep = null, dashboardStatus = null } = {}) {
  const canReview =
    nextStep?.decision === "REVIEW_CANARY_CANDIDATE" ||
    dashboardStatus?.canaryInputs?.scoreTradeReadiness === "shadow_candidate_review_only";
  const reviewReasons = nextStep?.reasons?.length
    ? nextStep.reasons
    : dashboardStatus?.canaryInputs?.blockers || [];
  const liveBlocked = dashboardStatus?.overall?.liveTrading !== "ALLOWED";
  const liveReasons = dashboardStatus?.overall?.blockers || [];

  return {
    reviewStage: canReview ? "READY_FOR_MANUAL_CANARY_REVIEW" : "NOT_READY_FOR_MANUAL_CANARY_REVIEW",
    reviewReasons,
    liveStage: liveBlocked ? "LIVE_EXECUTION_BLOCKED" : "LIVE_EXECUTION_ALLOWED",
    liveReasons,
    auditDecision: dashboardStatus?.audit?.decision || null,
  };
}

export function buildCanaryInputSummary(state, options = {}) {
  const now = options.now || new Date().toISOString();
  const route = state?.nextStep?.route || null;
  if (!route?.routeKey || !route?.amount) return null;

  const matchedScore = (state?.scoreSnapshot?.scores || []).find(
    (item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount),
  ) || null;
  const latestQuote = latestMatching(
    state?.quotes,
    (item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount),
  );
  const latestExactGas = latestMatching(
    state?.gasEstimateSnapshots,
    (item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount),
  );
  const latestSrcGas = latestMatching(state?.gasSnapshots, (item) => item.chain === route.srcChain);
  const latestBitcoinFee =
    route.srcChain === "bitcoin" || route.dstChain === "bitcoin"
      ? latestMatching(state?.bitcoinFeeSnapshots, () => true)
      : null;
  const latestMarketSnapshot = latestPriceSnapshot(state?.priceSnapshots || []);
  const scoreObservedAt = state?.scoreSnapshot?.generatedAt || null;
  const bitcoinFeeRequired = route.srcChain === "bitcoin" || route.dstChain === "bitcoin";
  const marketSnapshotFresh = latestMarketSnapshot ? isFreshPriceSnapshot(latestMarketSnapshot, { now }) : false;

  return {
    routeLabel: route.label || null,
    routeKey: route.routeKey,
    amount: route.amount,
    scoreObservedAt,
    scoreAgeMinutes: ageMinutes(scoreObservedAt, now),
    scoreTradeReadiness: matchedScore?.tradeReadiness || route.tradeReadiness || null,
    scoreDataGaps: matchedScore?.dataGaps || [],
    blockers: state?.nextStep?.reasons || [],
    gatewayQuote: freshnessSummary({
      observedAt: latestQuote?.observedAt || null,
      now,
      maxAgeMinutes: 30,
    }),
    exactGas: exactGasSummary({
      state,
      route,
      now,
      required: route.srcChain !== "bitcoin",
    }),
    srcGas: freshnessSummary({
      observedAt: latestSrcGas?.observedAt || null,
      now,
      maxAgeMinutes: 30,
      required: route.srcChain !== "bitcoin",
    }),
    dexQuote: dexQuoteSummary({ state, route, now }),
    bitcoinFee: freshnessSummary({
      observedAt: latestBitcoinFee?.observedAt || null,
      now,
      maxAgeMinutes: 30,
      required: bitcoinFeeRequired,
    }),
    marketSnapshot: {
      state: !latestMarketSnapshot ? "missing" : marketSnapshotFresh ? "fresh" : "stale",
      observedAt: latestMarketSnapshot?.observedAt || null,
      ageMinutes: ageMinutes(latestMarketSnapshot?.observedAt || null, now),
    },
  };
}
