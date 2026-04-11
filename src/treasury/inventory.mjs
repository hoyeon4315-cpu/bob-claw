import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
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

export function buildTreasuryInventory({ policy, address, nativeBalances = {}, tokenBalances = {}, allowances = {}, prices = null, observedAt }) {
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
      rpcUrl: tokenBalances[key]?.rpcUrl || null,
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
      estimatedWalletUsd: [...native, ...tokens]
        .map((item) => item.estimatedUsd)
        .filter(Number.isFinite)
        .reduce((sum, value) => sum + value, 0),
    },
  };
}

export async function scanTreasuryInventory({ policy, address, prices = null, fetchImpl = fetch }) {
  const supportedChains = listSupportedChains(policy);
  const tokenItems = policy.tokenInventories || [];
  const allowanceItems = policy.allowanceCaps || [];

  const nativeEntries = await Promise.all(
    supportedChains.map(async (chain) => [chain, await readNativeBalance(chain, address, { fetchImpl })]),
  );
  const tokenEntries = await Promise.all(
    tokenItems.map(async (item) => [
      `${item.chain}:${normalizedAddress(item.token)}`,
      await readErc20Balance(item.chain, item.token, address, { fetchImpl }),
    ]),
  );
  const allowanceEntries = await Promise.all(
    allowanceItems.map(async (item) => [
      `${item.chain}:${normalizedAddress(item.token)}:${normalizedAddress(item.spender)}`,
      await readErc20Allowance(item.chain, item.token, address, item.spender, { fetchImpl }),
    ]),
  );

  return buildTreasuryInventory({
    policy,
    address,
    nativeBalances: Object.fromEntries(nativeEntries),
    tokenBalances: Object.fromEntries(tokenEntries),
    allowances: Object.fromEntries(allowanceEntries),
    prices,
  });
}
