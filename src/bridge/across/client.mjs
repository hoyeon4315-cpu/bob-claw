// Across Protocol v3 HTTP client.
//
// Wraps the two endpoints the signer needs for a deposit flow:
//   GET /suggested-fees   — relayer fee + quote timestamp + limits
//   GET /deposit/status   — reconciliation lookup keyed by source tx
//
// Deliberately mirrors src/gateway/client.mjs so the error surface is
// uniform: structured GatewayError-style throw with status, body, and
// url for the audit log.

import { ACROSS_API_BASE, ACROSS_DEFAULT_POLICY } from "../../config/across.mjs";

export class AcrossError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "AcrossError";
    this.details = details;
  }
}

export class AcrossClient {
  constructor({ baseUrl = ACROSS_API_BASE, fetchImpl = fetch, timeoutMs = ACROSS_DEFAULT_POLICY.quoteTimeoutMs } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async suggestedFees({ inputToken, outputToken, originChainId, destinationChainId, amount, recipient = null }) {
    const params = new URLSearchParams({
      inputToken,
      outputToken,
      originChainId: String(originChainId),
      destinationChainId: String(destinationChainId),
      amount: String(amount),
    });
    if (recipient) params.set("recipient", recipient);
    return this.#requestJson(`/suggested-fees?${params.toString()}`);
  }

  async depositStatus({ originChainId, depositId }) {
    const params = new URLSearchParams({
      originChainId: String(originChainId),
      depositId: String(depositId),
    });
    return this.#requestJson(`/deposit/status?${params.toString()}`);
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
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();
    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch (error) {
      throw new AcrossError("Across returned non-JSON response", {
        url,
        status: response.status,
        latencyMs,
        bodySnippet: bodyText.slice(0, 500),
        cause: error,
      });
    }
    if (!response.ok) {
      const reason = body?.type || body?.message || `HTTP ${response.status}`;
      throw new AcrossError(`Across request failed: ${reason}`, {
        url,
        status: response.status,
        latencyMs,
        body,
      });
    }
    return { body, latencyMs, url, status: response.status };
  }
}
