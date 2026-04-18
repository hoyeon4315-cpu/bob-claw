import { EVM_CHAINS } from "../chains/registry.mjs";
import { readErc20Balance, readNativeBalance } from "../evm/account-state.mjs";
import { priceForAssetUsd } from "../market/prices.mjs";
import { ZERO_TOKEN, listKnownTokenDefinitions, tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";

function normalized(value) {
  return String(value || "").toLowerCase();
}

function familyFilterSet(families = null) {
  return Array.isArray(families) && families.length > 0 ? new Set(families.map((item) => String(item || "").trim()).filter(Boolean)) : null;
}

function familyPriority(family) {
  if (family === "wrapped_btc") return 0;
  if (family === "stablecoin") return 1;
  if (family === "native_or_wrapped") return 2;
  return 3;
}

export function knownWholeWalletTokenTargets({ families = null } = {}) {
  const allowedFamilies = familyFilterSet(families);
  return listKnownTokenDefinitions()
    .filter((item) => (allowedFamilies ? allowedFamilies.has(item.family) : true))
    .sort(
      (left, right) =>
        familyPriority(left.family) - familyPriority(right.family) ||
        String(left.ticker).localeCompare(String(right.ticker)) ||
        String(left.token).localeCompare(String(right.token)),
    );
}

function nativeRecord(chain, balanceWei, prices, rpcUrl) {
  const asset = tokenAsset(chain, ZERO_TOKEN);
  const actualDecimal = unitsToDecimal(balanceWei, asset.decimals);
  const estimatedUsd = Number.isFinite(actualDecimal) ? actualDecimal * (priceForAssetUsd(asset, prices) ?? NaN) : null;
  return {
    chain,
    ticker: asset.ticker,
    family: asset.family,
    token: ZERO_TOKEN,
    balance: balanceWei.toString(),
    actualDecimal,
    estimatedUsd: Number.isFinite(estimatedUsd) ? estimatedUsd : null,
    rpcUrl: rpcUrl || null,
  };
}

function tokenRecord(chain, token, balance, prices, rpcUrl) {
  const asset = tokenAsset(chain, token);
  const actualDecimal = unitsToDecimal(balance, asset.decimals ?? 18);
  const estimatedUsd = Number.isFinite(actualDecimal) ? actualDecimal * (priceForAssetUsd(asset, prices) ?? NaN) : null;
  return {
    chain,
    token,
    ticker: asset.ticker,
    family: asset.family,
    balance: balance.toString(),
    actualDecimal,
    estimatedUsd: Number.isFinite(estimatedUsd) ? estimatedUsd : null,
    rpcUrl: rpcUrl || null,
  };
}

export function buildWholeWalletInventory({
  address,
  nativeBalances = {},
  tokenBalances = {},
  prices = null,
  chains = Object.keys(EVM_CHAINS),
  observedAt,
} = {}) {
  const native = [];
  const tokenEntries = [];
  const scanErrors = [];

  for (const chain of chains) {
    const nativeState = nativeBalances[chain];
    if (nativeState?.error) {
      scanErrors.push({ kind: "native", chain, message: nativeState.error });
      continue;
    }
    if (nativeState?.balanceWei && BigInt(nativeState.balanceWei) > 0n) {
      native.push(nativeRecord(chain, BigInt(nativeState.balanceWei), prices, nativeState.rpcUrl));
    }
  }

  for (const entry of tokenBalances) {
    if (entry?.error) {
      scanErrors.push({
        kind: "token",
        chain: entry.chain,
        token: entry.token,
        message: entry.error,
      });
      continue;
    }
    if (entry?.balance && BigInt(entry.balance) > 0n) {
      tokenEntries.push(tokenRecord(entry.chain, entry.token, BigInt(entry.balance), prices, entry.rpcUrl));
    }
  }

  const holdings = [...native, ...tokenEntries];
  const totalUsd = holdings
    .map((item) => item.estimatedUsd)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);

  return {
    schemaVersion: 1,
    observedAt: observedAt || new Date().toISOString(),
    address,
    totalUsd,
    native: native.sort((left, right) => (right.estimatedUsd ?? -1) - (left.estimatedUsd ?? -1)),
    tokenBalances: tokenEntries.sort((left, right) => (right.estimatedUsd ?? -1) - (left.estimatedUsd ?? -1)),
    scanErrors,
    summary: {
      chainCount: new Set(holdings.map((item) => item.chain)).size,
      nativeCount: native.length,
      tokenCount: tokenEntries.length,
      scanErrorCount: scanErrors.length,
    },
  };
}

export async function scanWholeWalletInventory({
  address,
  prices = null,
  chains = Object.keys(EVM_CHAINS),
  families = null,
  fetchImpl = fetch,
} = {}) {
  const targets = knownWholeWalletTokenTargets({ families });

  const nativeEntries = [];
  for (const chain of chains) {
    try {
      const result = await readNativeBalance(chain, address, { fetchImpl });
      nativeEntries.push([chain, { balanceWei: result.balanceWei.toString(), rpcUrl: result.rpcUrl || null }]);
    } catch (error) {
      nativeEntries.push([chain, { error: error.message }]);
    }
  }

  const tokenEntries = [];
  for (const chain of chains) {
    for (const target of targets) {
      try {
        const result = await readErc20Balance(chain, target.token, address, { fetchImpl });
        if (result.balance > 0n) {
          tokenEntries.push({
            chain,
            token: target.token,
            balance: result.balance.toString(),
            rpcUrl: result.rpcUrl || null,
          });
        }
      } catch (error) {
        tokenEntries.push({
          chain,
          token: target.token,
          error: error.message,
        });
      }
    }
  }

  return buildWholeWalletInventory({
    address,
    nativeBalances: Object.fromEntries(nativeEntries),
    tokenBalances: tokenEntries,
    prices,
    chains,
  });
}

export function latestWholeWalletInventoryForAddress(records = [], address) {
  return [...(records || [])]
    .filter((item) => normalized(item?.address) === normalized(address))
    .sort((left, right) => new Date(right?.observedAt || 0) - new Date(left?.observedAt || 0))[0] || null;
}
