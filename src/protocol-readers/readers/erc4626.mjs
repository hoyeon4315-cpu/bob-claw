// ERC4626 vault reader. Generic vault share -> assets via convertToAssets.
// Used as the default for Morpho MetaMorpho, YO, and other 4626-compliant vaults.

import { makeReaderError, makeReaderResult, defaultPositionId } from "../spec.mjs";

const ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export async function readErc4626({
  chain,
  walletAddress,
  params = {},
  now = new Date(),
  _providerFactory,
  _chainConfigResolver,
  _ethersLoader,
} = {}) {
  const {
    vaultAddress,
    protocolId = "erc4626",
    bindingKind = "erc4626_vault_supply_withdraw",
    family = "vault_share",
    opportunityId,
    strategyId,
  } = params;
  if (!chain || !walletAddress || !vaultAddress) {
    return makeReaderError({ error: "missing chain/walletAddress/vaultAddress", code: "missing_params" });
  }
  try {
    const vault = await loadContract({
      chain,
      vaultAddress,
      abi: ABI,
      _providerFactory,
      _chainConfigResolver,
      _ethersLoader,
    });
    const shares = await vault.balanceOf(walletAddress);
    if (shares === 0n) {
      return makeReaderResult({ positions: [], notes: ["zero_shares"] });
    }
    const [assets, asset, shareDecimals, symbolMaybe] = await Promise.all([
      vault.convertToAssets(shares),
      vault.asset(),
      vault.decimals(),
      vault.symbol().catch(() => null),
    ]);
    // Resolve underlying asset decimals separately. Share-decimals usually
    // matches asset-decimals, but scaled ERC4626 vaults differ; using
    // share-decimals for the asset balance would mis-price downstream.
    let assetDecimalsResolved = Number(shareDecimals);
    try {
      const assetToken = await loadContract({
        chain,
        vaultAddress: asset,
        abi: ABI,
        _providerFactory,
        _chainConfigResolver,
        _ethersLoader,
      });
      const ad = await assetToken.decimals();
      assetDecimalsResolved = Number(ad);
    } catch {
      // fall back to share decimals if asset.decimals() unreadable
    }
    const fetchedAt = new Date(now).toISOString();
    const position = {
      positionId: defaultPositionId({ chain, protocolId, walletAddress, marketKey: vaultAddress.toLowerCase() }),
      opportunityId: opportunityId || null,
      strategyId: strategyId || null,
      walletAddress,
      bindingKind,
      protocolId,
      adapterId: "erc4626",
      chain,
      family,
      symbol: symbolMaybe || null,
      shareTokenAddress: vaultAddress,
      assetAddress: asset,
      underlyingTokenAddress: asset,
      shareBalance: shares.toString(),
      assetBalance: assets.toString(),
      assetDecimals: assetDecimalsResolved,
      shareDecimals: Number(shareDecimals),
      fetchedAt,
      observedAt: fetchedAt,
      ttlSec: 120,
    };
    return makeReaderResult({ positions: [position] });
  } catch (err) {
    return makeReaderError({ error: err && err.message ? err.message : String(err), code: "rpc_failed" });
  }
}

async function loadContract({ chain, vaultAddress, abi, _providerFactory, _chainConfigResolver, _ethersLoader }) {
  if (_providerFactory) {
    return _providerFactory({ chain, address: vaultAddress, abi });
  }
  const { ethers } = _ethersLoader ? await _ethersLoader() : await import("ethers");
  const { getEvmChainConfig } = await import("../../config/chains.mjs");
  const cfg = _chainConfigResolver ? _chainConfigResolver(chain) : getEvmChainConfig(chain);
  if (!cfg) throw new Error(`unknown chain ${chain}`);
  const rpcUrls = [
    ...new Set((Array.isArray(cfg.rpcUrls) && cfg.rpcUrls.length > 0 ? cfg.rpcUrls : [cfg.rpcUrl]).filter(Boolean)),
  ];
  if (rpcUrls.length === 0) throw new Error(`missing rpcUrl for chain ${chain}`);
  const contracts = rpcUrls.map((rpcUrl) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Contract(vaultAddress, abi, provider);
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

export const erc4626ReaderRegistration = {
  id: "erc4626",
  bindingKinds: [
    "erc4626_vault_supply_withdraw",
    "euler_evault_deposit_withdraw",
    "morpho_metamorpho_supply_withdraw",
    "yo_protocol_vault_deposit_withdraw",
  ],
  reader: readErc4626,
};
