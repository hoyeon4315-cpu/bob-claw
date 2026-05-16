// Aave V3 reader: aToken supply, debtToken borrow, healthFactor.

import { makeReaderError, makeReaderResult, defaultPositionId } from "../spec.mjs";

const POOL_ABI = [
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function getReserveData(address asset) view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)",
];
const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export async function readAaveV3({ chain, walletAddress, params = {}, now = new Date(), _providerFactory } = {}) {
  const {
    poolAddress,
    aTokenAddress: rawATokenAddress,
    underlyingTokenAddress: rawUnderlyingTokenAddress,
    variableDebtTokenAddress,
    opportunityId,
    strategyId,
    protocolId = "aave-v3",
    bindingKind = "aave_v3_supply_withdraw",
    marketLabel = params.marketName || rawATokenAddress,
  } = params;
  const aTokenAddress = rawATokenAddress || params.shareTokenAddress || params.vaultAddress;
  const underlyingTokenAddress = rawUnderlyingTokenAddress || params.assetAddress;
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
      positionId: defaultPositionId({ chain, protocolId, walletAddress, marketKey: String(marketLabel).toLowerCase() }),
      opportunityId: opportunityId || null,
      strategyId: strategyId || null,
      walletAddress,
      bindingKind,
      protocolId,
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

export function aaveRayToBps(value) {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round((numeric / 1e27) * 10_000 * 10_000) / 10_000;
}

export async function readAaveV3ReserveRates({
  chain,
  poolAddress,
  assetAddress,
  now = new Date(),
  _providerFactory,
} = {}) {
  if (!chain || !poolAddress || !assetAddress) {
    return makeReaderError({ error: "missing chain/poolAddress/assetAddress", code: "missing_params" });
  }
  try {
    const pool = await loadContract({ chain, address: poolAddress, abi: POOL_ABI, _providerFactory });
    const reserve = await pool.getReserveData(assetAddress);
    const currentLiquidityRate = reserve?.currentLiquidityRate ?? reserve?.[2] ?? null;
    const currentVariableBorrowRate = reserve?.currentVariableBorrowRate ?? reserve?.[4] ?? null;
    const observedAt = new Date(now).toISOString();
    return Object.freeze({
      ok: true,
      chain,
      poolAddress,
      assetAddress,
      observedAt,
      supplyAprBps: aaveRayToBps(currentLiquidityRate),
      variableBorrowAprBps: aaveRayToBps(currentVariableBorrowRate),
      currentLiquidityRate: currentLiquidityRate == null ? null : currentLiquidityRate.toString(),
      currentVariableBorrowRate: currentVariableBorrowRate == null ? null : currentVariableBorrowRate.toString(),
    });
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

export const aaveV3ReaderRegistration = {
  id: "aave-v3",
  bindingKinds: ["aave_v3_supply_withdraw", "aave_v3_pool_supply_withdraw", "aave_v3_borrow_repay"],
  reader: readAaveV3,
};
