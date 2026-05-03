// Aave V3 reader: aToken supply, debtToken borrow, healthFactor.

import { makeReaderError, makeReaderResult, defaultPositionId } from "../spec.mjs";

const POOL_ABI = [
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
];
const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export async function readAaveV3({ chain, walletAddress, params = {}, now = new Date(), _providerFactory } = {}) {
  const {
    poolAddress,
    aTokenAddress,
    underlyingTokenAddress,
    variableDebtTokenAddress,
    opportunityId,
    strategyId,
    marketLabel = aTokenAddress,
  } = params;
  if (!chain || !walletAddress || !poolAddress || !aTokenAddress) {
    return makeReaderError({ error: "missing chain/walletAddress/poolAddress/aTokenAddress", code: "missing_params" });
  }
  try {
    const [pool, aToken, debtToken] = await Promise.all([
      loadContract({ chain, address: poolAddress, abi: POOL_ABI, _providerFactory }),
      loadContract({ chain, address: aTokenAddress, abi: TOKEN_ABI, _providerFactory }),
      variableDebtTokenAddress
        ? loadContract({ chain, address: variableDebtTokenAddress, abi: TOKEN_ABI, _providerFactory })
        : null,
    ]);
    const [aBal, dBal, decimals, symbolMaybe, account] = await Promise.all([
      aToken.balanceOf(walletAddress),
      debtToken ? debtToken.balanceOf(walletAddress) : Promise.resolve(0n),
      aToken.decimals(),
      aToken.symbol().catch(() => null),
      pool.getUserAccountData(walletAddress),
    ]);
    if (aBal === 0n && dBal === 0n) {
      return makeReaderResult({ positions: [], notes: ["zero_balance"] });
    }
    const fetchedAt = new Date(now).toISOString();
    const healthFactorRaw = account?.healthFactor ?? account?.[5];
    const ltvRaw = account?.ltv ?? account?.[4];
    const liqRaw = account?.currentLiquidationThreshold ?? account?.[3];
    const hf = healthFactorRaw && healthFactorRaw > 0n ? Number(healthFactorRaw) / 1e18 : null;
    const ltv = ltvRaw !== undefined && ltvRaw !== null ? Number(ltvRaw) / 1e4 : null;
    const liqThreshold = liqRaw !== undefined && liqRaw !== null ? Number(liqRaw) / 1e4 : null;
    const position = {
      positionId: defaultPositionId({ chain, protocolId: "aave-v3", walletAddress, marketKey: String(marketLabel).toLowerCase() }),
      opportunityId: opportunityId || null,
      strategyId: strategyId || null,
      walletAddress,
      bindingKind: "aave_v3_supply_withdraw",
      protocolId: "aave-v3",
      adapterId: "aave-v3",
      chain,
      family: "lending_loop",
      symbol: symbolMaybe || null,
      shareTokenAddress: aTokenAddress,
      assetAddress: underlyingTokenAddress || null,
      underlyingTokenAddress: underlyingTokenAddress || null,
      shareBalance: aBal.toString(),
      assetBalance: aBal.toString(),
      debtBalance: dBal.toString(),
      assetDecimals: Number(decimals),
      healthFactor: hf,
      ltv,
      liquidationThreshold: liqThreshold,
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
  const { EVM_CHAIN_CONFIGS } = await import("../../../config/chains.mjs");
  const cfg = EVM_CHAIN_CONFIGS[chain];
  if (!cfg) throw new Error(`unknown chain ${chain}`);
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  return new ethers.Contract(address, abi, provider);
}

export const aaveV3ReaderRegistration = {
  id: "aave-v3",
  bindingKinds: ["aave_v3_supply_withdraw", "aave_v3_borrow_repay"],
  reader: readAaveV3,
};
