export class GatewayClient {
  constructor({ baseUrl, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async getRoutes() {
    return this.#requestJson("/v1/get-routes");
  }

  async getQuote(params) {
    const query = new URLSearchParams(params);
    return this.#requestJson(`/v1/get-quote?${query.toString()}`);
  }

  async createOrder(quote) {
    return this.#requestJson("/v1/create-order", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(quote),
    });
  }

  async getOrder(id) {
    return this.#requestJson(`/v1/get-order/${encodeURIComponent(id)}`);
  }

  async getOrders(userAddress) {
    return this.#requestJson(`/v1/get-orders/${encodeURIComponent(userAddress)}`);
  }

  async registerTx(payload) {
    return this.#requestJson("/v1/register-tx", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  async #requestJson(path, init = {}) {
    const startedAt = Date.now();
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();

    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch (error) {
      throw new GatewayError("Gateway returned non-JSON response", {
        url,
        status: response.status,
        latencyMs,
        contentType: response.headers.get("content-type"),
        bodySnippet: bodyText.slice(0, 500),
        bodyBytes: bodyText.length,
        isCloudflareChallenge: bodyText.includes("challenge-platform") || bodyText.includes("Just a moment"),
        cause: error,
      });
    }

    if (!response.ok) {
      const bodyCode = body && typeof body === "object" ? body.code || body.error || null : null;
      const reason =
        response.status === 429
          ? `HTTP 429 ${bodyCode || "RATE_LIMITED"}`
          : bodyCode
            ? `HTTP ${response.status} ${bodyCode}`
            : `HTTP ${response.status}`;
      throw new GatewayError(`Gateway request failed: ${reason}`, {
        url,
        status: response.status,
        latencyMs,
        body,
        rateLimited: response.status === 429,
      });
    }

    return { body, latencyMs, url, status: response.status };
  }
}

export class GatewayError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "GatewayError";
    this.details = details;
  }
}

export function normalizeGatewayCode(code) {
  const normalized = String(code || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}

export function gatewayErrorCode(error) {
  if (!(error instanceof GatewayError)) return null;
  return error.details?.body?.code || error.details?.body?.error || null;
}

const INVALID_REQUEST_SUBTYPE_RULES = Object.freeze([
  {
    subtype: "invalid_request_recipient",
    keywords: ["recipient", "bitcoin address", "evm address", "btc address", "sender address"],
  },
  {
    subtype: "invalid_request_amount_unit",
    keywords: ["amount", "decimals", "wei", "satoshi", "sats", "unit"],
  },
  {
    subtype: "invalid_request_token",
    keywords: ["token", "asset", "src token", "dst token", "srctoken", "dsttoken"],
  },
  {
    subtype: "invalid_request_route_param",
    keywords: ["route", "chain", "srcchain", "dstchain", "slippage", "affiliate", "unsupported"],
  },
]);

export function classifyGatewayInvalidRequestSubtype(error) {
  if (!(error instanceof GatewayError)) return null;
  const body = error.details?.body;
  if (!body) return null;
  const code = normalizeGatewayCode(body.code || body.error);
  if (code !== "invalid_request") return null;
  const messageSource = [body.error, body.message, body.details?.reason, body.details?.message]
    .filter((part) => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (!messageSource) return "gateway_invalid_request_unknown";
  for (const rule of INVALID_REQUEST_SUBTYPE_RULES) {
    if (rule.keywords.some((keyword) => messageSource.includes(keyword))) return rule.subtype;
  }
  return "gateway_invalid_request_unknown";
}

export function classifyGatewayBlockedReason(error) {
  if (!(error instanceof GatewayError)) return null;
  const code = gatewayErrorCode(error);
  if (code) {
    const normalizedCode = normalizeGatewayCode(code);
    if (normalizedCode === "global_limit_exceeded") return "gateway_global_rate_limited";
    if (normalizedCode === "exceeded_limit") {
      const limit = String(error.details?.body?.details?.limit || "")
        .trim()
        .toLowerCase();
      if (limit === "0 btc") return "gateway_zero_btc_limit";
      return "gateway_route_limit_exceeded";
    }
    if (normalizedCode === "invalid_request") {
      return classifyGatewayInvalidRequestSubtype(error) || "gateway_invalid_request_unknown";
    }
    return normalizedCode;
  }
  const status = Number(error.details?.status);
  if (status === 404) return "no_route";
  if (status === 429) return "gateway_rate_limited";
  if (Number.isFinite(status) && status >= 400 && status < 500) return "gateway_request_rejected";
  return null;
}

export function isDeterministicGatewayBlock(error) {
  if (!(error instanceof GatewayError)) return false;
  const status = Number(error.details?.status);
  return Number.isFinite(status) && status >= 400 && status < 500;
}

function normalizeAmountString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text;
}

export function gatewayQuoteAmountFloor(error) {
  if (!(error instanceof GatewayError)) return null;
  if (classifyGatewayBlockedReason(error) !== "quote_amount_too_low") return null;
  const body = error.details?.body;
  const minimum = normalizeAmountString(body?.details?.minimum ?? body?.minimum);
  const actual = normalizeAmountString(body?.details?.actual ?? body?.actual);
  if (!minimum && !actual) return null;
  return { minimum, actual };
}

export function routeKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

export function summarizeRoutes(routes) {
  const byPair = new Map();
  const byChainPair = new Map();

  for (const route of routes) {
    const pair = `${route.srcChain}->${route.dstChain}`;
    byChainPair.set(pair, (byChainPair.get(pair) || 0) + 1);

    const tokenPair = routeKey(route);
    byPair.set(tokenPair, (byPair.get(tokenPair) || 0) + 1);
  }

  return {
    totalRoutes: routes.length,
    chainPairs: [...byChainPair.entries()]
      .map(([pair, count]) => ({ pair, count }))
      .sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair)),
    tokenPairs: [...byPair.keys()].sort(),
  };
}

export function normalizeGatewayRoutesBody(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.routes)) return body.routes;
  if (Array.isArray(body?.data?.routes)) return body.data.routes;
  return [];
}

function normalizeActionTx(tx) {
  if (!tx || typeof tx !== "object") return null;
  return {
    to: tx.to || null,
    data: tx.data || null,
    value: tx.value != null ? String(tx.value) : null,
    chain: tx.chain || null,
    txid: tx.txid || tx.txId || tx.tx_id || null,
    feeRate: tx.feeRate || tx.fee_rate || null,
  };
}

export function parseGatewayOrder(body = {}) {
  const rawStatus = body?.status;
  if (typeof rawStatus === "string") {
    return {
      status: normalizeGatewayCode(rawStatus),
      bumpFeeTx: null,
      refundTx: null,
    };
  }

  const inProgress = rawStatus?.inProgress || rawStatus?.in_progress || null;
  if (inProgress) {
    return {
      status: "in_progress",
      bumpFeeTx: normalizeActionTx(inProgress.bumpFeeTx || inProgress.bump_fee_tx),
      refundTx: normalizeActionTx(inProgress.refundTx || inProgress.refund_tx),
    };
  }

  const failed = rawStatus?.failed || null;
  if (failed) {
    return {
      status: "failed",
      bumpFeeTx: null,
      refundTx: normalizeActionTx(failed.refundTx || failed.refund_tx),
    };
  }

  return {
    status: "unknown",
    bumpFeeTx: null,
    refundTx: null,
  };
}
