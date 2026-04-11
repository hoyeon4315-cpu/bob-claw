import { EVM_CHAINS } from "../chains/registry.mjs";
import { isZeroToken, normalizeToken } from "../assets/tokens.mjs";

export const ODOS_API_BASE = "https://api.odos.xyz";
export const ODOS_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const ODOS_CHAIN_IDS = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  unichain: 130,
  sonic: 146,
  avalanche: 43114,
  base: 8453,
  arbitrum: 42161,
};

export const STABLE_QUOTE_TOKENS = {
  avalanche: {
    ticker: "USDC",
    token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6",
    decimals: 6,
  },
  base: {
    ticker: "USDC",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  bsc: {
    ticker: "USDC",
    token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
  },
  ethereum: {
    ticker: "USDC",
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
};

export function odosTokenAddress(chain, token) {
  if (isZeroToken(token)) {
    if (!EVM_CHAINS[chain]) return null;
    return ODOS_NATIVE_TOKEN;
  }
  return token;
}

export function canQuoteWithOdos(chain, token, outputToken = STABLE_QUOTE_TOKENS[chain]) {
  if (!ODOS_CHAIN_IDS[chain]) return { ok: false, reason: "odos_chain_not_supported" };
  if (!outputToken) return { ok: false, reason: "stable_quote_token_missing" };
  const inputToken = odosTokenAddress(chain, token);
  if (!inputToken) return { ok: false, reason: "input_token_not_evm" };
  if (normalizeToken(inputToken) === normalizeToken(outputToken.token)) return { ok: false, reason: "input_is_quote_stable" };
  return { ok: true, inputToken, outputToken };
}

export class OdosClient {
  constructor({ baseUrl = ODOS_API_BASE, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async getChains() {
    return this.#getJson("/info/chains");
  }

  async quote({ chain, inputToken, outputToken, amount, userAddr, slippageLimitPercent = 0.5 }) {
    const chainId = ODOS_CHAIN_IDS[chain];
    if (!chainId) throw new Error(`Odos chain unsupported: ${chain}`);
    const body = {
      chainId,
      inputTokens: [{ tokenAddress: inputToken, amount }],
      outputTokens: [{ tokenAddress: outputToken, proportion: 1 }],
      userAddr,
      slippageLimitPercent,
      referralCode: 0,
      disableRFQs: true,
      compact: true,
    };
    return this.#postJson("/sor/quote/v3", body);
  }

  async #getJson(path) {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    return this.#readJson(response, startedAt);
  }

  async #postJson(path, body) {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return this.#readJson(response, startedAt, body);
  }

  async #readJson(response, startedAt, requestBody = null) {
    const latencyMs = Date.now() - startedAt;
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (error) {
      const wrapped = new Error("Odos returned non-JSON response");
      wrapped.details = { status: response.status, latencyMs, bodySnippet: text.slice(0, 500), requestBody };
      wrapped.cause = error;
      throw wrapped;
    }
    if (!response.ok) {
      const error = new Error(body?.detail || body?.message || `Odos request failed with ${response.status}`);
      error.details = { status: response.status, latencyMs, body, requestBody };
      throw error;
    }
    return { body, latencyMs, status: response.status };
  }
}

export function normalizeOdosQuote({ chain, source, amount, inputToken, outputToken, outputTicker, outputDecimals, result }) {
  const body = result.body;
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    provider: "odos",
    quoteType: "token_to_stable",
    source,
    chain,
    chainId: ODOS_CHAIN_IDS[chain],
    inputToken,
    outputToken,
    outputTicker,
    outputDecimals,
    inputAmount: amount,
    outputAmount: body.outAmounts?.[0] || null,
    inputValueUsd: body.inValues?.[0] ?? null,
    outputValueUsd: body.outValues?.[0] ?? null,
    netOutputValueUsd: body.netOutValue ?? null,
    gasEstimate: body.gasEstimate ?? null,
    gasEstimateValueUsd: body.gasEstimateValue ?? null,
    priceImpactPct: body.priceImpact ?? null,
    percentDiff: body.percentDiff ?? null,
    gweiPerGas: body.gweiPerGas ?? null,
    blockNumber: body.blockNumber ?? null,
    pathId: body.pathId || null,
    latencyMs: result.latencyMs,
  };
}
