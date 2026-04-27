import { getChainConfig } from "../../config/chains.mjs";

const NATIVE_BTC_TUNNEL_TIMEOUT_MS = 20_000;

export async function fetchNativeBtcTunnelQuote(params = {}, {
  fetchFn = globalThis.fetch,
  timeoutMs = NATIVE_BTC_TUNNEL_TIMEOUT_MS,
  chainConfig = null,
} = {}) {
  const { chain, amountSats, recipientBtcAddress } = params;

  const config = chainConfig ?? getChainConfig(chain);
  const bridge = config?.nativeBtcBridge;

  if (!bridge || !bridge.endpoint) {
    return {
      ok: false,
      error: "native_btc_tunnel_unsupported_chain",
      provider: "native_btc_tunnel",
    };
  }

  const url = new URL("/quote", bridge.endpoint);
  url.searchParams.set("chain", chain);
  url.searchParams.set("amountSats", String(amountSats));
  if (recipientBtcAddress) {
    url.searchParams.set("recipient", recipientBtcAddress);
  }

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
        error: `native_btc_tunnel_http_${response.status}`,
        provider: "native_btc_tunnel",
      };
    }

    const body = await response.json();
    const feeSats = Number(body?.feeSats ?? body?.fee ?? 0);
    const estimatedTimeMs = Number(body?.estimatedTimeMs ?? 600_000);

    return {
      ok: true,
      provider: "native_btc_tunnel",
      feeSats,
      estimatedTimeMs,
      validUntil: Date.now() + 90_000,
      raw: body,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      error: err.name === "AbortError" ? "native_btc_tunnel_timeout" : "native_btc_tunnel_fetch_error",
      provider: "native_btc_tunnel",
    };
  }
}

export function buildNativeBtcTunnelIntent(quote, params = {}) {
  if (!quote?.ok) return null;
  return {
    provider: "native_btc_tunnel",
    chain: params.chain,
    amountSats: params.amountSats,
    recipientBtcAddress: params.recipientBtcAddress,
    feeSats: quote.feeSats,
    estimatedTimeMs: quote.estimatedTimeMs,
    validUntil: quote.validUntil,
  };
}
