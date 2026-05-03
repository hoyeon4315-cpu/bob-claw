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

export async function readErc4626({ chain, walletAddress, params = {}, now = new Date(), _providerFactory } = {}) {
  const { vaultAddress, protocolId = "erc4626", bindingKind = "erc4626_vault_supply_withdraw", family = "vault_share", opportunityId, strategyId } = params;
  if (!chain || !walletAddress || !vaultAddress) {
    return makeReaderError({ error: "missing chain/walletAddress/vaultAddress", code: "missing_params" });
  }
  try {
    const vault = await loadContract({ chain, vaultAddress, abi: ABI, _providerFactory });
    const shares = await vault.balanceOf(walletAddress);
    if (shares === 0n) {
      return makeReaderResult({ positions: [], notes: ["zero_shares"] });
    }
    const [assets, asset, decimals, symbolMaybe] = await Promise.all([
      vault.convertToAssets(shares),
      vault.asset(),
      vault.decimals(),
      vault.symbol().catch(() => null),
    ]);
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
      assetDecimals: Number(decimals),
      fetchedAt,
      observedAt: fetchedAt,
      ttlSec: 120,
    };
    return makeReaderResult({ positions: [position] });
  } catch (err) {
    return makeReaderError({ error: err && err.message ? err.message : String(err), code: "rpc_failed" });
  }
}

async function loadContract({ chain, vaultAddress, abi, _providerFactory }) {
  if (_providerFactory) {
    return _providerFactory({ chain, address: vaultAddress, abi });
  }
  const { ethers } = await import("ethers");
  const { EVM_CHAIN_CONFIGS } = await import("../../config/chains.mjs");
  const cfg = EVM_CHAIN_CONFIGS[chain];
  if (!cfg) throw new Error(`unknown chain ${chain}`);
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  return new ethers.Contract(vaultAddress, abi, provider);
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
