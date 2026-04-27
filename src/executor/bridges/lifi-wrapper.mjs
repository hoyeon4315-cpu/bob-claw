const LIFI_API_BASE = "https://li.quest/v1";
const LIFI_QUOTE_TIMEOUT_MS = 15_000;

export async function fetchLiFiQuote(params = {}, {
  fetchFn = globalThis.fetch,
  timeoutMs = LIFI_QUOTE_TIMEOUT_MS,
} = {}) {
  const {
    srcChain,
    dstChain,
    srcToken,
    dstToken,
    amount,
    fromAddress,
    slippage = 0.005,
  } = params;

  if (!srcChain || !dstChain || !srcToken || !dstToken || !amount) {
    return { ok: false, error: "lifi_missing_required_params", provider: "lifi" };
  }

  const url = new URL("/quote", LIFI_API_BASE);
  url.searchParams.set("fromChain", String(params.srcChainId ?? srcChain));
  url.searchParams.set("toChain", String(params.dstChainId ?? dstChain));
  url.searchParams.set("fromToken", srcToken);
  url.searchParams.set("toToken", dstToken);
  url.searchParams.set("fromAmount", String(amount));
  if (fromAddress) url.searchParams.set("fromAddress", fromAddress);
  url.searchParams.set("slippage", String(slippage));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        ok: false,
        error: `lifi_http_${response.status}`,
        provider: "lifi",
      };
    }

    const body = await response.json();
    const estimate = body?.estimate || {};
    const feeUsd = Number(estimate.feeCosts?.[0]?.amountUsd ?? 0);
    const toAmount = Number(estimate.toAmount ?? 0);
    const toAmountMin = Number(estimate.toAmountMin ?? 0);
    const estimatedTimeMs = Number(estimate.executionDuration ?? 300) * 1000;

    return {
      ok: true,
      provider: "lifi",
      feeUsd,
      toAmount,
      toAmountMin,
      estimatedTimeMs,
      validUntil: Date.now() + 60_000,
      raw: body,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      error: err.name === "AbortError" ? "lifi_timeout" : "lifi_fetch_error",
      provider: "lifi",
    };
  }
}

export function buildLiFiRouteIntent(quote, params = {}) {
  if (!quote?.ok) return null;
  return {
    provider: "lifi",
    srcChain: params.srcChain,
    dstChain: params.dstChain,
    srcToken: params.srcToken,
    dstToken: params.dstToken,
    amount: params.amount,
    feeUsd: quote.feeUsd,
    toAmount: quote.toAmount,
    toAmountMin: quote.toAmountMin,
    estimatedTimeMs: quote.estimatedTimeMs,
    validUntil: quote.validUntil,
  };
}
