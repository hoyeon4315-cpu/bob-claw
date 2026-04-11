import { EVM_CHAINS } from "../chains/registry.mjs";

const BALANCE_OF_SELECTOR = "0x70a08231";
const ALLOWANCE_SELECTOR = "0xdd62ed3e";

let requestId = 1;

function uniqueRpcUrls(chainConfig) {
  return [...new Set([...(chainConfig?.rpcUrls || []), chainConfig?.rpcUrl].filter(Boolean))];
}

function padHex(value, bytes = 32) {
  const normalized = String(value || "").replace(/^0x/i, "").toLowerCase();
  return normalized.padStart(bytes * 2, "0");
}

function encodeAddressArg(address) {
  return padHex(address.replace(/^0x/i, ""), 32);
}

function decodeBigInt(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
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
  if (!chainConfig) {
    throw new Error(`No RPC config for chain: ${chain}`);
  }
  const attempts = [];
  for (const rpcUrl of uniqueRpcUrls(chainConfig)) {
    try {
      return await executor(rpcUrl);
    } catch (error) {
      attempts.push({ rpcUrl, message: error.message, code: error.rpcError?.code ?? null });
    }
  }
  const error = new Error(`All RPC endpoints failed for chain: ${chain}`);
  error.name = "AccountStateRpcError";
  error.attempts = attempts;
  throw error;
}

export async function readNativeBalance(chain, address, options = {}) {
  return firstSuccess(chain, async (rpcUrl) => ({
    rpcUrl,
    balanceWei: decodeBigInt(await rpc(rpcUrl, "eth_getBalance", [address, "latest"], options)),
  }));
}

export async function readErc20Balance(chain, token, owner, options = {}) {
  const data = `${BALANCE_OF_SELECTOR}${encodeAddressArg(owner)}`;
  return firstSuccess(chain, async (rpcUrl) => ({
    rpcUrl,
    balance: decodeBigInt(await rpc(rpcUrl, "eth_call", [{ to: token, data }, "latest"], options)),
  }));
}

export async function readErc20Allowance(chain, token, owner, spender, options = {}) {
  const data = `${ALLOWANCE_SELECTOR}${encodeAddressArg(owner)}${encodeAddressArg(spender)}`;
  return firstSuccess(chain, async (rpcUrl) => ({
    rpcUrl,
    allowance: decodeBigInt(await rpc(rpcUrl, "eth_call", [{ to: token, data }, "latest"], options)),
  }));
}

export function summarizeRequirement(actual, required) {
  return {
    actual: actual.toString(),
    required: required.toString(),
    ok: actual >= required,
    shortfall: actual >= required ? "0" : (required - actual).toString(),
  };
}
