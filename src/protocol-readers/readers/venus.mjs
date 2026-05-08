// Venus market reader. Venus vTokens are Compound-v2 style shares, so the
// position surface is share balance plus exchangeRateStored-derived assets.

import { makeReaderError, makeReaderResult, defaultPositionId } from "../spec.mjs";

const VTOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function underlying() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export async function readVenus({ chain, walletAddress, params = {}, now = new Date(), _providerFactory } = {}) {
  const {
    vTokenAddress: rawVTokenAddress,
    cTokenAddress,
    shareTokenAddress,
    vaultAddress,
    assetAddress,
    underlyingTokenAddress,
    underlyingDecimals = null,
    opportunityId,
    strategyId,
    protocolId = "venus",
    bindingKind = "venus_market_supply_withdraw",
    marketLabel,
  } = params;
  const vTokenAddress = rawVTokenAddress || cTokenAddress || shareTokenAddress || vaultAddress;
  if (!chain || !walletAddress || !vTokenAddress) {
    return makeReaderError({ error: "missing chain/walletAddress/vTokenAddress", code: "missing_params" });
  }
  try {
    const vToken = await loadContract({ chain, address: vTokenAddress, abi: VTOKEN_ABI, _providerFactory });
    const [shares, exchangeRate, underlying, shareDecimals, symbolMaybe] = await Promise.all([
      vToken.balanceOf(walletAddress),
      vToken.exchangeRateStored(),
      assetAddress || underlyingTokenAddress ? Promise.resolve(assetAddress || underlyingTokenAddress) : vToken.underlying(),
      vToken.decimals(),
      vToken.symbol().catch(() => null),
    ]);
    if (shares === 0n) {
      return makeReaderResult({ positions: [], notes: ["zero_shares"] });
    }
    const assets = (BigInt(shares) * BigInt(exchangeRate)) / 1_000_000_000_000_000_000n;
    const fetchedAt = new Date(now).toISOString();
    const marketKey = String(marketLabel || vTokenAddress).toLowerCase();
    const position = {
      positionId: defaultPositionId({ chain, protocolId, walletAddress, marketKey }),
      opportunityId: opportunityId || null,
      strategyId: strategyId || null,
      walletAddress,
      bindingKind,
      protocolId,
      adapterId: "venus",
      chain,
      family: "lending_loop",
      symbol: symbolMaybe || null,
      shareTokenAddress: vTokenAddress,
      assetAddress: underlying || null,
      underlyingTokenAddress: underlying || null,
      shareBalance: shares.toString(),
      assetBalance: assets.toString(),
      assetDecimals: Number.isFinite(Number(underlyingDecimals)) ? Number(underlyingDecimals) : null,
      shareDecimals: Number(shareDecimals),
      exchangeRateStored: exchangeRate.toString(),
      fetchedAt,
      observedAt: fetchedAt,
      ttlSec: 120,
    };
    return makeReaderResult({ positions: [position] });
  } catch (err) {
    return makeReaderError({ error: err && err.message ? err.message : String(err), code: "rpc_failed" });
  }
}

async function loadContract({ chain, address, abi, _providerFactory }) {
  if (_providerFactory) return _providerFactory({ chain, address, abi });
  const { ethers } = await import("ethers");
  const { EVM_CHAIN_CONFIGS } = await import("../../config/chains.mjs");
  const cfg = EVM_CHAIN_CONFIGS[chain];
  if (!cfg) throw new Error(`unknown chain ${chain}`);
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  return new ethers.Contract(address, abi, provider);
}

export const venusReaderRegistration = {
  id: "venus",
  bindingKinds: [
    "venus_market_supply_withdraw",
    "venus_pool_supply_withdraw",
  ],
  reader: readVenus,
};
