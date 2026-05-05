import { EVM_CHAINS } from "../chains/registry.mjs";
import { rpc } from "./json-rpc.mjs";

const BALANCE_OF_SELECTOR = "0x70a08231";
const ALLOWANCE_SELECTOR = "0xdd62ed3e";
const DECIMALS_SELECTOR = "0x313ce567";
const SYMBOL_SELECTOR = "0x95d89b41";
const NAME_SELECTOR = "0x06fdde03";
const ERC4626_ASSET_SELECTOR = "0x38d52e0f";
const ERC4626_CONVERT_TO_ASSETS_SELECTOR = "0x07a2d13a";

function uniqueRpcUrls(chainConfig) {
  return [...new Set([...(chainConfig?.rpcUrls || []), chainConfig?.rpcUrl].filter(Boolean))];
}

function resolveChainConfig(chain, options = {}) {
  const base = options.chainConfig || EVM_CHAINS[chain];
  const explicitRpcUrls = [...(options.rpcUrls || []), options.rpcUrl].filter(Boolean);
  if (!base && !explicitRpcUrls.length) return null;
  if (explicitRpcUrls.length) {
    return {
      ...(base || {}),
      rpcUrls: explicitRpcUrls,
      rpcUrl: null,
    };
  }
  return {
    ...base,
  };
}

function padHex(value, bytes = 32) {
  const normalized = String(value || "").replace(/^0x/i, "").toLowerCase();
  return normalized.padStart(bytes * 2, "0");
}

function encodeAddressArg(address) {
  return padHex(address.replace(/^0x/i, ""), 32);
}

function encodeUintArg(value) {
  return padHex(BigInt(value || 0).toString(16), 32);
}

function decodeBigInt(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function decodeUint(hex) {
  return Number(decodeBigInt(hex));
}

function hexToUtf8(hex) {
  const clean = String(hex || "").replace(/^0x/u, "");
  if (!clean) return "";
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    const value = Number.parseInt(clean.slice(i, i + 2), 16);
    if (Number.isFinite(value) && value !== 0) bytes.push(value);
  }
  return Buffer.from(bytes).toString("utf8").replace(/\0+$/u, "").trim();
}

function decodeString(hex) {
  const clean = String(hex || "").replace(/^0x/u, "");
  if (!clean) return null;
  try {
    if (clean.length <= 64) return hexToUtf8(clean);
    const offset = Number(BigInt(`0x${clean.slice(0, 64)}`));
    const lengthStart = offset * 2;
    const length = Number(BigInt(`0x${clean.slice(lengthStart, lengthStart + 64)}`));
    const dataStart = lengthStart + 64;
    return hexToUtf8(clean.slice(dataStart, dataStart + length * 2));
  } catch {
    return hexToUtf8(clean.slice(0, 64));
  }
}

function decodeAddress(hex) {
  const clean = String(hex || "").replace(/^0x/u, "");
  if (clean.length < 40) return null;
  return `0x${clean.slice(-40)}`;
}

async function optionalCall(chain, token, selector, options = {}) {
  try {
    return await firstSuccess(chain, async (rpcUrl) => ({
      rpcUrl,
      result: await rpc(rpcUrl, "eth_call", [{ to: token, data: selector }, "latest"], options),
    }), options);
  } catch {
    return null;
  }
}

async function firstSuccess(chain, executor) {
  const options = arguments[2] || {};
  const chainConfig = resolveChainConfig(chain, options);
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
  }), options);
}

export async function readErc20Balance(chain, token, owner, options = {}) {
  const data = `${BALANCE_OF_SELECTOR}${encodeAddressArg(owner)}`;
  return firstSuccess(chain, async (rpcUrl) => ({
    rpcUrl,
    balance: decodeBigInt(await rpc(rpcUrl, "eth_call", [{ to: token, data }, "latest"], options)),
  }), options);
}

export async function readErc20Metadata(chain, token, options = {}) {
  const [decimalsCall, symbolCall, nameCall] = await Promise.all([
    optionalCall(chain, token, DECIMALS_SELECTOR, options),
    optionalCall(chain, token, SYMBOL_SELECTOR, options),
    optionalCall(chain, token, NAME_SELECTOR, options),
  ]);
  const decimals = decimalsCall?.result ? decodeUint(decimalsCall.result) : null;
  return {
    rpcUrl: decimalsCall?.rpcUrl || symbolCall?.rpcUrl || nameCall?.rpcUrl || null,
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : null,
    symbol: decodeString(symbolCall?.result),
    name: decodeString(nameCall?.result),
  };
}

export async function readErc4626SharePreview(chain, vault, shares, options = {}) {
  const assetCall = await optionalCall(chain, vault, ERC4626_ASSET_SELECTOR, options);
  const asset = decodeAddress(assetCall?.result);
  if (!asset) return null;
  const data = `${ERC4626_CONVERT_TO_ASSETS_SELECTOR}${encodeUintArg(shares)}`;
  const preview = await firstSuccess(chain, async (rpcUrl) => ({
    rpcUrl,
    asset,
    assets: decodeBigInt(await rpc(rpcUrl, "eth_call", [{ to: vault, data }, "latest"], options)),
  }), options);
  return preview;
}

export async function readErc20Allowance(chain, token, owner, spender, options = {}) {
  const data = `${ALLOWANCE_SELECTOR}${encodeAddressArg(owner)}${encodeAddressArg(spender)}`;
  return firstSuccess(chain, async (rpcUrl) => ({
    rpcUrl,
    allowance: decodeBigInt(await rpc(rpcUrl, "eth_call", [{ to: token, data }, "latest"], options)),
  }), options);
}

export function summarizeRequirement(actual, required) {
  return {
    actual: actual.toString(),
    required: required.toString(),
    ok: actual >= required,
    shortfall: actual >= required ? "0" : (required - actual).toString(),
  };
}
