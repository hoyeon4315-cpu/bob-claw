import { EVM_CHAINS } from "../chains/registry.mjs";
import { readBitcoinAddressBalance } from "../executor/helpers/settlement-proof.mjs";
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

function bitcoinRecord(bitcoinAddress, bitcoinBalance, prices) {
  const asset = tokenAsset("bitcoin", ZERO_TOKEN);
  const balanceSats = BigInt(bitcoinBalance.balanceSats);
  const actualDecimal = unitsToDecimal(balanceSats, asset.decimals);
  const estimatedUsd = Number.isFinite(actualDecimal) ? actualDecimal * (priceForAssetUsd(asset, prices) ?? NaN) : null;
  return {
    chain: "bitcoin",
    ticker: asset.ticker,
    family: asset.family,
    token: ZERO_TOKEN,
    balance: balanceSats.toString(),
    actualDecimal,
    estimatedUsd: Number.isFinite(estimatedUsd) ? estimatedUsd : null,
    rpcUrl: bitcoinBalance.source || null,
    address: bitcoinAddress,
    confirmedBalanceSats: bitcoinBalance.confirmedBalanceSats ?? null,
    mempoolBalanceSats: bitcoinBalance.mempoolBalanceSats ?? null,
  };
}

function externalUnclassifiedRecord({ provider, walletUsd }, missingUsd) {
  return {
    chain: null,
    ticker: "OTHER",
    family: "external_unclassified",
    token: null,
    balance: "0",
    actualDecimal: 0,
    estimatedUsd: missingUsd,
    rpcUrl: null,
    source: `${provider || "external"}_wallet_portfolio`,
    note: `External wallet scan reports ${walletUsd} USD for wallet balances.`,
  };
}

export function buildWholeWalletInventory({
  address,
  bitcoinAddress = null,
  nativeBalances = {},
  tokenBalances = {},
  bitcoinBalance = null,
  scanErrors: extraScanErrors = [],
  prices = null,
  chains = Object.keys(EVM_CHAINS),
  externalPortfolio = null,
  observedAt,
} = {}) {
  const native = [];
  const tokenEntries = [];
  const scanErrors = [...(extraScanErrors || [])];

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

  if (bitcoinAddress && Number(bitcoinBalance?.balanceSats || 0) > 0) {
    native.push(bitcoinRecord(bitcoinAddress, bitcoinBalance, prices));
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

  const localTotalUsd = [...native, ...tokenEntries]
    .map((item) => item.estimatedUsd)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const augmentedTokenBalances = [...tokenEntries];
  let externalUnclassifiedUsd = null;
  if (Number.isFinite(externalPortfolio?.walletUsd) && externalPortfolio.walletUsd > localTotalUsd + 0.01) {
    externalUnclassifiedUsd = externalPortfolio.walletUsd - localTotalUsd;
    augmentedTokenBalances.push(externalUnclassifiedRecord(externalPortfolio, externalUnclassifiedUsd));
  }
  const holdings = [...native, ...augmentedTokenBalances];
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
    tokenBalances: augmentedTokenBalances.sort((left, right) => (right.estimatedUsd ?? -1) - (left.estimatedUsd ?? -1)),
    scanErrors,
    summary: {
      chainCount: new Set(holdings.map((item) => item.chain)).size,
      nativeCount: native.length,
      tokenCount: augmentedTokenBalances.length,
      scanErrorCount: scanErrors.length,
      itemizedWalletUsd: localTotalUsd,
      externalWalletUsd: externalPortfolio?.walletUsd ?? null,
      externalTotalPortfolioUsd: externalPortfolio?.totalPortfolioUsd ?? null,
      externalUnclassifiedUsd,
      externalProvider: externalPortfolio?.provider || null,
    },
    source: externalPortfolio ? "live_scan_with_external_portfolio" : "live_scan",
  };
}

export async function scanWholeWalletInventory({
  address,
  bitcoinAddress = null,
  prices = null,
  chains = Object.keys(EVM_CHAINS),
  families = null,
  fetchImpl = fetch,
  bitcoinBalanceReader = readBitcoinAddressBalance,
  externalPortfolioReader = null,
} = {}) {
  const targets = knownWholeWalletTokenTargets({ families });
  const scanErrors = [];

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

  let bitcoinBalance = null;
  if (bitcoinAddress) {
    try {
      const result = await bitcoinBalanceReader({ address: bitcoinAddress });
      bitcoinBalance = {
        balanceSats: result.balance.toString(),
        confirmedBalanceSats: result.confirmedBalance.toString(),
        mempoolBalanceSats: result.mempoolBalance.toString(),
        source: result.source || null,
      };
    } catch (error) {
      scanErrors.push({
        kind: "native",
        chain: "bitcoin",
        message: error.message,
      });
    }
  }

  let externalPortfolio = null;
  if (typeof externalPortfolioReader === "function") {
    try {
      externalPortfolio = await externalPortfolioReader({ address, fetchImpl });
    } catch (error) {
      scanErrors.push({
        kind: "external_portfolio",
        provider: "zerion",
        message: error.message,
      });
    }
  }

  return buildWholeWalletInventory({
    address,
    bitcoinAddress,
    nativeBalances: Object.fromEntries(nativeEntries),
    tokenBalances: tokenEntries,
    bitcoinBalance,
    scanErrors,
    prices,
    chains,
    externalPortfolio,
  });
}

export function latestWholeWalletInventoryForAddress(records = [], address) {
  return [...(records || [])]
    .filter((item) => normalized(item?.address) === normalized(address))
    .sort((left, right) => new Date(right?.observedAt || 0) - new Date(left?.observedAt || 0))[0] || null;
}
