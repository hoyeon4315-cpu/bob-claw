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
    token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
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
  sonic: {
    ticker: "USDC",
    token: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
    decimals: 6,
  },
  unichain: {
    ticker: "USDC",
    token: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    decimals: 6,
  },
};

const COMMON_SAFE_AMMS = [
  "Uniswap V2",
  "Uniswap V3",
  "Uniswap V4",
  "Curve",
  "Curve V2",
  "SushiSwap",
  "SushiSwap V3",
  "Balancer V2",
  "Balancer V3",
  "PancakeSwap V2",
  "PancakeSwap V3",
  "Maverick V2",
  "DODO",
  "KyberSwap",
  "WooFi",
];

const SAFE_CHAIN_SOURCE_WHITELISTS = {
  ethereum: [
    ...COMMON_SAFE_AMMS,
  ],
  optimism: [
    "Uniswap V3",
    "Curve",
    "Velodrome",
    "Velodrome V2",
    "SushiSwap",
    "PancakeSwap V3",
    "KyberSwap",
    "WooFi",
  ],
  bsc: [
    "PancakeSwap V2",
    "PancakeSwap V3",
    "Uniswap V3",
    "Curve",
    "SushiSwap",
    "DODO",
    "KyberSwap",
    "WooFi",
  ],
  unichain: [
    "Uniswap V2",
    "Uniswap V3",
    "PancakeSwap V3",
    "Curve",
    "SushiSwap",
  ],
  sonic: [
    "Uniswap V2",
    "Uniswap V3",
    "Curve",
    "SushiSwap",
  ],
  avalanche: [
    "TraderJoe",
    "TraderJoe V2",
    "Uniswap V3",
    "Curve",
    "SushiSwap",
    "KyberSwap",
    "WooFi",
  ],
  base: [
    "Uniswap V2",
    "Uniswap V3",
    "Uniswap V4",
    "Aerodrome",
    "Aerodrome SlipStream",
    "Curve",
    "Curve V2",
    "SushiSwap",
    "SushiSwap V3",
    "BaseSwap",
    "BaseSwap V3",
    "PancakeSwap V2",
    "PancakeSwap V3",
    "Maverick V2",
    "Balancer V2",
    "Balancer V3",
    "DODO",
    "WooFi",
    "KyberSwap",
    "AlienBase",
    "DackieSwap",
  ],
  arbitrum: [
    "Uniswap V3",
    "Curve",
    "SushiSwap",
    "Balancer V2",
    "PancakeSwap V3",
    "Camelot",
    "DODO",
    "KyberSwap",
    "WooFi",
  ],
};

export const ODOS_SAFE_SOURCE_WHITELISTS = Object.freeze(
  Object.fromEntries(
    Object.entries(SAFE_CHAIN_SOURCE_WHITELISTS).map(([chain, sources]) => [
      chain,
      Object.freeze([...new Set(sources)]),
    ]),
  ),
);

function normalizeSourceList(list) {
  if (!Array.isArray(list)) return null;
  const normalized = [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))];
  return normalized.length ? normalized.sort((left, right) => left.localeCompare(right)) : null;
}

function sameSourceList(left, right) {
  const normalizedLeft = normalizeSourceList(left) || [];
  const normalizedRight = normalizeSourceList(right) || [];
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function odosSafeSourceWhitelist(chain) {
  const normalizedChain = String(chain || "").toLowerCase();
  const sources = ODOS_SAFE_SOURCE_WHITELISTS[normalizedChain];
  return sources ? [...sources] : null;
}

export function odosRoutingConfig(chain, { sourceWhitelist = null, sourceBlacklist = null, allowUnsafe = false } = {}) {
  const safeWhitelist = odosSafeSourceWhitelist(chain);
  const resolvedWhitelist = normalizeSourceList(sourceWhitelist) || (!allowUnsafe ? safeWhitelist : null);
  const resolvedBlacklist = normalizeSourceList(sourceBlacklist);
  const routingMode = resolvedWhitelist ? "whitelist" : resolvedBlacklist ? "blacklist" : "unrestricted";
  const executionTrust = resolvedWhitelist && sameSourceList(resolvedWhitelist, safeWhitelist)
    ? "safe_whitelist"
    : "quote_only_untrusted";
  return {
    sourceWhitelist: resolvedWhitelist,
    sourceBlacklist: resolvedBlacklist,
    routingMode,
    executionTrust,
  };
}

export function isTrustedExecutableDexQuote(quote) {
  if (!quote) return false;
  if (quote.provider && quote.provider !== "odos") return true;
  const safeWhitelist = odosSafeSourceWhitelist(quote.chain);
  if (!safeWhitelist) return false;
  return sameSourceList(quote.sourceWhitelist, safeWhitelist);
}

export function filterTrustedExecutableDexQuotes(quotes = []) {
  return (quotes || []).filter((quote) => isTrustedExecutableDexQuote(quote));
}

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

  async quote({
    chain,
    inputToken,
    outputToken,
    amount,
    userAddr,
    slippageLimitPercent = 0.5,
    sourceWhitelist = null,
    sourceBlacklist = null,
  }) {
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
    const normalizedWhitelist = normalizeSourceList(sourceWhitelist);
    const normalizedBlacklist = normalizeSourceList(sourceBlacklist);
    if (normalizedWhitelist) body.sourceWhitelist = normalizedWhitelist;
    if (normalizedBlacklist) body.sourceBlacklist = normalizedBlacklist;
    return this.#postJson("/sor/quote/v3", body);
  }

  async assemble({ pathId, userAddr }) {
    return this.#postJson("/sor/assemble", {
      pathId,
      userAddr,
    });
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

export function normalizeOdosQuote({
  chain,
  source,
  amount,
  inputToken,
  outputToken,
  inputTicker = null,
  inputDecimals = null,
  outputTicker,
  outputDecimals,
  quoteType = "token_to_stable",
  result,
  sourceWhitelist = null,
  sourceBlacklist = null,
}) {
  const body = result.body;
  const routing = odosRoutingConfig(chain, { sourceWhitelist, sourceBlacklist, allowUnsafe: true });
  return {
    schemaVersion: 2,
    observedAt: new Date().toISOString(),
    provider: "odos",
    quoteType,
    source,
    chain,
    chainId: ODOS_CHAIN_IDS[chain],
    inputToken,
    inputTicker,
    inputDecimals,
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
    sourceWhitelist: routing.sourceWhitelist,
    sourceBlacklist: routing.sourceBlacklist,
    routingMode: routing.routingMode,
    executionTrust: routing.executionTrust,
    latencyMs: result.latencyMs,
  };
}

export function attachOdosAssembly(quote, result) {
  const transaction = result?.body?.transaction || {};
  const txData = transaction.data || null;
  return {
    ...quote,
    txTo: transaction.to || null,
    txData,
    txValueWei: String(transaction.value ?? "0"),
    txGasLimit: transaction.gas ?? transaction.gasLimit ?? null,
    txDataBytes: txData ? Math.max(0, (txData.length - 2) / 2) : null,
    assembleLatencyMs: result?.latencyMs ?? null,
  };
}
