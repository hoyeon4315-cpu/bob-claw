import { EVM_CHAINS } from "../chains/registry.mjs";
import { readBitcoinAddressBalance } from "../executor/helpers/settlement-proof.mjs";
import { readErc20Balance, readNativeBalance } from "../evm/account-state.mjs";
import { priceForAssetUsd } from "../market/prices.mjs";
import {
  ETHEREUM_WBTC_TOKEN,
  SOLVBTC_TOKEN,
  UNI_BTC_TOKEN,
  WBTC_OFT_TOKEN,
  WRAPPED_NATIVE_TOKENS,
  ZERO_TOKEN,
  listKnownTokenDefinitions,
  tokenAsset,
  unitsToDecimal,
} from "../assets/tokens.mjs";

function normalized(value) {
  return String(value || "").toLowerCase();
}

const TOKEN_TARGET_CHAINS = Object.freeze({
  [normalized(WBTC_OFT_TOKEN)]: Object.freeze(Object.keys(EVM_CHAINS).filter((chain) => chain !== "ethereum")),
  [normalized(ETHEREUM_WBTC_TOKEN)]: Object.freeze(["ethereum"]),
  [normalized(UNI_BTC_TOKEN)]: Object.freeze(["bob"]),
  [normalized(SOLVBTC_TOKEN)]: Object.freeze(["base"]),
  [normalized("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf")]: Object.freeze(["base"]),
  [normalized("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")]: Object.freeze(["base"]),
  [normalized("0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189")]: Object.freeze(["bob"]),
  [normalized("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E")]: Object.freeze(["avalanche"]),
  [normalized("0x29219dd400f2Bf60E5a23d13Be72B486D4038894")]: Object.freeze(["sonic"]),
  [normalized("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")]: Object.freeze(["ethereum"]),
  [normalized("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")]: Object.freeze(["optimism"]),
  [normalized("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d")]: Object.freeze(["bsc"]),
  [normalized("0x078D782b760474a361dDA0AF3839290b0EF57AD6")]: Object.freeze(["unichain"]),
  [normalized("0x55d398326f99059fF775485246999027B3197955")]: Object.freeze(["bsc"]),
  [normalized("0xdAC17F958D2ee523a2206206994597C13D831ec7")]: Object.freeze(["ethereum"]),
  [normalized("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD")]: Object.freeze(["ethereum"]),
  [normalized(WRAPPED_NATIVE_TOKENS.avalanche)]: Object.freeze(["avalanche"]),
  [normalized(WRAPPED_NATIVE_TOKENS.base)]: Object.freeze(["base", "bob", "optimism", "soneium", "unichain"]),
  [normalized(WRAPPED_NATIVE_TOKENS.bera)]: Object.freeze(["bera"]),
  [normalized(WRAPPED_NATIVE_TOKENS.bsc)]: Object.freeze(["bsc"]),
  [normalized(WRAPPED_NATIVE_TOKENS.ethereum)]: Object.freeze(["ethereum"]),
  [normalized(WRAPPED_NATIVE_TOKENS.sonic)]: Object.freeze(["sonic"]),
  [normalized("0x2170Ed0880ac9A755fd29B2688956BD959F933F8")]: Object.freeze(["bsc"]),
  [normalized("0x45804880De22913dAFE09f4980848ECE6EcbAf78")]: Object.freeze(["ethereum"]),
  [normalized("0x68749665FF8D2d112Fa859AA293F07A622782F38")]: Object.freeze(["ethereum"]),
});

function familyFilterSet(families = null) {
  return Array.isArray(families) && families.length > 0 ? new Set(families.map((item) => String(item || "").trim()).filter(Boolean)) : null;
}

function familyPriority(family) {
  if (family === "wrapped_btc") return 0;
  if (family === "stablecoin") return 1;
  if (family === "native_or_wrapped") return 2;
  return 3;
}

function tokenTargetAppliesToChain(target, chain = null) {
  if (!chain) return true;
  const targetChains = TOKEN_TARGET_CHAINS[normalized(target?.token)];
  return !targetChains || targetChains.includes(chain);
}

export function knownWholeWalletTokenTargets({ families = null, chain = null } = {}) {
  const allowedFamilies = familyFilterSet(families);
  return listKnownTokenDefinitions()
    .filter((item) => (allowedFamilies ? allowedFamilies.has(item.family) : true))
    .filter((item) => tokenTargetAppliesToChain(item, chain))
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

function tokenBalanceKey(entry) {
  const chain = normalized(entry?.chain);
  const token = normalized(entry?.token);
  return chain && token ? `${chain}:${token}` : null;
}

function balanceBigInt(entry) {
  if (!entry?.balance) return null;
  try {
    return BigInt(entry.balance);
  } catch {
    return null;
  }
}

function preferredTokenBalanceEntry(left, right) {
  const leftBalance = balanceBigInt(left);
  const rightBalance = balanceBigInt(right);
  if (rightBalance != null) {
    if (leftBalance == null || rightBalance > leftBalance) return right;
    return left;
  }
  return leftBalance != null ? left : left || right;
}

function dedupeTokenBalanceInputs(tokenBalances = []) {
  const keyed = new Map();
  const unkeyed = [];
  for (const entry of tokenBalances || []) {
    const key = tokenBalanceKey(entry);
    if (!key) {
      unkeyed.push(entry);
      continue;
    }
    keyed.set(key, preferredTokenBalanceEntry(keyed.get(key), entry));
  }
  return [...keyed.values(), ...unkeyed];
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

  for (const entry of dedupeTokenBalanceInputs(tokenBalances)) {
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
  let externalUnclassifiedUsd = null;
  if (Number.isFinite(externalPortfolio?.walletUsd) && externalPortfolio.walletUsd > localTotalUsd + 0.01) {
    externalUnclassifiedUsd = externalPortfolio.walletUsd - localTotalUsd;
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
      itemizedWalletUsd: localTotalUsd,
      externalWalletUsd: externalPortfolio?.walletUsd ?? null,
      externalTotalPortfolioUsd: externalPortfolio?.totalPortfolioUsd ?? null,
      externalUnclassifiedUsd,
      externalProvider: externalPortfolio?.provider || null,
    },
    source: externalPortfolio ? "live_scan_with_external_reference" : "live_scan",
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
    const targets = knownWholeWalletTokenTargets({ families, chain });
    const seenTokensForChain = new Set();
    for (const target of targets) {
      const tokenKey = normalized(target.token);
      if (seenTokensForChain.has(tokenKey)) continue;
      seenTokensForChain.add(tokenKey);
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
