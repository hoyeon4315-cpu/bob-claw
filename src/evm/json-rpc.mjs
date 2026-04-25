import http from "node:http";
import https from "node:https";

let requestId = 1;

function nextRequestId() {
  return requestId++;
}

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function shouldBypassFetch(url, fetchImpl) {
  if (fetchImpl !== fetch) return false;
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function postJsonWithNode(url, payload, timeoutMs) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode || 0,
            json: async () => JSON.parse(body || "null"),
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`RPC request timed out after ${timeoutMs}ms`));
    });
    request.write(JSON.stringify(payload));
    request.end();
  });
}

export async function rpc(url, method, params = [], { fetchImpl = fetch, timeoutMs = 12_000, loopbackPostImpl = null } = {}) {
  const payload = { jsonrpc: "2.0", id: nextRequestId(), method, params };
  const response = shouldBypassFetch(url, fetchImpl)
    ? await (loopbackPostImpl ? loopbackPostImpl(url, payload, timeoutMs) : postJsonWithNode(url, payload, timeoutMs))
    : await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
  const body = await response.json();
  if (!response.ok || body?.error) {
    const error = new Error(body?.error?.message || `RPC ${method} failed with ${response.status}`);
    error.rpcError = body?.error || null;
    throw error;
  }
  return body.result;
}
