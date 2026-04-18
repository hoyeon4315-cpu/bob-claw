import { EVM_CHAINS } from "../chains/registry.mjs";

let requestId = 1;

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
    error.status = response.status;
    error.method = method;
    throw error;
  }
  return body.result;
}

function hexToBigInt(hex) {
  if (!hex) return null;
  return BigInt(hex);
}

function uniqueRpcUrls(chainConfig) {
  return [...new Set([...(chainConfig.rpcUrls || []), chainConfig.rpcUrl].filter(Boolean))];
}

function endpointError(url, error) {
  return {
    rpcUrl: url,
    name: error.name,
    message: error.message,
    code: error.rpcError?.code ?? null,
    data: error.rpcError?.data ?? null,
  };
}

function toRpcQuantity(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const bigint = typeof value === "bigint" ? value : BigInt(value);
  return `0x${bigint.toString(16)}`;
}

function normalizeEstimateTx(tx) {
  const value = toRpcQuantity(tx.value ?? tx.valueWei ?? 0);
  return {
    ...(tx.from ? { from: tx.from } : {}),
    to: tx.to,
    ...(tx.data ? { data: tx.data } : {}),
    ...(value ? { value } : {}),
  };
}

export async function getGasSnapshot(chainName, chainConfig = EVM_CHAINS[chainName], options = {}) {
  if (!chainConfig) {
    throw new Error(`No RPC config for chain: ${chainName}`);
  }

  const rpcUrls = uniqueRpcUrls(chainConfig);
  const attempts = [];

  for (const rpcUrl of rpcUrls) {
    const startedAt = Date.now();
    try {
      const [gasPriceHex, block] = await Promise.all([
        rpc(rpcUrl, "eth_gasPrice", [], options),
        rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false], options),
      ]);

      const gasPriceWei = hexToBigInt(gasPriceHex);
      const baseFeeWei = hexToBigInt(block.baseFeePerGas);
      const priorityFeeWei = baseFeeWei === null ? null : gasPriceWei - baseFeeWei;

      return {
        observedAt: new Date().toISOString(),
        chain: chainName,
        rpcUrl,
        nativeSymbol: chainConfig.nativeSymbol,
        latencyMs: Date.now() - startedAt,
        blockNumber: Number(hexToBigInt(block.number)),
        gasPriceWei: gasPriceWei.toString(),
        baseFeeWei: baseFeeWei?.toString() || null,
        priorityFeeWei: priorityFeeWei?.toString() || null,
        fallbackGasUnits: chainConfig.fallbackGasUnits,
        rpcFallbacksTried: attempts.length,
      };
    } catch (error) {
      attempts.push(endpointError(rpcUrl, error));
    }
  }

  const error = new Error(`All RPC endpoints failed for chain: ${chainName}`);
  error.name = "RpcFallbackError";
  error.attempts = attempts;
  throw error;
}

export function gasUsdFromSnapshot(snapshot, nativeUsd, gasUnits = snapshot.fallbackGasUnits) {
  if (!snapshot || !Number.isFinite(nativeUsd)) return null;
  const gasPriceWei = BigInt(snapshot.gasPriceWei);
  return (Number(gasPriceWei) / 1e18) * gasUnits * nativeUsd;
}

export async function estimateGas(chainName, tx, chainConfig = EVM_CHAINS[chainName], options = {}) {
  if (!chainConfig) {
    throw new Error(`No RPC config for chain: ${chainName}`);
  }
  if (!tx?.to) {
    throw new Error("Missing transaction target for gas estimate");
  }

  const rpcUrls = uniqueRpcUrls(chainConfig);
  const attempts = [];
  const call = normalizeEstimateTx(tx);

  for (const rpcUrl of rpcUrls) {
    const startedAt = Date.now();
    try {
      const estimateHex = await rpc(rpcUrl, "eth_estimateGas", [call], options);
      const gasUnits = Number(hexToBigInt(estimateHex));
      return {
        observedAt: new Date().toISOString(),
        chain: chainName,
        rpcUrl,
        latencyMs: Date.now() - startedAt,
        gasUnits,
        gasUnitsHex: estimateHex,
        rpcFallbacksTried: attempts.length,
      };
    } catch (error) {
      attempts.push(endpointError(rpcUrl, error));
    }
  }

  const error = new Error(`All RPC endpoints failed gas estimate for chain: ${chainName}`);
  error.name = "GasEstimateError";
  error.attempts = attempts;
  throw error;
}

export function classifyGasEstimateError(error) {
  const messages = [error.message, ...(error.attempts || []).map((attempt) => attempt.message)].filter(Boolean).join(" | ");
  if (/insufficient funds/i.test(messages)) return "insufficient_funds";
  if (/transfer amount exceeds allowance|insufficient allowance|allowance exceeded/i.test(messages)) return "erc20_allowance_insufficient";
  if (/transfer amount exceeds balance|insufficient balance/i.test(messages)) return "erc20_balance_insufficient";
  if (/execution reverted|revert/i.test(messages)) return "execution_reverted";
  if (/missing transaction target/i.test(messages)) return "missing_tx_target";
  return "rpc_error";
}
