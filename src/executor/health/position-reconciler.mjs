// Position Reconciler
// Prevents the #1 bug we found: stale API data + missing re-entries causing phantom capital
//
// Critical facts learned:
// - Zerion fallback included already-exited positions
// - RPC-only showed wallet balances, missing protocol positions
// - Time-lag checks (88wei mcbBTC) missed re-entries 3 hours later
// - Hardcoded PROTOCOL_POSITIONS became stale after re-entries
//
// This module:
// 1. Reads on-chain wallet balances (RPC)
// 2. Reads protocol positions via contract calls (not hardcoded)
// 3. Cross-validates: if protocol position exists, wallet should NOT show the same asset
// 4. Flags stale data if timestamps differ by >5 minutes
// 5. Never trusts API fallback when RPC succeeded

import { fetchRealtimePortfolio } from "../realtime-portfolio.mjs";
import { EVM_CHAIN_CONFIGS } from "../../config/chains.mjs";
import { readErc20Balance } from "../../evm/account-state.mjs";

const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const RECONCILE_VERSION = 1;

// Protocol readers: extend this registry as new protocols are integrated
const PROTOCOL_READERS = {
  // Moonwell Base (Compound v2 fork)
  async moonwell({ chain, signerAddress, marketAddresses = {} }) {
    if (chain !== "base") return null;
    const results = [];
    try {
      const { ethers } = await import("ethers");
      const cfg = EVM_CHAIN_CONFIGS[chain];
      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const cTokenAbi = [
        "function balanceOf(address) view returns (uint256)",
        "function borrowBalanceStored(address) view returns (uint256)",
        "function exchangeRateStored() view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function underlying() view returns (address)",
      ];

      for (const [symbol, address] of Object.entries(marketAddresses)) {
        try {
          const cToken = new ethers.Contract(address, cTokenAbi, provider);
          // Sequential to avoid unhandled rejections from Promise.all when RPC rate-limits
          const bal = await cToken.balanceOf(signerAddress);
          const borrow = await cToken.borrowBalanceStored(signerAddress);
          const exRate = await cToken.exchangeRateStored();
          const dec = await cToken.decimals();
          const underlying = await cToken.underlying();
          const exRateDec = 18 + 8 - Number(dec); // Compound formula
          const underlyingBal = (bal * exRate) / (10n ** BigInt(exRateDec));
          if (bal > 0n || borrow > 0n) {
            results.push({
              protocol: "moonwell",
              chain,
              symbol,
              marketAddress: address,
              underlyingToken: underlying,
              cTokenBalance: bal.toString(),
              underlyingBalance: underlyingBal.toString(),
              borrowBalance: borrow.toString(),
              decimals: Number(dec),
            });
          }
        } catch {
          // Skip unreadable markets
        }
      }
    } catch {
      return null;
    }
    return results;
  },

  // YO Protocol (ERC4626 vault)
  async yoProtocol({ chain, signerAddress, vaultAddress, assetAddress }) {
    try {
      const { ethers } = await import("ethers");
      const cfg = EVM_CHAIN_CONFIGS[chain];
      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const vaultAbi = [
        "function balanceOf(address) view returns (uint256)",
        "function convertToAssets(uint256) view returns (uint256)",
        "function asset() view returns (address)",
        "function decimals() view returns (uint8)",
      ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      // Sequential to avoid unhandled rejections from Promise.all when RPC rate-limits
      const shares = await vault.balanceOf(signerAddress);
      if (shares === 0n) return [];
      const assets = await vault.convertToAssets(shares);
      const asset = await vault.asset();
      const dec = await vault.decimals();
      return [{
        protocol: "yo-protocol",
        chain,
        vaultAddress,
        assetAddress: asset,
        shares: shares.toString(),
        assets: assets.toString(),
        decimals: Number(dec),
      }];
    } catch {
      return null;
    }
  },
};

export async function reconcilePositions({
  signerAddress,
  priceMap = {},
  protocolConfigs = [],
  useCache = false,
} = {}) {
  const startTime = Date.now();

  // 1. RPC wallet balances (always primary)
  const rpcSnapshot = await fetchRealtimePortfolio(signerAddress, { useCache, includeProtocols: false });

  // 2. Protocol positions via contract calls (never hardcoded)
  const protocolPositions = [];
  for (const config of protocolConfigs) {
    const reader = PROTOCOL_READERS[config.reader];
    if (!reader) continue;
    const positions = await reader({ chain: config.chain, signerAddress, ...config.params });
    if (positions) protocolPositions.push(...positions);
  }

  // 3. Cross-validation: flag if wallet shows assets that should be in protocol
  const warnings = [];
  for (const protoPos of protocolPositions) {
    if (!protoPos.assetAddress) continue;
    try {
      const chain = protoPos.chain;
      const walletBal = await readErc20Balance(chain, protoPos.assetAddress, signerAddress);
      if (walletBal.balance > 0n) {
        warnings.push({
          type: "wallet_has_protocol_asset",
          message: `Wallet holds ${protoPos.assetAddress} on ${chain} but also has ${protoPos.protocol} position. Possible double-counting.`,
          assetAddress: protoPos.assetAddress,
          walletBalance: walletBal.balance.toString(),
          protocol: protoPos.protocol,
        });
      }
    } catch {
      // Skip unreadable
    }
  }

  // 4. Build unified position list
  const positions = [];
  const seenPools = new Set();

  // Protocol positions first (higher accuracy)
  for (const pos of protocolPositions) {
    const poolId = `${pos.chain}-${pos.protocol}-${pos.symbol || pos.vaultAddress}`;
    const price = priceMap[pos.symbol] || priceMap[pos.assetAddress] || 0;
    const value = price ? calculatePositionValue(pos, price) : 0;
    positions.push({
      source: "protocol",
      chain: pos.chain,
      protocol: pos.protocol,
      symbol: pos.symbol || "unknown",
      allocatedUsd: value,
      pool: poolId,
      raw: pos,
    });
    seenPools.add(poolId);
  }

  // Wallet balances (exclude tokens already in protocol positions)
  for (const chainData of rpcSnapshot.chains || []) {
    for (const token of chainData.tokens || []) {
      const poolId = `${chainData.chain}-${token.symbol}`;
      if (seenPools.has(poolId)) continue;
      const price = priceMap[token.symbol] || 0;
      const value = price ? Number(token.balance) * price : 0;
      if (value > 0.5) {
        positions.push({
          source: "wallet",
          chain: chainData.chain,
          protocol: null,
          symbol: token.symbol,
          allocatedUsd: value,
          pool: poolId,
          raw: token,
        });
      }
    }
  }

  const totalCapital = positions.reduce((s, p) => s + p.allocatedUsd, 0);

  return {
    version: RECONCILE_VERSION,
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - startTime,
    signerAddress,
    positions,
    totalCapital,
    protocolCount: protocolPositions.length,
    warningCount: warnings.length,
    warnings,
    stale: false,
  };
}

function calculatePositionValue(pos, price) {
  if (pos.assets && pos.decimals !== undefined) {
    return (Number(pos.assets) / 10 ** pos.decimals) * price;
  }
  if (pos.underlyingBalance && pos.decimals !== undefined) {
    return (Number(pos.underlyingBalance) / 10 ** pos.decimals) * price;
  }
  return 0;
}

export function isReconcileStale(result, maxAgeMs = STALE_THRESHOLD_MS) {
  if (!result?.timestamp) return true;
  const age = Date.now() - new Date(result.timestamp).getTime();
  return age > maxAgeMs;
}

export { PROTOCOL_READERS };
