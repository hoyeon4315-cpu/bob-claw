import { ACROSS_API_BASE, ACROSS_DEFAULT_POLICY, acrossSpokePool, acrossTokenAddress } from "../../config/across.mjs";

export async function fetchAcrossQuote(params = {}, {
  fetchFn = globalThis.fetch,
  timeoutMs = ACROSS_DEFAULT_POLICY.quoteTimeoutMs,
} = {}) {
  const {
    srcChain,
    dstChain,
    tokenTicker,
    amount,
    recipient,
  } = params;

  const srcPool = acrossSpokePool(srcChain);
  const dstPool = acrossSpokePool(dstChain);
  const token = acrossTokenAddress(srcChain, tokenTicker);

  if (!srcPool || !dstPool || !token) {
    return { ok: false, error: "across_unsupported_pair", provider: "across" };
  }

  const url = new URL("suggested-fees", ACROSS_API_BASE);
  url.searchParams.set("token", token);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("originChainId", String(params.srcChainId ?? params.originChainId ?? ""));
  url.searchParams.set("destinationChainId", String(params.dstChainId ?? params.destinationChainId ?? ""));
  if (recipient) url.searchParams.set("recipient", recipient);

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
        error: `across_http_${response.status}`,
        provider: "across",
      };
    }

    const body = await response.json();
    const feePct = Number(body?.totalRelayFee?.pct ?? body?.relayFeePct ?? 0);
    const feeAmount = Number(body?.totalRelayFee?.total ?? body?.relayFeeTotal ?? 0);
    const estimatedTimeMs = Number(body?.estimatedFillTimeSec ?? 180) * 1000;

    return {
      ok: true,
      provider: "across",
      feePct,
      feeAmount,
      estimatedTimeMs,
      validUntil: Date.now() + 60_000,
      raw: body,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      error: err.name === "AbortError" ? "across_timeout" : "across_fetch_error",
      provider: "across",
    };
  }
}

export function buildAcrossRouteIntent(quote, params = {}) {
  if (!quote?.ok) return null;
  return {
    provider: "across",
    srcChain: params.srcChain,
    dstChain: params.dstChain,
    token: params.tokenTicker,
    amount: params.amount,
    feeAmount: quote.feeAmount,
    feePct: quote.feePct,
    estimatedTimeMs: quote.estimatedTimeMs,
    validUntil: quote.validUntil,
  };
}
