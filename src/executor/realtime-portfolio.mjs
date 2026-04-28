// Real-time portfolio snapshot via direct RPC (no API limits, zero gas)
// Reads: native balances, ERC20 tokens, and protocol positions across all chains
// Caches results for 5 minutes to avoid redundant RPC calls

import { readNativeBalance, readErc20Balance } from "../evm/account-state.mjs";
import { EVM_CHAIN_CONFIGS } from "../config/chains.mjs";
import { PROTOCOL_READERS } from "./health/position-reconciler.mjs";

// Known token contracts per chain (add as needed)
const KNOWN_TOKENS = Object.freeze({
  base: [
    { symbol: "USDC",  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    { symbol: "wBTC",  address: "0x1ceA84203673764244E05693e42E6Ace62bD9ad4", decimals: 8 }, // wBTC.OFT on Base
    { symbol: "AERO",  address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    { symbol: "WETH",  address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
  ethereum: [
    { symbol: "USDC",  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "USDT",  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    { symbol: "RLUSD", address: "0x8292Bb45bf1E4a0860d4bC8E964E223C0B05d576", decimals: 18 },
    { symbol: "WBTC",  address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
    { symbol: "WETH",  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  ],
  bsc: [
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
  ],
  avalanche: [
    { symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
  ],
  sonic: [
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
  ],
});

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _cache = null;
let _cacheAt = 0;

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

async function fetchProtocolPositions(address) {
  const positions = [];

  try {
    // Moonwell Base
    const moonwellPositions = await PROTOCOL_READERS.moonwell({
      chain: "base",
      signerAddress: address,
      marketAddresses: {
        mcbBTC: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
        mUSDC: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
      },
    });
    if (moonwellPositions) positions.push(...moonwellPositions);
  } catch {
    // Skip unreadable protocol positions
  }

  try {
    // YO Protocol Base
    const yoPositions = await PROTOCOL_READERS.yoProtocol({
      chain: "base",
      signerAddress: address,
      vaultAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
    if (yoPositions) positions.push(...yoPositions);
  } catch {
    // Skip unreadable protocol positions
  }

  return positions;
}

export async function fetchRealtimePortfolio(address, { chains = null, useCache = true, includeProtocols = true } = {}) {
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

  const protocolPositions = includeProtocols ? await fetchProtocolPositions(address) : [];

  const snapshot = {
    address,
    fetchedAt: new Date().toISOString(),
    chains: allBalances,
    protocolPositions,
    summary: {
      chainCount: allBalances.length,
      chainsWithBalance: allBalances.filter((c) => {
        const hasNative = c.native && !c.native.error && Number(c.native.balance) > 0;
        const hasTokens = c.tokens && c.tokens.length > 0;
        return hasNative || hasTokens;
      }).length,
      totalTokenTypes: allBalances.reduce((s, c) => s + c.tokens.length, 0),
      protocolPositionCount: protocolPositions.length,
    },
  };

  _cache = snapshot;
  _cacheAt = Date.now();
  return snapshot;
}

export function clearPortfolioCache() {
  _cache = null;
  _cacheAt = 0;
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
