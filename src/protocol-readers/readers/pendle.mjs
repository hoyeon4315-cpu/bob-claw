// Pendle PT/YT/LP reader.
// Reads PT (principal token), YT (yield token), LP balances and expiry.

import { makeReaderError, makeReaderResult, defaultPositionId } from "../spec.mjs";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
const MARKET_ABI = [
  "function expiry() view returns (uint256)",
  "function readTokens() view returns (address sy, address pt, address yt)",
];

export async function readPendle({ chain, walletAddress, params = {}, now = new Date(), _providerFactory } = {}) {
  const { marketAddress, opportunityId, strategyId } = params;
  if (!chain || !walletAddress || !marketAddress) {
    return makeReaderError({ error: "missing chain/walletAddress/marketAddress", code: "missing_params" });
  }
  try {
    const market = await loadContract({ chain, address: marketAddress, abi: MARKET_ABI, _providerFactory });
    const [expirySecRaw, tokens, lpBal] = await Promise.all([
      market.expiry(),
      market.readTokens(),
      // market itself is LP token
      loadContract({ chain, address: marketAddress, abi: ERC20_ABI, _providerFactory }).then((c) =>
        c.balanceOf(walletAddress),
      ),
    ]);
    const ptAddress = tokens?.pt ?? tokens?.[1];
    const ytAddress = tokens?.yt ?? tokens?.[2];
    if (!ptAddress || !ytAddress) {
      return makeReaderError({
        error: `pendle market ${marketAddress} returned unexpected readTokens shape (missing PT/YT)`,
        code: "missing_params",
      });
    }

    const [pt, yt] = await Promise.all([
      loadContract({ chain, address: ptAddress, abi: ERC20_ABI, _providerFactory }),
      loadContract({ chain, address: ytAddress, abi: ERC20_ABI, _providerFactory }),
    ]);
    const [ptBal, ytBal, ptDec, ytDec] = await Promise.all([
      pt.balanceOf(walletAddress),
      yt.balanceOf(walletAddress),
      pt.decimals(),
      yt.decimals(),
    ]);
    const positions = [];
    const fetchedAt = new Date(now).toISOString();
    const expirySec = Number(expirySecRaw);
    const baseFields = {
      walletAddress,
      protocolId: "pendle",
      adapterId: "pendle",
      chain,
      family: "expiry_token",
      bindingKind: "pendle_market_swap",
      expirySec,
      fetchedAt,
      observedAt: fetchedAt,
      ttlSec: 120,
      opportunityId: opportunityId || null,
      strategyId: strategyId || null,
    };
    if (ptBal > 0n) {
      positions.push({
        ...baseFields,
        positionId: defaultPositionId({
          chain,
          protocolId: "pendle",
          walletAddress,
          marketKey: `${marketAddress.toLowerCase()}:pt`,
        }),
        symbol: "PT",
        shareTokenAddress: ptAddress,
        assetAddress: ptAddress,
        underlyingTokenAddress: ptAddress,
        shareBalance: ptBal.toString(),
        assetBalance: ptBal.toString(),
        assetDecimals: Number(ptDec),
      });
    }
    if (ytBal > 0n) {
      positions.push({
        ...baseFields,
        positionId: defaultPositionId({
          chain,
          protocolId: "pendle",
          walletAddress,
          marketKey: `${marketAddress.toLowerCase()}:yt`,
        }),
        symbol: "YT",
        shareTokenAddress: ytAddress,
        assetAddress: ytAddress,
        underlyingTokenAddress: ytAddress,
        shareBalance: ytBal.toString(),
        assetBalance: ytBal.toString(),
        assetDecimals: Number(ytDec),
      });
    }
    if (lpBal > 0n) {
      positions.push({
        ...baseFields,
        positionId: defaultPositionId({
          chain,
          protocolId: "pendle",
          walletAddress,
          marketKey: `${marketAddress.toLowerCase()}:lp`,
        }),
        family: "cl_lp",
        bindingKind: "pendle_market_lp",
        symbol: "LP",
        shareTokenAddress: marketAddress,
        assetAddress: marketAddress,
        underlyingTokenAddress: marketAddress,
        shareBalance: lpBal.toString(),
        assetBalance: lpBal.toString(),
        assetDecimals: 18,
      });
    }
    if (positions.length === 0) {
      return makeReaderResult({ positions: [], notes: ["zero_balance"] });
    }
    return makeReaderResult({ positions });
  } catch (err) {
    return makeReaderError({ error: err && err.message ? err.message : String(err), code: "rpc_failed" });
  }
}

async function loadContract({ chain, address, abi, _providerFactory }) {
  if (_providerFactory) return _providerFactory({ chain, address, abi });
  const { ethers } = await import("ethers");
  const { getEvmChainConfig } = await import("../../config/chains.mjs");
  const cfg = getEvmChainConfig(chain);
  if (!cfg) throw new Error(`unknown chain ${chain}`);
  const rpcUrls = [
    ...new Set((Array.isArray(cfg.rpcUrls) && cfg.rpcUrls.length > 0 ? cfg.rpcUrls : [cfg.rpcUrl]).filter(Boolean)),
  ];
  if (rpcUrls.length === 0) throw new Error(`missing rpcUrl for chain ${chain}`);
  const contracts = rpcUrls.map((rpcUrl) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Contract(address, abi, provider);
  });
  if (contracts.length === 1) return contracts[0];
  return new Proxy(contracts[0], {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args) => {
        let lastError = null;
        for (const contract of contracts) {
          try {
            const fn = Reflect.get(contract, prop, contract);
            return await fn.apply(contract, args);
          } catch (error) {
            lastError = error;
          }
        }
        throw (
          lastError ||
          new Error(`all rpcUrls failed for ${String(prop)} on chain ${chain} (tried: ${rpcUrls.join(", ")})`)
        );
      };
    },
  });
}

export const pendleReaderRegistration = {
  id: "pendle",
  bindingKinds: ["pendle_market_swap", "pendle_market_lp"],
  reader: readPendle,
};
