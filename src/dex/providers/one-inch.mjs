import { ZERO_TOKEN, WRAPPED_NATIVE_TOKENS, normalizeToken } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { ONE_INCH_API_BASE, ONE_INCH_CHAIN_IDS, ONE_INCH_SWAP_VERSION, oneInchApiKey } from "../../config/dex-providers.mjs";

const NATIVE_TOKEN_MARKER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

function toOneInchToken(chain, token) {
  if (normalizeToken(token) === normalizeToken(ZERO_TOKEN)) {
    return NATIVE_TOKEN_MARKER;
  }
  return token;
}

function fromOneInchToken(chain, token) {
  if (normalizeToken(token) === normalizeToken(NATIVE_TOKEN_MARKER)) {
    return WRAPPED_NATIVE_TOKENS[chain] || token;
  }
  return token;
}

export class OneInchProvider {
  get name() {
    return "one_inch";
  }

  supportsChain(chain) {
    return !!ONE_INCH_CHAIN_IDS[chain];
  }

  async quote({ chain, inputToken, outputToken, amount, slippageBps = 50 } = {}) {
    const apiKey = oneInchApiKey();
    if (!apiKey) {
      const error = new Error("1inch API key not configured (BOB_CLAW_INCH_API_KEY)");
      error.provider = "one_inch";
      throw error;
    }

    const chainId = ONE_INCH_CHAIN_IDS[chain];
    if (!chainId) {
      throw new Error(`1inch unsupported chain: ${chain}`);
    }
    const chainConfig = getEvmChainConfig(chain);
    const srcToken = toOneInchToken(chain, inputToken);
    const dstToken = toOneInchToken(chain, outputToken);
    const startedAt = Date.now();

    const url = `${ONE_INCH_API_BASE}/swap/${ONE_INCH_SWAP_VERSION}/${chainId}/quote?src=${srcToken}&dst=${dstToken}&amount=${amount}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(`1inch quote failed: ${response.status} ${text.slice(0, 200)}`);
      error.provider = "one_inch";
      error.status = response.status;
      throw error;
    }

    const body = await response.json();

    return {
      schemaVersion: 2,
      observedAt: new Date().toISOString(),
      provider: "one_inch",
      quoteType: "token_to_token",
      source: "one_inch_v6",
      chain,
      chainId,
      inputToken: fromOneInchToken(chain, srcToken),
      outputToken: fromOneInchToken(chain, dstToken),
      inputAmount: amount,
      outputAmount: body.dstAmount || null,
      inputValueUsd: null,
      outputValueUsd: null,
      netOutputValueUsd: null,
      gasEstimate: body.gas || null,
      gasEstimateValueUsd: null,
      priceImpactPct: null,
      slippageBps: Number(slippageBps),
      pathId: `one_inch:${srcToken}:${dstToken}:${amount}`,
      sourceWhitelist: null,
      sourceBlacklist: null,
      routingMode: "api_routed",
      executionTrust: "api_routed",
      latencyMs,
    };
  }

  async assemble({ quote, senderAddress } = {}) {
    const apiKey = oneInchApiKey();
    if (!apiKey) {
      throw new Error("1inch API key not configured (BOB_CLAW_INCH_API_KEY)");
    }

    const chainId = ONE_INCH_CHAIN_IDS[quote.chain];
    if (!chainId) {
      throw new Error(`1inch unsupported chain: ${quote.chain}`);
    }

    const srcToken = toOneInchToken(quote.chain, quote.inputToken);
    const dstToken = toOneInchToken(quote.chain, quote.outputToken);
    const slippagePercent = Number(quote.slippageBps) / 100;

    const url = `${ONE_INCH_API_BASE}/swap/${ONE_INCH_SWAP_VERSION}/${chainId}/swap?src=${srcToken}&dst=${dstToken}&amount=${quote.inputAmount}&from=${senderAddress}&slippage=${slippagePercent}`;
    const startedAt = Date.now();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(`1inch swap failed: ${response.status} ${text.slice(0, 200)}`);
      error.provider = "one_inch";
      error.status = response.status;
      throw error;
    }

    const body = await response.json();
    const tx = body.tx || {};

    return {
      ...quote,
      txTo: tx.to || null,
      txData: tx.data || null,
      txValueWei: String(tx.value || "0"),
      txGasLimit: tx.gas || null,
      txDataBytes: tx.data ? Math.max(0, (tx.data.length - 2) / 2) : null,
      gasPrice: tx.gasPrice || null,
      assembleLatencyMs: latencyMs,
    };
  }
}