import { EVM_CHAINS } from "../chains/registry.mjs";
import { readBitcoinAddressBalance } from "../executor/helpers/settlement-proof.mjs";
import { readErc20Balance, readErc20Metadata, readErc4626SharePreview, readNativeBalance } from "../evm/account-state.mjs";
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
import { bootstrapReaders } from "../protocol-readers/bootstrap.mjs";
import { dispatchPosition } from "../protocol-readers/dispatch.mjs";
import { assetUniverseTokenTargets } from "./asset-universe.mjs";

// Side-effect: ensure protocol readers are registered before any inventory
// scan runs. bootstrapReaders is idempotent (guarded by _bootstrapped).
bootstrapReaders();

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

function stablePriceMetadata(symbol = "") {
  const normalized = String(symbol || "").toUpperCase();
  if (["USDC", "USDT", "RLUSD", "USDC.E"].includes(normalized) || /(?:USDC|USDT|RLUSD)/u.test(normalized)) {
    return { family: "stablecoin", priceKey: "usd_stable" };
  }
  return {};
}

function normalizeTrackingStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pending_whitelist_review" || status === "unknown" || status === "unregistered") {
    return "unregistered";
  }
  return status || null;
}

function countsInWalletTotalFromTrackingStatus(status) {
  return !["protocol_reader_covered", "unregistered"].includes(normalizeTrackingStatus(status));
}

function tokenRecord(chain, token, balance, prices, rpcUrl, metadata = {}) {
  const overrides = {};
  if (metadata.ticker || metadata.symbol) overrides.ticker = metadata.ticker || metadata.symbol;
  if (metadata.family) overrides.family = metadata.family;
  if (Number.isInteger(metadata.decimals)) overrides.decimals = metadata.decimals;
  if (metadata.priceKey) overrides.priceKey = metadata.priceKey;
  Object.assign(overrides, {
    ...stablePriceMetadata(overrides.ticker),
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  });
  const asset = tokenAsset(chain, token, overrides);
  const actualDecimal = unitsToDecimal(balance, asset.decimals ?? 18);
  const estimatedUsd = Number.isFinite(metadata.estimatedUsdOverride)
    ? metadata.estimatedUsdOverride
    : Number.isFinite(actualDecimal)
      ? actualDecimal * (priceForAssetUsd(asset, prices) ?? NaN)
      : null;
  return {
    chain,
    token,
    ticker: asset.ticker,
    family: asset.family,
    balance: balance.toString(),
    actualDecimal,
    estimatedUsd: Number.isFinite(estimatedUsd) ? estimatedUsd : null,
    rpcUrl: rpcUrl || null,
    registered: metadata.registered ?? null,
    trackingStatus: normalizeTrackingStatus(metadata.trackingStatus),
    sourceKinds: metadata.sourceKinds || [],
    tokenName: metadata.name || null,
    metadataRpcUrl: metadata.metadataRpcUrl || null,
    valuation: metadata.valuation || null,
    countedInWalletTotal: countsInWalletTotalFromTrackingStatus(metadata.trackingStatus),
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

function readerParamsFromLedgerPosition(position = {}) {
  // The ledger's position_opened events carry per-protocol fields. Map them
  // to the params shape expected by each reader. bindingKind is the routing
  // key; readers ignore irrelevant fields.
  const vaultLike = position.vaultAddress || position.shareTokenAddress || null;
  return {
    vaultAddress: vaultLike,
    poolAddress: position.poolAddress || null,
    aTokenAddress: position.shareTokenAddress || null,
    underlyingTokenAddress: position.assetAddress || null,
    variableDebtTokenAddress: position.variableDebtTokenAddress || null,
    marketAddress: position.marketAddress || vaultLike,
    marketLabel: position.marketName || vaultLike,
    opportunityId: position.opportunityId || null,
    strategyId: position.strategyId || null,
    protocolId: position.protocolId || null,
    bindingKind: position.bindingKind || null,
  };
}

function priceForUnderlyingUsd(position, prices) {
  if (!position?.assetAddress || !position?.chain) return null;
  // Best-effort underlying-asset price via tokenAsset() lookup. Unknown tokens
  // return null and the position USD is left null (not zero).
  const asset = tokenAsset(position.chain, position.assetAddress);
  const price = priceForAssetUsd(asset, prices);
  return Number.isFinite(price) ? price : null;
}

function protocolPositionRecordFromReader({ position, ledgerEntry, prices }) {
  const decimals = Number.isFinite(position.assetDecimals) ? position.assetDecimals : null;
  let actualDecimal = null;
  let usdValue = null;
  try {
    if (decimals !== null && position.assetBalance !== undefined && position.assetBalance !== null) {
      actualDecimal = unitsToDecimal(BigInt(position.assetBalance), decimals);
      const price = priceForUnderlyingUsd({ ...ledgerEntry, ...position }, prices);
      if (Number.isFinite(actualDecimal) && Number.isFinite(price)) {
        usdValue = actualDecimal * price;
      }
    }
  } catch {
    actualDecimal = null;
    usdValue = null;
  }
  return {
    family: "protocol",
    positionId: position.positionId,
    bindingKind: position.bindingKind,
    protocolId: position.protocolId,
    adapterId: position.adapterId,
    chain: position.chain,
    walletAddress: position.walletAddress,
    positionFamily: position.family,
    symbol: position.symbol || null,
    shareTokenAddress: position.shareTokenAddress || null,
    underlyingTokenAddress: position.underlyingTokenAddress || null,
    assetDecimals: decimals,
    shareBalance: position.shareBalance ?? null,
    assetBalance: position.assetBalance ?? null,
    actualDecimal,
    estimatedUsd: Number.isFinite(usdValue) ? usdValue : null,
    usdValue: Number.isFinite(usdValue) ? usdValue : null,
    healthFactor: Number.isFinite(position.healthFactor) ? position.healthFactor : null,
    fetchedAt: position.fetchedAt,
    observedAt: position.observedAt,
    freshness: position.freshness || "fresh",
    confidence: position.confidence || "verified_current",
    source: "protocol_reader",
  };
}

export async function dispatchLedgerPositions({
  positions = [],
  walletAddress,
  prices = null,
  signer = null,
  dispatchImpl = dispatchPosition,
} = {}) {
  const protocolPositions = [];
  const readerErrors = [];
  for (const ledgerEntry of positions) {
    if (!ledgerEntry || !ledgerEntry.bindingKind || !ledgerEntry.chain) {
      readerErrors.push({
        positionId: ledgerEntry?.positionId || null,
        bindingKind: ledgerEntry?.bindingKind || null,
        code: "missing_routing_fields",
        error: "ledger entry missing chain or bindingKind",
      });
      continue;
    }
    const readerInputPosition = {
      ...ledgerEntry,
      params: readerParamsFromLedgerPosition(ledgerEntry),
    };
    const dispatch = await dispatchImpl({
      position: readerInputPosition,
      chain: ledgerEntry.chain,
      walletAddress: walletAddress || ledgerEntry.walletAddress || null,
      signer,
    });
    if (dispatch.kind === "reader") {
      const result = dispatch.result;
      if (!result?.ok) {
        readerErrors.push({
          positionId: ledgerEntry.positionId || null,
          bindingKind: ledgerEntry.bindingKind || null,
          code: result?.code || "reader_failed",
          error: result?.error || "reader returned error",
          readerId: dispatch.id,
        });
        continue;
      }
      for (const observed of result.positions || []) {
        protocolPositions.push(
          protocolPositionRecordFromReader({ position: observed, ledgerEntry, prices }),
        );
      }
    } else if (dispatch.kind === "legacy") {
      // Legacy mark-based adapter exists but cannot supply a fresh
      // NormalizedPosition without going through markActiveProtocolPositions.
      // Emit an explicit row noting legacy coverage so the position is not
      // silently dropped from the inventory snapshot.
      protocolPositions.push({
        family: "protocol",
        positionId: ledgerEntry.positionId,
        bindingKind: ledgerEntry.bindingKind,
        protocolId: ledgerEntry.protocolId || null,
        adapterId: dispatch.adapter?.id || null,
        chain: ledgerEntry.chain,
        walletAddress: walletAddress || ledgerEntry.walletAddress || null,
        positionFamily: null,
        symbol: null,
        shareTokenAddress: ledgerEntry.shareTokenAddress || null,
        underlyingTokenAddress: ledgerEntry.assetAddress || null,
        assetDecimals: null,
        shareBalance: null,
        assetBalance: null,
        actualDecimal: null,
        estimatedUsd: Number.isFinite(ledgerEntry.amountUsd) ? Number(ledgerEntry.amountUsd) : null,
        usdValue: Number.isFinite(ledgerEntry.amountUsd) ? Number(ledgerEntry.amountUsd) : null,
        healthFactor: null,
        fetchedAt: ledgerEntry.observedAt || null,
        observedAt: ledgerEntry.observedAt || null,
        freshness: "stale",
        confidence: "adapter_missing",
        source: "legacy_adapter_marker_required",
      });
      // Surface legacy-only coverage as a track1 reader_error so coverage
      // reporting flags positions that lack a fresh reader path.
      readerErrors.push({
        positionId: ledgerEntry.positionId || null,
        bindingKind: ledgerEntry.bindingKind || null,
        code: "legacy_adapter_only",
        error: `no fresh reader for bindingKind ${ledgerEntry.bindingKind}; legacy mark-adapter available but value is stale ledger USD`,
        readerId: null,
        adapterId: dispatch.adapter?.id || null,
      });
    } else {
      readerErrors.push({
        positionId: ledgerEntry.positionId || null,
        bindingKind: ledgerEntry.bindingKind || null,
        code: dispatch.reason || "no_reader_no_adapter",
        error: `no reader or legacy adapter for bindingKind ${ledgerEntry.bindingKind}`,
      });
    }
  }
  return { protocolPositions, readerErrors };
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
  protocolPositions = [],
  readerErrors = [],
  assetUniverse = null,
  tokenMetadata = {},
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
      const metadata = tokenMetadata[tokenBalanceKey(entry)] || {};
      tokenEntries.push(tokenRecord(entry.chain, entry.token, BigInt(entry.balance), prices, entry.rpcUrl, metadata));
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
  const walletTokenEntries = tokenEntries.filter((item) => item.countedInWalletTotal !== false);
  const holdings = [...native, ...walletTokenEntries];
  const tokenUsd = holdings
    .map((item) => item.estimatedUsd)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  // Only fresh reader-sourced positions count into protocolUsd. Legacy
  // mark-based fallback rows (source: "legacy_adapter_marker_required") carry
  // stale audit-log USD and freshness="stale"; including them would double-
  // count when the same underlying token still appears as an ERC20 balance
  // and would surface stale ledger USD as live RPC value.
  const isFreshReaderRow = (item) =>
    item && item.source === "protocol_reader" && item.freshness !== "stale" && item.freshness !== "expired" && item.freshness !== "failed";
  const protocolUsd = (protocolPositions || [])
    .filter(isFreshReaderRow)
    .map((item) => item.usdValue ?? item.estimatedUsd)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const protocolStaleUsd = (protocolPositions || [])
    .filter((item) => !isFreshReaderRow(item))
    .map((item) => item.usdValue ?? item.estimatedUsd)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const totalUsd = tokenUsd + protocolUsd;
  const unknownAssetBalances = tokenEntries.filter((item) => item.trackingStatus === "unregistered");
  const missingValuationAssets = holdings
    .filter((item) => Number.isFinite(item.actualDecimal) && item.actualDecimal > 0 && !Number.isFinite(item.estimatedUsd))
    .map((item) => ({
      chain: item.chain,
      token: item.token,
      ticker: item.ticker,
      family: item.family,
      actualDecimal: item.actualDecimal,
      trackingStatus: item.trackingStatus || null,
    }));
  const assetUniverseStatus = assetUniverse?.status || null;
  const authoritativeScanErrorCount = scanErrors.filter((item) => item.kind !== "external_portfolio").length;
  const walletCoverage =
    authoritativeScanErrorCount === 0 && unknownAssetBalances.length === 0 && missingValuationAssets.length === 0
      ? "full_rpc"
      : "partial_supported";

  return {
    schemaVersion: 2,
    observedAt: observedAt || new Date().toISOString(),
    address,
    totalUsd,
    native: native.sort((left, right) => (right.estimatedUsd ?? -1) - (left.estimatedUsd ?? -1)),
    tokenBalances: tokenEntries.sort((left, right) => (right.estimatedUsd ?? -1) - (left.estimatedUsd ?? -1)),
    protocolPositions: [...(protocolPositions || [])].sort(
      (left, right) => (right.usdValue ?? right.estimatedUsd ?? -1) - (left.usdValue ?? left.estimatedUsd ?? -1),
    ),
    reader_errors: [...(readerErrors || [])],
    scanErrors,
    totals: {
      tokenUsd,
      protocolUsd,
      protocolStaleUsd,
      totalUsd,
    },
    summary: {
      chainCount: new Set(holdings.map((item) => item.chain)).size,
      nativeCount: native.length,
      tokenCount: tokenEntries.length,
      protocolPositionCount: (protocolPositions || []).length,
      readerErrorCount: (readerErrors || []).length,
      scanErrorCount: scanErrors.length,
      itemizedWalletUsd: localTotalUsd,
      externalWalletUsd: externalPortfolio?.walletUsd ?? null,
      externalTotalPortfolioUsd: externalPortfolio?.totalPortfolioUsd ?? null,
      externalUnclassifiedUsd,
      externalProvider: externalPortfolio?.provider || null,
      walletCoverage,
      assetUniverseStatus,
      assetUniverseTargetCount: assetUniverse?.targetCount ?? null,
      assetUniverseUnknownTargetCount: assetUniverse?.unknownTargetCount ?? null,
      unknownAssetBalanceCount: unknownAssetBalances.length,
      missingValuationCount: missingValuationAssets.length,
      missingValuationAssets: missingValuationAssets.slice(0, 25),
    },
    assetUniverse: assetUniverse ? {
      status: assetUniverse.status,
      targetCount: assetUniverse.targetCount,
      registeredTargetCount: assetUniverse.registeredTargetCount,
      protocolReaderCoveredTargetCount: assetUniverse.protocolReaderCoveredTargetCount,
      unknownTargetCount: assetUniverse.unknownTargetCount,
      unknownTargets: (assetUniverse.unknownTargets || []).slice(0, 25),
    } : null,
    unknownAssetBalances,
    source: externalPortfolio ? "live_scan_with_external_reference" : "live_scan",
  };
}

function mergeTokenTargets(primary = [], extra = []) {
  const byKey = new Map();
  for (const target of [...primary, ...extra]) {
    const key = tokenBalanceKey(target);
    if (!key) continue;
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...target,
      token: target.token,
      chain: target.chain,
    });
  }
  return [...byKey.values()];
}

async function enrichErc4626Valuation({ chain, token, balance, metadata, prices, fetchImpl }) {
  if (!balance || BigInt(balance) <= 0n) return metadata;
  const hasDirectPrice = Boolean(metadata.priceKey || stablePriceMetadata(metadata.ticker || metadata.symbol).priceKey);
  const symbol = String(metadata.ticker || metadata.symbol || "").toLowerCase();
  const knownShareSymbol = /(?:alpha|steak|vault|share|bbq|erlusd|gtusdt|aopt|ason|aava|mwusdc)/u.test(symbol);
  if (hasDirectPrice && metadata.trackingStatus !== "pending_whitelist_review" && !knownShareSymbol) return metadata;
  const preview = await readErc4626SharePreview(chain, token, balance, { fetchImpl }).catch(() => null);
  if (!preview?.asset) return metadata;
  const underlyingMetadata = await readErc20Metadata(chain, preview.asset, { fetchImpl }).catch(() => null);
  const underlyingSymbol = underlyingMetadata?.symbol || null;
  const underlyingDecimals = Number.isInteger(underlyingMetadata?.decimals) ? underlyingMetadata.decimals : null;
  const underlyingAsset = tokenAsset(chain, preview.asset, {
    ticker: underlyingSymbol || undefined,
    decimals: underlyingDecimals ?? undefined,
    ...stablePriceMetadata(underlyingSymbol),
  });
  const underlyingDecimal = unitsToDecimal(preview.assets, underlyingAsset.decimals ?? 18);
  const underlyingPriceUsd = priceForAssetUsd(underlyingAsset, prices);
  const estimatedUsdOverride = Number.isFinite(underlyingDecimal) && Number.isFinite(underlyingPriceUsd)
    ? underlyingDecimal * underlyingPriceUsd
    : null;
  return {
    ...metadata,
    valuation: {
      kind: "erc4626_preview",
      observedAt: new Date().toISOString(),
      underlyingToken: preview.asset,
      underlyingSymbol,
      underlyingDecimals: underlyingAsset.decimals ?? null,
      underlyingAssets: preview.assets.toString(),
      underlyingDecimal,
      underlyingPriceUsd: Number.isFinite(underlyingPriceUsd) ? underlyingPriceUsd : null,
      rpcUrl: preview.rpcUrl || null,
    },
    estimatedUsdOverride,
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
  ledgerPositions = [],
  signer = null,
  protocolPositionDispatcher = dispatchLedgerPositions,
  assetUniverse = null,
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
  const erc4626PendingCandidates = [];
  const universeTargets = assetUniverseTokenTargets(assetUniverse);
  const tokenMetadata = Object.fromEntries(universeTargets.map((target) => [tokenBalanceKey(target), target]));
  for (const chain of chains) {
    const targets = mergeTokenTargets(
      knownWholeWalletTokenTargets({ families, chain }),
      universeTargets.filter((target) => target.chain === chain),
    );
    const seenTokensForChain = new Set();
    for (const target of targets) {
      const tokenKey = normalized(target.token);
      if (seenTokensForChain.has(tokenKey)) continue;
      seenTokensForChain.add(tokenKey);
      try {
        const metadata = tokenMetadata[`${chain}:${tokenKey}`] || {};
        if (!Number.isInteger(metadata.decimals) || !metadata.ticker) {
          const onchain = await readErc20Metadata(chain, target.token, { fetchImpl });
          if (onchain) {
            metadata.decimals ??= onchain.decimals;
            metadata.ticker ??= onchain.symbol;
            metadata.symbol ??= onchain.symbol;
            metadata.name ??= onchain.name;
            metadata.metadataRpcUrl ??= onchain.rpcUrl;
            tokenMetadata[`${chain}:${tokenKey}`] = metadata;
          }
        }
        const result = await readErc20Balance(chain, target.token, address, { fetchImpl });
        if (result.balance > 0n) {
          const enrichedMetadata = await enrichErc4626Valuation({
            chain,
            token: target.token,
            balance: result.balance,
            metadata,
            prices,
            fetchImpl,
          });
          tokenMetadata[`${chain}:${tokenKey}`] = enrichedMetadata;
          tokenEntries.push({
            chain,
            token: target.token,
            balance: result.balance.toString(),
            rpcUrl: result.rpcUrl || null,
          });
          if (enrichedMetadata.valuation?.kind === "erc4626_preview" && !metadata.registered) {
            erc4626PendingCandidates.push({
              schemaVersion: 1,
              source: "erc4626_auto_probe",
              event: "erc4626_vault_token_detected",
              observedAt: enrichedMetadata.valuation.observedAt,
              chain,
              address: target.token,
              symbol: enrichedMetadata.ticker || enrichedMetadata.symbol || null,
              decimals: enrichedMetadata.decimals ?? 18,
              underlyingToken: enrichedMetadata.valuation.underlyingToken,
              underlyingSymbol: enrichedMetadata.valuation.underlyingSymbol,
              underlyingDecimals: enrichedMetadata.valuation.underlyingDecimals,
              underlyingAssets: enrichedMetadata.valuation.underlyingAssets,
              underlyingDecimal: enrichedMetadata.valuation.underlyingDecimal,
              estimatedUsd: enrichedMetadata.estimatedUsdOverride ?? null,
              rpcUrl: enrichedMetadata.valuation.rpcUrl || null,
              classification: "erc4626_vault_share",
              rationale: `ERC4626 convertToAssets probe succeeded; underlying=${enrichedMetadata.valuation.underlyingSymbol}`,
              requestedAction: "commit_token_registry_and_protocol_binding",
            });
          }
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

  let protocolPositions = [];
  let readerErrors = [];
  if (Array.isArray(ledgerPositions) && ledgerPositions.length > 0) {
    try {
      const dispatched = await protocolPositionDispatcher({
        positions: ledgerPositions,
        walletAddress: address,
        prices,
        signer,
      });
      protocolPositions = dispatched.protocolPositions || [];
      readerErrors = dispatched.readerErrors || [];
    } catch (error) {
      readerErrors.push({
        positionId: null,
        bindingKind: null,
        code: "dispatch_threw",
        error: error?.message || String(error),
      });
    }
  }

  const inventory = buildWholeWalletInventory({
    address,
    bitcoinAddress,
    nativeBalances: Object.fromEntries(nativeEntries),
    tokenBalances: tokenEntries,
    bitcoinBalance,
    scanErrors,
    prices,
    chains,
    externalPortfolio,
    protocolPositions,
    readerErrors,
    assetUniverse,
    tokenMetadata,
  });
  if (erc4626PendingCandidates.length > 0) {
    inventory.erc4626PendingWhitelist = erc4626PendingCandidates;
  }
  return inventory;
}

export function latestWholeWalletInventoryForAddress(records = [], address) {
  return [...(records || [])]
    .filter((item) => normalized(item?.address) === normalized(address))
    .sort((left, right) => new Date(right?.observedAt || 0) - new Date(left?.observedAt || 0))[0] || null;
}
