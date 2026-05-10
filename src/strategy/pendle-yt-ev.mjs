export const PENDLE_YT_EV_POLICY = Object.freeze({
  profileId: "pendle_yt_tiny_canary_ev_v1",
  tinyLivePerTxUsd: 10,
  rewardHaircutPct: 50,
  minMaturityBufferHours: 24,
  minExitDepthUsd: 10,
  maxEntrySlippageBps: 75,
  maxExitSlippageBps: 100,
  defaultEntryCostUsd: 0.50,
  defaultExitCostUsd: 0.50,
  defaultGasCostUsd: 0.12,
});

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function iso(value) {
  if (!value) return null;
  const time = typeof value === "number" && value > 1_000_000_000 && value < 10_000_000_000
    ? value * 1000
    : new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function maturityIso(queueItem = {}) {
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || queueItem.protocolBinding || {};
  return iso(
    binding.maturity ||
    binding.maturityAt ||
    binding.ytExpiry ||
    binding.expiry ||
    binding.expirySec ||
    queueItem.ytMaturity ||
    queueItem.ytExpiry,
  );
}

function exitQuote(queueItem = {}) {
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || queueItem.protocolBinding || {};
  return queueItem.ytExitQuote || queueItem.exitQuote || binding.ytExitQuote || binding.exitQuote || null;
}

function quoteUsd(quote = null) {
  if (!quote) return null;
  return finite(quote.outputUsd) ?? finite(quote.estimatedOutputUsd) ?? finite(quote.amountOutUsd) ?? finite(quote.depthUsd);
}

export function isPendleYtQueueItem(queueItem = {}) {
  const bindingKind = lower(queueItem.protocolBindingPlan?.bindingKind || queueItem.protocolBinding?.bindingKind);
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || queueItem.protocolBinding || {};
  return lower(queueItem.protocolId) === "pendle" && (
    bindingKind === "pendle_yt_buy_sell_redeem" ||
    lower(binding.instrument) === "yt" ||
    Boolean(binding.ytTokenAddress)
  );
}

export function evaluatePendleYtEv(queueItem = {}, {
  now = new Date().toISOString(),
  policy = PENDLE_YT_EV_POLICY,
} = {}) {
  if (!isPendleYtQueueItem(queueItem)) {
    return null;
  }

  const blockers = [];
  const maturity = maturityIso(queueItem);
  const maturityHours = maturity
    ? (new Date(maturity).getTime() - new Date(now).getTime()) / 3_600_000
    : null;
  if (maturityHours == null) blockers.push("yt_maturity_missing");
  else if (maturityHours <= policy.minMaturityBufferHours) blockers.push("yt_maturity_too_close");

  const quote = exitQuote(queueItem);
  const quoteAmountUsd = quoteUsd(quote);
  const exitDepthUsd = finite(quote?.depthUsd) ?? quoteAmountUsd;
  const exitSlippageBps = finite(quote?.slippageBps) ?? finite(quote?.priceImpactBps);
  if (!quote) blockers.push("yt_exit_quote_missing");
  if (quote && (exitDepthUsd == null || exitDepthUsd < policy.minExitDepthUsd)) blockers.push("yt_liquidity_too_thin");
  if (exitSlippageBps != null && exitSlippageBps > policy.maxExitSlippageBps) blockers.push("yt_exit_slippage_too_high");

  const binding = queueItem.protocolBindingPlan?.resolvedBinding || queueItem.protocolBinding || {};
  const entrySlippageBps = finite(queueItem.entryQuote?.slippageBps) ?? finite(binding.entryQuote?.slippageBps);
  if (entrySlippageBps != null && entrySlippageBps > policy.maxEntrySlippageBps) blockers.push("yt_entry_slippage_too_high");

  const notionalUsd = finite(queueItem.tinyLivePerTxUsd) ?? finite(queueItem.requestedUsd) ?? policy.tinyLivePerTxUsd;
  const aprPct = finite(queueItem.impliedAprPct) ?? finite(binding.impliedAprPct) ?? finite(queueItem.nativeAprPct) ?? finite(queueItem.aprPct);
  const holdHours = maturityHours == null ? null : Math.max(0, maturityHours - policy.minMaturityBufferHours);
  const holdDays = holdHours == null ? null : Math.max(1, holdHours / 24);
  const rewardHaircutPct = Math.max(0, Math.min(100, finite(queueItem.rewardHaircutPct) ?? policy.rewardHaircutPct));
  const effectiveAprPct = aprPct == null ? null : aprPct * (1 - rewardHaircutPct / 100);
  if (aprPct == null) blockers.push("yt_implied_yield_missing");

  const grossYieldUsd = effectiveAprPct == null || holdDays == null
    ? null
    : notionalUsd * (effectiveAprPct / 100) * (holdDays / 365);
  const entryCostUsd = finite(queueItem.entryCostUsd) ?? finite(binding.entryCostUsd) ?? policy.defaultEntryCostUsd;
  const exitCostUsd = finite(queueItem.exitCostUsd) ?? finite(quote?.costUsd) ?? policy.defaultExitCostUsd;
  const gasCostUsd = finite(queueItem.gasCostUsd) ?? finite(binding.gasCostUsd) ?? policy.defaultGasCostUsd;
  const expectedNetUsd = grossYieldUsd == null ? null : grossYieldUsd - entryCostUsd - exitCostUsd - gasCostUsd;
  if (expectedNetUsd != null && expectedNetUsd <= 0) blockers.push("yt_expected_net_not_positive");

  return {
    policyProfile: policy.profileId,
    status: blockers.length === 0 ? "positive_ev" : "blocked",
    canaryReady: blockers.length === 0,
    blockers: [...new Set(blockers)],
    notionalUsd,
    maturity,
    maturityHours: maturityHours == null ? null : Math.round(maturityHours * 100) / 100,
    holdDays: holdDays == null ? null : Math.round(holdDays * 100) / 100,
    aprPct,
    effectiveAprPct,
    grossYieldUsd,
    expectedNetUsd,
    exitQuote: quote
      ? {
          outputUsd: quoteAmountUsd,
          depthUsd: exitDepthUsd,
          slippageBps: exitSlippageBps,
          source: quote.source || null,
        }
      : null,
  };
}
