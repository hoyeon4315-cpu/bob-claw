import { sendTelegramMessage } from "../notify/telegram.mjs";
export { buildNextReadinessCheckArgs, planNextReadinessRefresh } from "../estimator/readiness-refresh.mjs";

function observedAtMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
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

export function shouldRefreshGasForCanary(nextStep) {
  if (!nextStep) return false;
  if (nextStep.decision !== "BLOCKED_NO_VIABLE_PREP_ROUTE") return false;
  const reasons = nextStep.reasons || [];
  return reasons.length > 0 && reasons.every((reason) => reason === "stale_src_gas_snapshot");
}

export function planBlockedScoreRefresh(state) {
  const nextStep = state?.nextStep || null;
  const route = nextStep?.route || null;
  const scoreObservedAt = state?.scoreSnapshot?.generatedAt || null;
  const base = {
    shouldRefresh: false,
    reason: "not_applicable",
    routeKey: route?.routeKey || null,
    amount: route?.amount || null,
    scoreObservedAt,
    latestObservedAt: null,
    changedInputs: [],
  };

  if (!route || nextStep?.decision !== "BLOCKED_NO_VIABLE_PREP_ROUTE") {
    return base;
  }
  const reasons = nextStep.reasons || [];
  if (reasons.length !== 1 || reasons[0] !== "reject_no_net_edge") {
    return { ...base, reason: "not_net_edge_blocked" };
  }
  if (!scoreObservedAt) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "score_missing",
      changedInputs: ["score_missing"],
    };
  }

  const latestQuote = latestMatching(state?.quotes, (item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount));
  const latestExactGas = latestMatching(
    state?.gasEstimateSnapshots,
    (item) => item.routeKey === route.routeKey && String(item.amount) === String(route.amount),
  );
  const latestDexQuote = latestMatching(
    state?.dexQuotes,
    (item) => item.source === "gateway_dst_leg" && item.gatewayRouteKey === route.routeKey,
  );
  const latestSrcGasSnapshot = latestMatching(state?.gasSnapshots, (item) => item.chain === route.srcChain);
  const latestBitcoinFee = route.srcChain === "bitcoin" || route.dstChain === "bitcoin" ? latestMatching(state?.bitcoinFeeSnapshots, () => true) : null;

  const relevantInputs = [
    latestQuote ? { type: "quote", observedAt: latestQuote.observedAt } : null,
    latestExactGas ? { type: "exact_gas", observedAt: latestExactGas.observedAt } : null,
    latestDexQuote ? { type: "dex_quote", observedAt: latestDexQuote.observedAt } : null,
    latestSrcGasSnapshot ? { type: "src_gas_snapshot", observedAt: latestSrcGasSnapshot.observedAt } : null,
    latestBitcoinFee ? { type: "bitcoin_fee", observedAt: latestBitcoinFee.observedAt } : null,
  ].filter(Boolean);

  const scoreObservedAtMs = observedAtMs(scoreObservedAt);
  const changedInputs = relevantInputs
    .filter((item) => {
      const itemMs = observedAtMs(item.observedAt);
      return scoreObservedAtMs !== null && itemMs !== null && itemMs > scoreObservedAtMs;
    })
    .sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt));
  const newestRelevant = [...relevantInputs].sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt))[0] || null;

  if (changedInputs.length > 0) {
    return {
      ...base,
      shouldRefresh: true,
      reason: "newer_market_inputs",
      latestObservedAt: changedInputs[0].observedAt,
      changedInputs: changedInputs.map((item) => item.type),
    };
  }

  return {
    ...base,
    reason: "score_inputs_unchanged",
    latestObservedAt: newestRelevant?.observedAt || null,
  };
}

export function formatCanaryWatchSummary(nextStep) {
  const lines = [
    `decision=${nextStep.decision}`,
    `headline=${nextStep.headline}`,
  ];
  if (nextStep.route) {
    lines.push(`route=${nextStep.route.label} amount=${nextStep.route.amount}`);
  }
  if (nextStep.reasons?.length) {
    lines.push(`reasons=${nextStep.reasons.join(",")}`);
  }
  return lines.join("\n");
}

export function formatCanaryTelegramAlert(nextStep) {
  const lines = [
    "BOB Claw canary update",
    `decision: ${nextStep.decision}`,
    `headline: ${nextStep.headline}`,
  ];
  if (nextStep.route) {
    lines.push(`route: ${nextStep.route.label}`);
    lines.push(`amount: ${nextStep.route.amount}`);
  }
  if (nextStep.reasons?.length) {
    lines.push(`reasons: ${nextStep.reasons.join(",")}`);
  }
  return lines.join("\n");
}

export function decisionFingerprint(nextStep) {
  return JSON.stringify({
    decision: nextStep.decision,
    routeKey: nextStep.route?.routeKey || null,
    amount: nextStep.route?.amount || null,
    reasons: nextStep.reasons || [],
  });
}

export async function notifyCanaryDecision({ botToken, chatId, nextStep, fetchImpl = fetch }) {
  return sendTelegramMessage({
    botToken,
    chatId,
    text: formatCanaryTelegramAlert(nextStep),
    fetchImpl,
  });
}
