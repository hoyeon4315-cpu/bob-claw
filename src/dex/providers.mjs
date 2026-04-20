import { EVM_CHAINS } from "../chains/registry.mjs";
import { normalizeToken } from "../assets/tokens.mjs";
import { dexProviderPriority } from "../config/dex-providers.mjs";
import { oneInchApiKey } from "../config/dex-providers.mjs";
import { OdosProvider } from "./odos.mjs";
export { OdosProvider } from "./odos.mjs";
import {
  canQuoteWithOdos,
  ODOS_CHAIN_IDS,
  STABLE_QUOTE_TOKENS,
} from "./odos.mjs";
import { PancakeSwapProvider } from "./providers/pancake-swap.mjs";
import { OneInchProvider } from "./providers/one-inch.mjs";

export { STABLE_QUOTE_TOKENS } from "./odos.mjs";

const PROVIDER_CONSTRUCTORS = {
  odos: () => new OdosProvider(),
  pancake_swap: () => new PancakeSwapProvider(),
  one_inch: () => new OneInchProvider(),
};

export function defaultProviders() {
  const seen = new Set();
  const allNames = [];
  for (const chainPriority of Object.values(dexProviderPriority)) {
    for (const name of chainPriority) {
      if (!seen.has(name)) {
        seen.add(name);
        allNames.push(name);
      }
    }
  }
  // Always include odos as baseline
  if (!seen.has("odos")) allNames.unshift("odos");

  return allNames
    .map((name) => {
      const ctor = PROVIDER_CONSTRUCTORS[name];
      if (!ctor) return null;
      try { return ctor(); } catch { return null; }
    })
    .filter(Boolean);
}

export function dexProvidersForChain(chain) {
  const priority = dexProviderPriority(chain);
  const providers = [];
  for (const name of priority) {
    const ctor = PROVIDER_CONSTRUCTORS[name];
    if (!ctor) continue;
    // Skip 1inch if API key is missing
    if (name === "one_inch" && !oneInchApiKey()) continue;
    try {
      const instance = ctor();
      if (instance.supportsChain(chain)) {
        providers.push(instance);
      }
    } catch {
      // skip
    }
  }
  return providers;
}

export async function tryProvidersWithFallback(providers, params) {
  if (!providers || providers.length === 0) {
    const error = new Error("No DEX providers available");
    error.provider = null;
    throw error;
  }

  const errors = [];
  for (const provider of providers) {
    try {
      const quote = await provider.quote(params);
      const executableQuote = await provider.assemble({ quote, senderAddress: params.senderAddress });
      return { quote, executableQuote, provider: provider.name };
    } catch (error) {
      errors.push({ provider: provider.name, error });
    }
  }

  const allFailed = new Error(
    `All DEX providers failed: ${errors.map((e) => `${e.provider}: ${e.error.message}`).join("; ")}`,
  );
  allFailed.provider = null;
  allFailed.providerErrors = errors;
  // Preserve the first provider error's details for classification
  const firstError = errors[0]?.error;
  if (firstError) {
    allFailed.provider = firstError.provider || errors[0].provider;
    allFailed.details = firstError.details || null;
    allFailed.name = firstError.name || "Error";
  }
  throw allFailed;
}

export function defaultDexQuoteProvider(chain) {
  const providers = dexProvidersForChain(chain);
  return providers.length > 0 ? providers[0].name : null;
}

export function noSupportedRouterReason(chain) {
  const chainId = EVM_CHAINS[chain]?.chainId;
  return Number.isFinite(chainId) ? `no_supported_router_for_chain:${chainId}` : "dex_chain_not_supported";
}

export function canQuoteWithDex(chain, token, outputToken = STABLE_QUOTE_TOKENS[chain]) {
  const providers = dexProvidersForChain(chain);
  if (providers.length === 0) {
    return {
      ok: false,
      provider: null,
      reason: noSupportedRouterReason(chain),
    };
  }
  // Use the first (highest-priority) provider for capability check
  if (providers[0].name === "odos") {
    return {
      ...canQuoteWithOdos(chain, token, outputToken),
      provider: providers[0].name,
    };
  }
  return {
    ok: true,
    provider: providers[0].name,
    inputToken: normalizeToken(token) === normalizeToken("0x0000000000000000000000000000000000000000")
      ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
      : token,
    outputToken,
  };
}

export function isStructuralDexSupportFailure(reason) {
  if (!reason) return false;
  return [
    "dex_chain_not_supported",
    "odos_chain_not_supported",
    "stable_quote_token_missing",
    "input_token_not_evm",
  ].includes(reason) || String(reason).startsWith("no_supported_router_for_chain:");
}

export function normalizeDexSupportReason(reason, chain) {
  const normalizedReason = String(reason || "").trim();
  if (!normalizedReason) return reason || null;
  if (normalizedReason === "odos_chain_not_supported" || normalizedReason === "dex_chain_not_supported") {
    return noSupportedRouterReason(chain);
  }
  return normalizedReason;
}

export function classifyDexError(error, provider = null) {
  const name = provider || error?.provider || null;
  const message = String(error?.message || "");

  if (name === "pancake_swap") {
    if (message.includes("no valid quote")) return "pancake_swap_no_pool";
    return "pancake_swap_quote_failed";
  }
  if (name === "one_inch") {
    if (message.includes("API key not configured")) return "one_inch_api_key_missing";
    if (error?.status === 429) return "one_inch_rate_limited";
    if (error?.status >= 500) return "one_inch_server_error";
    return "one_inch_quote_failed";
  }
  // Default: Odos classification
  if (message.includes("Odos chain unsupported")) return "odos_chain_not_supported";
  if (String(error?.details?.body?.detail || "").includes("Routing unavailable")) return "routing_unavailable";
  return "dex_quote_failed";
}