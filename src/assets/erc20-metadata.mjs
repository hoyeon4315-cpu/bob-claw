import { EVM_CHAINS } from "../chains/registry.mjs";
import { isZeroToken, tokenAsset } from "./tokens.mjs";

const DECIMALS_SELECTOR = "0x313ce567";

async function rpc(url, method, params = [], { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `RPC ${method} failed with ${response.status}`);
  }
  return body.result;
}

function rpcUrls(chainConfig) {
  return [...new Set([...(chainConfig?.rpcUrls || []), chainConfig?.rpcUrl].filter(Boolean))];
}

function decodeUint256(hex) {
  if (!hex || hex === "0x") return null;
  return Number(BigInt(hex));
}

export async function readErc20Decimals(chain, token, options = {}) {
  if (isZeroToken(token)) return tokenAsset(chain, token).decimals;
  const urls = rpcUrls(options.chainConfig || EVM_CHAINS[chain]);
  if (urls.length === 0) return null;

  const attempts = [];
  for (const url of urls) {
    try {
      const result = await rpc(
        url,
        "eth_call",
        [
          {
            to: token,
            data: DECIMALS_SELECTOR,
          },
          "latest",
        ],
        options,
      );
      return decodeUint256(result);
    } catch (error) {
      attempts.push({ rpcUrl: url, message: error.message });
    }
  }

  const error = new Error(`Unable to read ERC20 decimals for ${chain}:${token}`);
  error.name = "TokenMetadataError";
  error.attempts = attempts;
  throw error;
}

export async function resolveTokenAsset(chain, token, options = {}) {
  const fallback = tokenAsset(chain, token);
  if (fallback.isNative || !EVM_CHAINS[chain]) return fallback;

  try {
    const decimals = await readErc20Decimals(chain, token, options);
    if (Number.isInteger(decimals)) {
      return { ...fallback, decimals, decimalsSource: "erc20" };
    }
  } catch (error) {
    return { ...fallback, decimalsSource: "static_or_missing", metadataError: error.message };
  }

  return { ...fallback, decimalsSource: fallback.decimals === null ? "missing" : "static" };
}
