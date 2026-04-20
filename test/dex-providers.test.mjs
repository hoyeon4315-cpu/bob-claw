import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultProviders,
  dexProvidersForChain,
  tryProvidersWithFallback,
  defaultDexQuoteProvider,
  noSupportedRouterReason,
  canQuoteWithDex,
  isStructuralDexSupportFailure,
  normalizeDexSupportReason,
  classifyDexError,
  OdosProvider,
} from "../src/dex/providers.mjs";
import { PancakeSwapProvider } from "../src/dex/providers/pancake-swap.mjs";
import { OneInchProvider } from "../src/dex/providers/one-inch.mjs";
import { STABLE_QUOTE_TOKENS } from "../src/dex/providers.mjs";

test("defaultProviders returns at least OdosProvider", () => {
  const providers = defaultProviders();
  assert.ok(providers.length >= 1);
  assert.ok(providers.some((p) => p.name === "odos"));
});

test("dexProvidersForChain returns odos for base", () => {
  const providers = dexProvidersForChain("base");
  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, "odos");
});

test("dexProvidersForChain returns odos + pancake_swap for BSC", () => {
  const providers = dexProvidersForChain("bsc");
  assert.ok(providers.length >= 2);
  assert.equal(providers[0].name, "odos");
  assert.equal(providers[1].name, "pancake_swap");
  // 1inch only included if API key is set
});

test("dexProvidersForChain returns empty for unknown chain", () => {
  const providers = dexProvidersForChain("unknown_chain");
  assert.equal(providers.length, 0);
});

test("defaultDexQuoteProvider returns odos for known chains", () => {
  assert.equal(defaultDexQuoteProvider("bsc"), "odos");
  assert.equal(defaultDexQuoteProvider("base"), "odos");
  assert.equal(defaultDexQuoteProvider("ethereum"), "odos");
});

test("defaultDexQuoteProvider returns null for unknown chains", () => {
  assert.equal(defaultDexQuoteProvider("unknown_chain"), null);
});

test("tryProvidersWithFallback tries providers in order", async () => {
  const firstProvider = {
    name: "first",
    supportsChain: () => true,
    quote: async () => ({ outputAmount: "100" }),
    assemble: async ({ quote }) => ({ ...quote, txTo: "0x111", txData: "0x222" }),
  };
  const secondProvider = {
    name: "second",
    supportsChain: () => true,
    quote: async () => ({ outputAmount: "200" }),
    assemble: async ({ quote }) => ({ ...quote, txTo: "0x333", txData: "0x444" }),
  };

  const result = await tryProvidersWithFallback([firstProvider, secondProvider], {
    chain: "bsc",
    senderAddress: "0x1234",
  });
  assert.equal(result.provider, "first");
});

test("tryProvidersWithFallback falls back to second provider on failure", async () => {
  const firstProvider = {
    name: "failing",
    supportsChain: () => true,
    quote: async () => { throw new Error("Failed"); },
    assemble: async () => {},
  };
  const secondProvider = {
    name: "working",
    supportsChain: () => true,
    quote: async () => ({ outputAmount: "100", pathId: "test-path" }),
    assemble: async ({ quote }) => ({ ...quote, txTo: "0x111", txData: "0x222", pathId: quote.pathId }),
  };

  const result = await tryProvidersWithFallback([firstProvider, secondProvider], {
    chain: "bsc",
    senderAddress: "0x1234",
  });
  assert.equal(result.provider, "working");
});

test("tryProvidersWithFallback throws when all providers fail", async () => {
  const provider1 = {
    name: "fail1",
    supportsChain: () => true,
    quote: async () => { throw new Error("Error 1"); },
    assemble: async () => {},
  };
  const provider2 = {
    name: "fail2",
    supportsChain: () => true,
    quote: async () => { throw new Error("Error 2"); },
    assemble: async () => {},
  };

  try {
    await tryProvidersWithFallback([provider1, provider2], { chain: "bsc", senderAddress: "0x1234" });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error.message.includes("All DEX providers failed"));
    assert.ok(error.providerErrors);
    assert.equal(error.providerErrors.length, 2);
    // First error details should be preserved
    assert.equal(error.details, null); // Error 1 has no details
  }
});

test("tryProvidersWithFallback throws when no providers", async () => {
  try {
    await tryProvidersWithFallback([], { chain: "bsc" });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error.message.includes("No DEX providers"));
  }
});

test("noSupportedRouterReason returns chain ID for EVM chains", () => {
  assert.equal(noSupportedRouterReason("bsc"), "no_supported_router_for_chain:56");
  assert.equal(noSupportedRouterReason("base"), "no_supported_router_for_chain:8453");
});

test("canQuoteWithDex returns ok for BSC with USDT", () => {
  const result = canQuoteWithDex("bsc", "0x55d398326f99059fF775485246999027B3197955");
  assert.equal(result.ok, true);
  assert.equal(result.provider, "odos");
});

test("canQuoteWithDex returns failure for unknown chain", () => {
  const result = canQuoteWithDex("unknown_chain", "0x1234");
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes("dex_chain_not_supported") || result.reason.includes("no_supported_router"));
});

test("isStructuralDexSupportFailure recognizes known reasons", () => {
  assert.equal(isStructuralDexSupportFailure("dex_chain_not_supported"), true);
  assert.equal(isStructuralDexSupportFailure("odos_chain_not_supported"), true);
  assert.equal(isStructuralDexSupportFailure("stable_quote_token_missing"), true);
  assert.equal(isStructuralDexSupportFailure("no_supported_router_for_chain:56"), true);
  assert.equal(isStructuralDexSupportFailure("routing_unavailable"), false);
  assert.equal(isStructuralDexSupportFailure(null), false);
});

test("normalizeDexSupportReason normalizes odos_chain_not_supported", () => {
  assert.equal(normalizeDexSupportReason("odos_chain_not_supported", "bsc"), "no_supported_router_for_chain:56");
  assert.equal(normalizeDexSupportReason("dex_chain_not_supported", "base"), "no_supported_router_for_chain:8453");
  assert.equal(normalizeDexSupportReason("routing_unavailable", "bsc"), "routing_unavailable");
});

test("classifyDexError classifies PancakeSwap errors", () => {
  const noPoolError = new Error("PancakeSwap: no valid quote for any fee tier");
  noPoolError.provider = "pancake_swap";
  assert.equal(classifyDexError(noPoolError), "pancake_swap_no_pool");

  const genericError = new Error("Something went wrong");
  genericError.provider = "pancake_swap";
  assert.equal(classifyDexError(genericError), "pancake_swap_quote_failed");
});

test("classifyDexError classifies 1inch errors", () => {
  const keyError = new Error("1inch API key not configured");
  keyError.provider = "one_inch";
  assert.equal(classifyDexError(keyError), "one_inch_api_key_missing");

  const rateLimitError = new Error("1inch quote failed");
  rateLimitError.provider = "one_inch";
  rateLimitError.status = 429;
  assert.equal(classifyDexError(rateLimitError), "one_inch_rate_limited");

  const serverError = new Error("1inch server error");
  serverError.provider = "one_inch";
  serverError.status = 500;
  assert.equal(classifyDexError(serverError), "one_inch_server_error");

  const genericError = new Error("1inch quote failed");
  genericError.provider = "one_inch";
  assert.equal(classifyDexError(genericError), "one_inch_quote_failed");
});

test("classifyDexError classifies Odos errors by default", () => {
  const odosError = new Error("Odos chain unsupported: test");
  assert.equal(classifyDexError(odosError), "odos_chain_not_supported");

  const genericError = new Error("Unknown error");
  assert.equal(classifyDexError(genericError), "dex_quote_failed");
});

test("STABLE_QUOTE_TOKENS re-exported from providers.mjs", () => {
  assert.ok(STABLE_QUOTE_TOKENS.bsc);
  assert.ok(STABLE_QUOTE_TOKENS.base);
  assert.equal(STABLE_QUOTE_TOKENS.bsc.ticker, "USDC");
});

test("OdosProvider is re-exported from providers.mjs", () => {
  assert.ok(OdosProvider);
  const instance = new OdosProvider();
  assert.equal(instance.name, "odos");
  assert.equal(instance.supportsChain("bsc"), true);
  assert.equal(instance.supportsChain("base"), true);
  assert.equal(instance.supportsChain("unknown"), false);
});