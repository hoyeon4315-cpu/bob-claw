export class GatewayClient {
  constructor({ baseUrl, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async getRoutes() {
    return this.#getJson("/v1/get-routes");
  }

  async getQuote(params) {
    const query = new URLSearchParams(params);
    return this.#getJson(`/v1/get-quote?${query.toString()}`);
  }

  async #getJson(path) {
    const startedAt = Date.now();
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
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
      throw new GatewayError("Gateway request failed", {
        url,
        status: response.status,
        latencyMs,
        body,
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
