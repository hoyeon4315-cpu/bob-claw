import { EVM_CHAINS } from "../chains/registry.mjs";

let requestId = 1;

function chainConfigFor(chain, options = {}) {
  const base = EVM_CHAINS[chain];
  const explicitRpcUrls = [...(options.rpcUrls || []), options.rpcUrl].filter(Boolean);
  if (!base && !explicitRpcUrls.length) {
    throw new Error(`No RPC config for chain: ${chain}`);
  }
  if (explicitRpcUrls.length) {
    return {
      ...(base || {}),
      ...(options.chainConfig || {}),
      rpcUrls: explicitRpcUrls,
      rpcUrl: null,
    };
  }
  return {
    ...(base || {}),
    ...(options.chainConfig || {}),
  };
}

function uniqueRpcUrls(chainConfig) {
  return [...new Set([...(chainConfig?.rpcUrls || []), chainConfig?.rpcUrl].filter(Boolean))];
}

async function rpc(url, method, params = [], { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || `RPC ${method} failed with ${response.status}`);
    error.rpcError = body.error || null;
    throw error;
  }
  return body.result;
}

async function firstSuccess(chain, executor, options = {}) {
  const chainConfig = chainConfigFor(chain, options);
  const attempts = [];
  for (const rpcUrl of uniqueRpcUrls(chainConfig)) {
    try {
      return await executor(rpcUrl);
    } catch (error) {
      attempts.push({ rpcUrl, message: error.message, code: error.rpcError?.code ?? null });
    }
  }
  const error = new Error(`All RPC endpoints failed for chain: ${chain}`);
  error.name = "TransactionSubmitRpcError";
  error.attempts = attempts;
  throw error;
}

export async function sendRawTransaction(chain, signedTx, options = {}) {
  if (!signedTx || !String(signedTx).startsWith("0x")) {
    throw new Error("Signed transaction must be a 0x-prefixed hex string");
  }
  return firstSuccess(
    chain,
    async (rpcUrl) => {
      const txHash = await rpc(rpcUrl, "eth_sendRawTransaction", [signedTx], options);
      return {
        observedAt: new Date().toISOString(),
        rpcUrl,
        txHash,
        signedTxBytes: Math.max(0, (String(signedTx).length - 2) / 2),
      };
    },
    options,
  );
}

export function classifySendTransactionError(error) {
  const messages = [error.message, ...(error.attempts || []).map((attempt) => attempt.message)].filter(Boolean).join(" | ");
  if (/already known/i.test(messages)) return "already_known";
  if (/nonce too low/i.test(messages)) return "nonce_too_low";
  if (/replacement transaction underpriced/i.test(messages)) return "replacement_underpriced";
  if (/insufficient funds/i.test(messages)) return "insufficient_funds";
  if (/invalid sender/i.test(messages)) return "invalid_sender";
  if (/signed transaction must be a 0x-prefixed hex string/i.test(messages)) return "invalid_signed_tx";
  return "rpc_error";
}
