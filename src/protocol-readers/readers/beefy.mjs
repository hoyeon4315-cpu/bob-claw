// Beefy mooToken reader: balanceOf -> getPricePerFullShare -> underlying.
// Multi-chain. Treats mooToken share as ERC20-ish.

import { makeReaderError, makeReaderResult, defaultPositionId } from "../spec.mjs";

const ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function getPricePerFullShare() view returns (uint256)",
  "function want() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export async function readBeefy({ chain, walletAddress, params = {}, now = new Date(), _providerFactory } = {}) {
  const { vaultAddress, opportunityId, strategyId, underlyingDecimals } = params;
  if (!chain || !walletAddress || !vaultAddress) {
    return makeReaderError({ error: "missing chain/walletAddress/vaultAddress", code: "missing_params" });
  }
  try {
    const vault = await loadContract({ chain, address: vaultAddress, abi: ABI, _providerFactory });
    const shares = await vault.balanceOf(walletAddress);
    if (shares === 0n) {
      return makeReaderResult({ positions: [], notes: ["zero_shares"] });
    }
    const [ppfs, want, decimals, symbolMaybe] = await Promise.all([
      vault.getPricePerFullShare(),
      vault.want(),
      vault.decimals(),
      vault.symbol().catch(() => null),
    ]);
    const dec = Number(decimals);
    const denom = 10n ** BigInt(dec);
    const underlyingAmount = (shares * ppfs) / denom;
    const fetchedAt = new Date(now).toISOString();
    const position = {
      positionId: defaultPositionId({
        chain,
        protocolId: "beefy",
        walletAddress,
        marketKey: vaultAddress.toLowerCase(),
      }),
      opportunityId: opportunityId || null,
      strategyId: strategyId || null,
      walletAddress,
      bindingKind: "beefy_vault_deposit_withdraw",
      protocolId: "beefy",
      adapterId: "beefy",
      chain,
      family: "vault_share",
      symbol: symbolMaybe || null,
      shareTokenAddress: vaultAddress,
      assetAddress: want,
      underlyingTokenAddress: want,
      shareBalance: shares.toString(),
      assetBalance: underlyingAmount.toString(),
      assetDecimals: underlyingDecimals !== undefined ? Number(underlyingDecimals) : dec,
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

export const beefyReaderRegistration = {
  id: "beefy",
  bindingKinds: ["beefy_vault_deposit_withdraw"],
  reader: readBeefy,
};
