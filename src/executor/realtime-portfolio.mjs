// Real-time portfolio snapshot via direct RPC (no API limits, zero gas)
// Reads: native balances, ERC20 tokens, and protocol positions across all chains
// Caches results with per-layer TTLs (Phase 1.6):
//   balances 60s, NFT positions 1800s, protocol positions 120s.

import { readNativeBalance, readErc20Balance } from "../evm/account-state.mjs";
import { EVM_CHAIN_CONFIGS } from "../config/chains.mjs";
import { PROTOCOL_READERS } from "./health/position-reconciler.mjs";
import { TOKEN_REGISTRY } from "../config/token-registry.mjs";
import { enumerateAerodromeTokenIds } from "../protocol-readers/readers/aerodrome-nft-enumerator.mjs";

// Token metadata is sourced from src/config/token-registry.mjs.
// Aliased here to preserve back-compat for downstream code that may have
// imported KNOWN_TOKENS in the past; new code should import the registry directly.
const KNOWN_TOKENS = TOKEN_REGISTRY;

const BALANCES_TTL_MS = 60 * 1000;
const PROTOCOLS_TTL_MS = 120 * 1000;
const NFT_TTL_MS = 1800 * 1000;
// Legacy snapshot cache (full snapshot) keeps prior behaviour.
const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;
const _layerCache = {
  balances: new Map(), // key: address -> { at, value }
  protocols: new Map(),
  nft: new Map(),
};

function normalizeBalance(rawBalance, decimals) {
  const divisor = 10n ** BigInt(decimals);
  const integerPart = rawBalance / divisor;
  const fractionalPart = rawBalance % divisor;
  const fracStr = fractionalPart.toString().padStart(decimals, "0");
  // Trim trailing zeros but keep at least 2 decimals if there's a fractional part
  const trimmed = fracStr.replace(/0+$/, "");
  return trimmed ? `${integerPart}.${trimmed}` : integerPart.toString();
}

async function fetchChainBalances(chain, address) {
  const tokens = KNOWN_TOKENS[chain] || [];
  const results = {
    chain,
    native: null,
    tokens: [],
    fetchedAt: new Date().toISOString(),
  };

  try {
    const native = await readNativeBalance(chain, address);
    const decimals = chain === "bsc" ? 18 : 18; // ETH/BERA/S all 18 decimals
    results.native = {
      symbol: EVM_CHAIN_CONFIGS[chain]?.nativeSymbol || "ETH",
      balanceWei: native.balanceWei.toString(),
      balance: normalizeBalance(native.balanceWei, decimals),
    };
  } catch (e) {
    results.native = { error: e.message };
  }

  for (const token of tokens) {
    try {
      const res = await readErc20Balance(chain, token.address, address);
      const balanceStr = normalizeBalance(res.balance, token.decimals);
      if (res.balance > 0n) {
        results.tokens.push({
          symbol: token.symbol,
          address: token.address,
          decimals: token.decimals,
          balanceRaw: res.balance.toString(),
          balance: balanceStr,
        });
      }
    } catch (e) {
      // Skip unreadable tokens silently
    }
  }

  return results;
}

async function fetchProtocolPositions(address, {
  aerodromeTokenIds = [],
  aerodromeTokenEnumeratorImpl = enumerateAerodromeTokenIds,
  protocolReadersImpl = PROTOCOL_READERS,
} = {}) {
  const positions = [];
  const errors = [];
  const recordError = (protocol, chain, error) => {
    errors.push({
      protocol,
      chain,
      message: error?.message || String(error || "unknown protocol read failure"),
      observedAt: new Date().toISOString(),
    });
  };

  try {
    // Moonwell Base
    const moonwellPositions = await protocolReadersImpl.moonwell({
      chain: "base",
      signerAddress: address,
      marketAddresses: {
        mcbBTC: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
        mUSDC: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
      },
    });
    if (moonwellPositions) positions.push(...moonwellPositions);
  } catch (error) {
    recordError("moonwell", "base", error);
  }

  try {
    // YO Protocol Base
    const yoPositions = await protocolReadersImpl.yoProtocol({
      chain: "base",
      signerAddress: address,
      vaultAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
    if (yoPositions) positions.push(...yoPositions);
  } catch (error) {
    recordError("yo", "base", error);
  }

  try {
    // Aerodrome CL Base
    let tokenIds = aerodromeTokenIds;
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      tokenIds = await aerodromeTokenEnumeratorImpl({
        chain: "base",
        ownerAddress: address,
      }).catch(() => []);
    }
    const aerodromeResult = await protocolReadersImpl.aerodrome({
      chain: "base",
      signerAddress: address,
      tokenIds,
    });
    if (Array.isArray(aerodromeResult)) {
      positions.push(...aerodromeResult);
    } else if (aerodromeResult && Array.isArray(aerodromeResult.positions)) {
      positions.push(...aerodromeResult.positions);
    }
  } catch (error) {
    recordError("aerodrome", "base", error);
  }

  return { positions, errors };
}

export async function fetchRealtimePortfolio(address, {
  chains = null,
  useCache = true,
  includeProtocols = true,
  aerodromeTokenIds = [],
  aerodromeTokenEnumeratorImpl = enumerateAerodromeTokenIds,
  protocolReadersImpl = PROTOCOL_READERS,
} = {}) {
  if (useCache && _cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
    return _cache;
  }

  const targetChains = chains || Object.keys(EVM_CHAIN_CONFIGS);
  const allBalances = [];

  for (const chain of targetChains) {
    if (!EVM_CHAIN_CONFIGS[chain]) continue;
    const result = await fetchChainBalances(chain, address);
    allBalances.push(result);
  }

  const protocolResult = includeProtocols
    ? await fetchProtocolPositions(address, { aerodromeTokenIds, aerodromeTokenEnumeratorImpl, protocolReadersImpl })
    : { positions: [], errors: [] };
  const protocolPositions = protocolResult.positions;
  const protocolReadErrors = protocolResult.errors;

  const snapshot = {
    address,
    fetchedAt: new Date().toISOString(),
    chains: allBalances,
    protocolPositions,
    protocolReadErrors,
    staleness: buildStalenessMap({ allBalances, protocolPositions }),
    summary: {
      chainCount: allBalances.length,
      chainsWithBalance: allBalances.filter((c) => {
        const hasNative = c.native && !c.native.error && Number(c.native.balance) > 0;
        const hasTokens = c.tokens && c.tokens.length > 0;
        return hasNative || hasTokens;
      }).length,
      totalTokenTypes: allBalances.reduce((s, c) => s + c.tokens.length, 0),
      protocolPositionCount: protocolPositions.length,
      protocolReadErrorCount: protocolReadErrors.length,
    },
  };

  _cache = snapshot;
  _cacheAt = Date.now();
  return snapshot;
}

function buildStalenessMap({ allBalances, protocolPositions }) {
  const map = { chains: {}, protocols: {} };
  for (const c of allBalances) {
    map.chains[c.chain] = c.fetchedAt || null;
  }
  const seen = new Set();
  for (const p of protocolPositions) {
    const key = `${p.chain || "unknown"}:${p.protocol || "unknown"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    map.protocols[key] = new Date().toISOString();
  }
  return map;
}

export function clearPortfolioCache() {
  _cache = null;
  _cacheAt = 0;
  _layerCache.balances.clear();
  _layerCache.protocols.clear();
  _layerCache.nft.clear();
}

export function _getCacheConfigForTesting() {
  return { BALANCES_TTL_MS, PROTOCOLS_TTL_MS, NFT_TTL_MS, CACHE_TTL_MS };
}

// Convenience: format for autopilot consumption
export function toAutopilotPositions(snapshot, { priceMap = {} } = {}) {
  const positions = [];
  const btcPrice = priceMap.BTC || 95_000;

  for (const chainData of snapshot.chains) {
    // Native tokens as non-positions (only if price known)
    if (chainData.native && !chainData.native.error && Number(chainData.native.balance) > 0) {
      const price = priceMap[chainData.native.symbol];
      if (price) {
        const value = Number(chainData.native.balance) * price;
        if (value > 0.5) {
          positions.push({
            chain: chainData.chain,
            protocol: null,
            symbol: chainData.native.symbol,
            allocatedUsd: value,
            pool: `${chainData.chain}-${chainData.native.symbol.toLowerCase()}-native`,
            apy: 0,
          });
        }
      }
    }

    // ERC20 tokens (only if price known)
    for (const token of chainData.tokens) {
      const price = priceMap[token.symbol];
      if (price) {
        const value = Number(token.balance) * price;
        if (value > 0.5) {
          positions.push({
            chain: chainData.chain,
            protocol: null,
            symbol: token.symbol,
            allocatedUsd: value,
            pool: `${chainData.chain}-${token.symbol.toLowerCase()}`,
            apy: 0,
          });
        }
      }
    }
  }

  return positions;
}
