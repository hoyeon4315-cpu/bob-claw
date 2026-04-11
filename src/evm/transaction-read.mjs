import { EVM_CHAINS } from "../chains/registry.mjs";

let requestId = 1;

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

async function firstSuccess(chain, executor) {
  const chainConfig = EVM_CHAINS[chain];
  if (!chainConfig) throw new Error(`No RPC config for chain: ${chain}`);
  const attempts = [];
  for (const rpcUrl of uniqueRpcUrls(chainConfig)) {
    try {
      return await executor(rpcUrl);
    } catch (error) {
      attempts.push({ rpcUrl, message: error.message, code: error.rpcError?.code ?? null });
    }
  }
  const error = new Error(`All RPC endpoints failed for chain: ${chain}`);
  error.name = "TransactionReadRpcError";
  error.attempts = attempts;
  throw error;
}

function decodeBigInt(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function decodeInteger(hex) {
  return Number(decodeBigInt(hex));
}

export async function readTransactionReceipt(chain, txHash, options = {}) {
  return firstSuccess(chain, async (rpcUrl) => {
    const raw = await rpc(rpcUrl, "eth_getTransactionReceipt", [txHash], options);
    if (!raw) {
      const error = new Error(`Transaction receipt not found for ${txHash}`);
      error.code = "RECEIPT_NOT_FOUND";
      throw error;
    }
    return {
      rpcUrl,
      transactionHash: raw.transactionHash,
      blockHash: raw.blockHash,
      blockNumber: decodeInteger(raw.blockNumber),
      status: decodeInteger(raw.status),
      gasUsed: decodeBigInt(raw.gasUsed),
      effectiveGasPrice: decodeBigInt(raw.effectiveGasPrice),
      cumulativeGasUsed: decodeBigInt(raw.cumulativeGasUsed),
      from: raw.from || null,
      to: raw.to || null,
      contractAddress: raw.contractAddress || null,
      raw,
    };
  });
}

export async function readTransactionByHash(chain, txHash, options = {}) {
  return firstSuccess(chain, async (rpcUrl) => {
    const raw = await rpc(rpcUrl, "eth_getTransactionByHash", [txHash], options);
    if (!raw) {
      const error = new Error(`Transaction not found for ${txHash}`);
      error.code = "TX_NOT_FOUND";
      throw error;
    }
    return {
      rpcUrl,
      hash: raw.hash,
      blockHash: raw.blockHash || null,
      blockNumber: raw.blockNumber ? decodeInteger(raw.blockNumber) : null,
      from: raw.from || null,
      to: raw.to || null,
      nonce: decodeInteger(raw.nonce),
      value: decodeBigInt(raw.value),
      gas: decodeBigInt(raw.gas),
      gasPrice: raw.gasPrice ? decodeBigInt(raw.gasPrice) : null,
      input: raw.input || "0x",
      raw,
    };
  });
}
