import { EVM_CHAINS } from "../chains/registry.mjs";
import { rpc } from "./json-rpc.mjs";

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

function toRpcQuantity(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const bigint = typeof value === "bigint" ? value : BigInt(value);
  return `0x${bigint.toString(16)}`;
}

function normalizeTx(tx) {
  const value = toRpcQuantity(tx?.value ?? tx?.valueWei ?? 0);
  return {
    ...(tx?.from ? { from: tx.from } : {}),
    ...(tx?.to ? { to: tx.to } : {}),
    ...(tx?.data ? { data: tx.data } : {}),
    ...(value ? { value } : {}),
  };
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
  }, options);
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
  }, options);
}

export async function simulateTransactionCall(chain, tx, options = {}) {
  if (!tx?.to) {
    throw new Error("Missing transaction target for simulation call");
  }
  const blockTag = options.blockTag || "latest";
  return firstSuccess(chain, async (rpcUrl) => {
    const returnData = await rpc(rpcUrl, "eth_call", [normalizeTx(tx), blockTag], options);
    return {
      observedAt: new Date().toISOString(),
      rpcUrl,
      blockTag,
      returnData: returnData || "0x",
    };
  }, options);
}

export function classifySimulationError(error) {
  const messages = [error.message, ...(error.attempts || []).map((attempt) => attempt.message)].filter(Boolean).join(" | ");
  if (/insufficient funds/i.test(messages)) return "insufficient_funds";
  if (/execution reverted|revert/i.test(messages)) return "execution_reverted";
  if (/missing transaction target/i.test(messages)) return "missing_tx_target";
  return "rpc_error";
}
