import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { getChainRpcUrls } from "../config/env.mjs";
import { EVM_CHAINS } from "../chains/registry.mjs";
import { readErc20Allowance, readErc20Balance, readNativeBalance } from "../evm/account-state.mjs";
import {
  decimalToUnits,
  getAllowanceCapPolicy,
  getNativeBalancePolicy,
  getTokenInventoryPolicy,
  listSupportedChains,
} from "./policy.mjs";

function normalizedAddress(value) {
  return String(value || "").toLowerCase();
}

function bigint(value) {
  return BigInt(value || 0);
}

function priceForAsset(chain, token, prices) {
  const asset = tokenAsset(chain, token);
  if (asset.isNative) return prices?.nativeByChain?.[chain] ?? null;
  if (asset.priceKey === "btc") return prices?.btc ?? prices?.tokenByKey?.btc ?? null;
  return prices?.tokenByKey?.[asset.priceKey] ?? prices?.nativeByChain?.[asset.priceKey] ?? null;
}

function bandStatus({ actual, min, target, max, active, enabled }) {
  if (!enabled) {
    return actual > 0n ? "observe_only_balance_present" : "inactive";
  }
  if (actual > max) return active ? "over_max_active" : "over_max_supported";
  if (actual < min) return active ? "refill_required" : "observe_only_low";
  if (actual < target) return active ? "below_target" : "supported_buffered";
  return active ? "ready" : "supported_ready";
}

function allowanceStatus({ actual, maxApproval }) {
  if (actual > maxApproval) return "over_cap";
  if (actual === 0n) return "zero";
  return "capped";
}

function usdValueFromUnits(value, decimals, priceUsd) {
  const amount = unitsToDecimal(value, decimals);
  if (!Number.isFinite(amount) || !Number.isFinite(priceUsd)) return null;
  return amount * priceUsd;
}

function chainConfig(chain) {
  return {
    ...EVM_CHAINS[chain],
    rpcUrls: getChainRpcUrls(chain, EVM_CHAINS[chain]?.rpcUrls || [EVM_CHAINS[chain]?.rpcUrl].filter(Boolean)),
  };
}

function errorSummary(error) {
  if (!error) return null;
  return {
    name: error.name || "Error",
    message: error.message || String(error),
  };
}

function fallbackNativeBalance(fallbackInventory, chain) {
  const item = fallbackInventory?.native?.find((entry) => entry.chain === chain);
  return item ? { balanceWei: item.actual || "0", rpcUrl: item.rpcUrl || null, staleFallback: true } : null;
}

function fallbackTokenBalance(fallbackInventory, chain, token) {
  const key = normalizedAddress(token);
  const item = fallbackInventory?.tokens?.find((entry) => entry.chain === chain && normalizedAddress(entry.token) === key);
  return item ? { balance: item.actual || "0", rpcUrl: item.rpcUrl || null, staleFallback: true } : null;
}

function fallbackAllowance(fallbackInventory, chain, token, spender) {
  const tokenKey = normalizedAddress(token);
  const spenderKey = normalizedAddress(spender);
  const item = fallbackInventory?.allowances?.find(
    (entry) => entry.chain === chain && normalizedAddress(entry.token) === tokenKey && normalizedAddress(entry.spender) === spenderKey,
  );
  return item ? { allowance: item.actual || "0", rpcUrl: item.rpcUrl || null, staleFallback: true } : null;
}

async function readInventoryItem({ label, read, fallback, continueOnError, scanErrors }) {
  try {
    return await read();
  } catch (error) {
    if (!continueOnError) throw error;
    const summary = errorSummary(error);
    scanErrors.push({ label, ...summary });
    return {
      ...(fallback || {}),
      rpcUrl: fallback?.rpcUrl || null,
      staleFallback: Boolean(fallback),
      scanError: summary,
    };
  }
}

export function buildTreasuryInventory({
  policy,
  address,
  nativeBalances = {},
  tokenBalances = {},
  allowances = {},
  prices = null,
  observedAt,
  scanErrors = [],
}) {
  const activeChains = new Set(policy.activeChains || []);
  const native = listSupportedChains(policy).map((chain) => {
    const item = getNativeBalancePolicy(policy, chain);
    const actual = bigint(nativeBalances[chain]?.balanceWei);
    const min = decimalToUnits(item.minBalance, item.decimals);
    const target = decimalToUnits(item.targetBalance, item.decimals);
    const max = decimalToUnits(item.maxBalance, item.decimals);
    const priceUsd = priceForAsset(chain, item.token, prices);
    const status = bandStatus({
      actual,
      min,
      target,
      max,
      active: activeChains.has(chain),
      enabled: item.enabled,
    });
    const refillToTarget = actual < target ? target - actual : 0n;
    return {
      chain,
      enabled: item.enabled,
      active: activeChains.has(chain),
      asset: item.asset,
      token: item.token,
      actual: actual.toString(),
      actualDecimal: unitsToDecimal(actual, item.decimals),
      minBalance: min.toString(),
      minBalanceDecimal: Number(item.minBalance),
      targetBalance: target.toString(),
      targetBalanceDecimal: Number(item.targetBalance),
      maxBalance: max.toString(),
      maxBalanceDecimal: Number(item.maxBalance),
      refillToTarget: refillToTarget.toString(),
      refillToTargetDecimal: unitsToDecimal(refillToTarget, item.decimals),
      priceUsd,
      estimatedUsd: usdValueFromUnits(actual, item.decimals, priceUsd),
      status,
      rationale: item.rationale,
      rpcUrl: nativeBalances[chain]?.rpcUrl || null,
      staleFallback: Boolean(nativeBalances[chain]?.staleFallback),
      scanError: nativeBalances[chain]?.scanError || null,
    };
  });

  const tokens = (policy.tokenInventories || []).map((item) => {
    const key = `${item.chain}:${normalizedAddress(item.token)}`;
    const actual = bigint(tokenBalances[key]?.balance);
    const min = decimalToUnits(item.minBalance, item.decimals);
    const target = decimalToUnits(item.targetBalance, item.decimals);
    const max = decimalToUnits(item.maxBalance, item.decimals);
    const priceUsd = priceForAsset(item.chain, item.token, prices);
    const status = bandStatus({
      actual,
      min,
      target,
      max,
      active: activeChains.has(item.chain),
      enabled: item.enabled,
    });
    const refillToTarget = actual < target ? target - actual : 0n;
    return {
      chain: item.chain,
      enabled: item.enabled,
      active: activeChains.has(item.chain),
      token: item.token,
      ticker: item.ticker,
      actual: actual.toString(),
      actualDecimal: unitsToDecimal(actual, item.decimals),
      minBalance: min.toString(),
      minBalanceDecimal: Number(item.minBalance),
      targetBalance: target.toString(),
      targetBalanceDecimal: Number(item.targetBalance),
      maxBalance: max.toString(),
      maxBalanceDecimal: Number(item.maxBalance),
      refillToTarget: refillToTarget.toString(),
      refillToTargetDecimal: unitsToDecimal(refillToTarget, item.decimals),
      priceUsd,
      estimatedUsd: usdValueFromUnits(actual, item.decimals, priceUsd),
      status,
      rationale: item.rationale,
      strategyPolicy: item.strategyPolicy || null,
      rpcUrl: tokenBalances[key]?.rpcUrl || null,
      staleFallback: Boolean(tokenBalances[key]?.staleFallback),
      scanError: tokenBalances[key]?.scanError || null,
    };
  });

  const allowanceItems = (policy.allowanceCaps || []).map((item) => {
    const key = `${item.chain}:${normalizedAddress(item.token)}:${normalizedAddress(item.spender)}`;
    const actual = bigint(allowances[key]?.allowance);
    const asset = tokenAsset(item.chain, item.token);
    const maxApproval = decimalToUnits(item.maxApproval, asset.decimals);
    return {
      chain: item.chain,
      token: item.token,
      ticker: asset.ticker,
      spender: item.spender,
      mode: item.mode,
      actual: actual.toString(),
      actualDecimal: unitsToDecimal(actual, asset.decimals),
      maxApproval: maxApproval.toString(),
      maxApprovalDecimal: Number(item.maxApproval),
      status: allowanceStatus({ actual, maxApproval }),
      rationale: item.rationale,
      rpcUrl: allowances[key]?.rpcUrl || null,
      staleFallback: Boolean(allowances[key]?.staleFallback),
      scanError: allowances[key]?.scanError || null,
    };
  });

  return {
    schemaVersion: 1,
    observedAt: observedAt || new Date().toISOString(),
    address,
    supportedChains: listSupportedChains(policy),
    activeChains: [...activeChains],
    native,
    tokens,
    allowances: allowanceItems,
    summary: {
      activeChainCount: activeChains.size,
      supportedChainCount: listSupportedChains(policy).length,
      nativeRefillRequiredCount: native.filter((item) => item.status === "refill_required").length,
      tokenRefillRequiredCount: tokens.filter((item) => item.status === "refill_required").length,
      overMaxCount:
        native.filter((item) => item.status.startsWith("over_max")).length +
        tokens.filter((item) => item.status.startsWith("over_max")).length,
      allowanceOverCapCount: allowanceItems.filter((item) => item.status === "over_cap").length,
      scanErrorCount: scanErrors.length,
      estimatedWalletUsd: [...native, ...tokens]
        .map((item) => item.estimatedUsd)
        .filter(Number.isFinite)
        .reduce((sum, value) => sum + value, 0),
    },
    scanErrors,
  };
}

export async function scanTreasuryInventory({ policy, address, prices = null, fetchImpl = fetch, continueOnError = false, fallbackInventory = null }) {
  const supportedChains = listSupportedChains(policy);
  const tokenItems = policy.tokenInventories || [];
  const allowanceItems = policy.allowanceCaps || [];
  const scanErrors = [];

  const nativeEntries = await Promise.all(
    supportedChains.map(async (chain) => [
      chain,
      await readInventoryItem({
        label: `native:${chain}`,
        continueOnError,
        scanErrors,
        fallback: fallbackNativeBalance(fallbackInventory, chain),
        read: () => readNativeBalance(chain, address, { fetchImpl, chainConfig: chainConfig(chain) }),
      }),
    ]),
  );
  const tokenEntries = await Promise.all(
    tokenItems.map(async (item) => [
      `${item.chain}:${normalizedAddress(item.token)}`,
      await readInventoryItem({
        label: `token:${item.chain}:${normalizedAddress(item.token)}`,
        continueOnError,
        scanErrors,
        fallback: fallbackTokenBalance(fallbackInventory, item.chain, item.token),
        read: () => readErc20Balance(item.chain, item.token, address, { fetchImpl, chainConfig: chainConfig(item.chain) }),
      }),
    ]),
  );
  const allowanceEntries = await Promise.all(
    allowanceItems.map(async (item) => [
      `${item.chain}:${normalizedAddress(item.token)}:${normalizedAddress(item.spender)}`,
      await readInventoryItem({
        label: `allowance:${item.chain}:${normalizedAddress(item.token)}:${normalizedAddress(item.spender)}`,
        continueOnError,
        scanErrors,
        fallback: fallbackAllowance(fallbackInventory, item.chain, item.token, item.spender),
        read: () => readErc20Allowance(item.chain, item.token, address, item.spender, {
          fetchImpl,
          chainConfig: chainConfig(item.chain),
        }),
      }),
    ]),
  );

  return buildTreasuryInventory({
    policy,
    address,
    nativeBalances: Object.fromEntries(nativeEntries),
    tokenBalances: Object.fromEntries(tokenEntries),
    allowances: Object.fromEntries(allowanceEntries),
    prices,
    scanErrors,
  });
}
