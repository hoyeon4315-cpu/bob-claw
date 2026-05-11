#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd, latestPriceSnapshot, mergeMissingPricesUsd, pricesFromSnapshot } from "../market/prices.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { resolveShadowCycleContext } from "../session/shadow-cycle-context.mjs";
import { scanWholeWalletInventory } from "../treasury/whole-wallet-scan.mjs";
import { activeProtocolPositions } from "../treasury/protocol-position-ledger.mjs";
import { resolveAddressScanPortfolioReader } from "../treasury/address-scan-api.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { bootstrapReaders } from "../protocol-readers/bootstrap.mjs";
import { buildAssetUniverse } from "../treasury/asset-universe.mjs";

bootstrapReaders();

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    externalAddressScan: flags.has("--external-address-scan"),
    address: options.address || null,
    families: options.families ? options.families.split(",").map((item) => item.trim()).filter(Boolean) : null,
  };
}

function hasPositiveEstimatedWalletUsd(inventory = null) {
  return Number.isFinite(inventory?.summary?.estimatedWalletUsd)
    ? inventory.summary.estimatedWalletUsd > 0
    : Number.isFinite(inventory?.totalUsd)
      ? inventory.totalUsd > 0
      : false;
}

export function shouldUseStoredWholeWalletFallback(liveInventory = null, treasurySnapshot = null) {
  const liveHoldingsCount =
    (liveInventory?.summary?.nativeCount ?? 0) + (liveInventory?.summary?.tokenCount ?? 0);
  const liveErrors = liveInventory?.summary?.scanErrorCount ?? 0;
  const liveHasValue = hasPositiveEstimatedWalletUsd(liveInventory);
  const storedHasValue = hasPositiveEstimatedWalletUsd(treasurySnapshot);
  return Boolean(storedHasValue && !liveHasValue && liveHoldingsCount === 0 && liveErrors > 0);
}

export function materializeWholeWalletInventory(liveInventory = null, treasurySnapshot = null) {
  if (!shouldUseStoredWholeWalletFallback(liveInventory, treasurySnapshot)) {
    return {
      ...(liveInventory || {}),
      source: liveInventory?.source || "live_scan",
    };
  }
  return {
    schemaVersion: liveInventory?.schemaVersion || 1,
    observedAt: treasurySnapshot?.observedAt || liveInventory?.observedAt || new Date().toISOString(),
    address: treasurySnapshot?.address || liveInventory?.address || null,
    totalUsd: treasurySnapshot?.summary?.estimatedWalletUsd ?? 0,
    native: (treasurySnapshot?.native || []).map((item) => ({
      chain: item.chain,
      ticker: item.asset,
      family: "native_or_wrapped",
      token: item.token,
      balance: item.actual,
      actualDecimal: item.actualDecimal,
      estimatedUsd: item.estimatedUsd ?? null,
      rpcUrl: item.rpcUrl || null,
      source: "stored_treasury_snapshot",
    })),
    tokenBalances: (treasurySnapshot?.tokens || []).map((item) => ({
      chain: item.chain,
      token: item.token,
      ticker: item.ticker,
      family: "wrapped_btc",
      balance: item.actual,
      actualDecimal: item.actualDecimal,
      estimatedUsd: item.estimatedUsd ?? null,
      rpcUrl: item.rpcUrl || null,
      source: "stored_treasury_snapshot",
    })),
    scanErrors: liveInventory?.scanErrors || [],
    summary: {
      chainCount:
        new Set([...(treasurySnapshot?.native || []).map((item) => item.chain), ...(treasurySnapshot?.tokens || []).map((item) => item.chain)])
          .size,
      nativeCount: treasurySnapshot?.native?.length ?? 0,
      tokenCount: treasurySnapshot?.tokens?.length ?? 0,
      scanErrorCount: liveInventory?.summary?.scanErrorCount ?? 0,
    },
    source: "stored_treasury_snapshot",
    liveScanTotalUsd: liveInventory?.totalUsd ?? 0,
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function readLatestLocalPriceSnapshot(dataDir = config.dataDir) {
  const latestJson = await readJsonIfExists(join(dataDir, "price-snapshot.json"));
  if (latestJson) return latestJson;
  return latestPriceSnapshot(await readJsonl(dataDir, "market-price-snapshots").catch(() => []));
}

export async function resolveInventoryPrices({
  dataDir = config.dataDir,
  livePriceReader = getCoinGeckoPricesUsd,
} = {}) {
  const [livePrices, localSnapshot] = await Promise.all([
    livePriceReader().catch(() => emptyPricesUsd()),
    readLatestLocalPriceSnapshot(dataDir),
  ]);
  const localPrices = localSnapshot ? pricesFromSnapshot(localSnapshot) : emptyPricesUsd();
  return mergeMissingPricesUsd(livePrices, localPrices);
}

async function resolveBitcoinAddress() {
  try {
    const health = await readSignerHealth({
      socketPath: signerSocketPath(),
      timeoutMs: signerClientTimeoutMs(),
    });
    return health?.addresses?.bitcoin || null;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const context = await resolveShadowCycleContext({
    dataDir: config.dataDir,
    explicitAddress: resolved.address,
    configuredAddress: config.estimateFrom,
  });
  const prices = await resolveInventoryPrices({ dataDir: config.dataDir });
  const bitcoinAddress = await resolveBitcoinAddress();
  const externalPortfolioReader = args.externalAddressScan
    ? resolveAddressScanPortfolioReader({
        providers: config.addressScanProviders,
        zerionApiKey: config.zerionApiKey,
        zerionApiBase: config.zerionApiBase,
        tatumApiKey: config.tatumApiKey,
        tatumApiBase: config.tatumApiBase,
      })
    : null;
  const ledgerEvents = await readJsonl(config.dataDir, "merkl-portfolio-positions").catch(() => []);
  const ledgerPositions = activeProtocolPositions(ledgerEvents);
  const [
    receiptReconciliations,
    signerAuditRecords,
    inboundEvents,
    protocolPositionMarks,
  ] = await Promise.all([
    readJsonl(config.dataDir, "receipt-reconciliations").catch(() => []),
    readJsonl("logs", "signer-audit").catch(() => []),
    readJsonl(config.dataDir, "treasury/inbound-events").catch(() => []),
    readJsonl(config.dataDir, "protocol-position-marks").catch(() => []),
  ]);
  const assetUniverse = buildAssetUniverse({
    chains: policy.supportedChains,
    receiptReconciliations,
    signerAuditRecords,
    inboundEvents,
    protocolPositionMarks,
  });
  const liveInventory = await scanWholeWalletInventory({
    address: resolved.address,
    bitcoinAddress,
    prices,
    chains: policy.supportedChains,
    families: args.families,
    externalPortfolioReader,
    ledgerPositions,
    assetUniverse,
  });
  const inventory = materializeWholeWalletInventory(liveInventory, context.inventorySnapshot);
  const store = new JsonlStore(config.dataDir);
  await store.append("whole-wallet-inventory", inventory);

  if (Array.isArray(liveInventory?.erc4626PendingWhitelist) && liveInventory.erc4626PendingWhitelist.length > 0) {
    const [existingAutoReg, existingPending] = await Promise.all([
      readJsonl(config.dataDir, "treasury/auto-registered-erc4626").catch(() => []),
      readJsonl(config.dataDir, "treasury/pending-whitelist").catch(() => []),
    ]);
    const seenAutoKeys = new Set(existingAutoReg.map((item) => `${item.chain}:${(item.address || "").toLowerCase()}`));
    const seenPendingKeys = new Set(existingPending.map((item) => `${item.chain}:${(item.address || item.token || "").toLowerCase()}`));
    let autoRegistered = 0;
    let pendingStaged = 0;
    for (const candidate of liveInventory.erc4626PendingWhitelist) {
      const key = `${candidate.chain}:${(candidate.address || "").toLowerCase()}`;
      if (candidate.autoRegistrable) {
        if (seenAutoKeys.has(key)) continue;
        await store.append("treasury/auto-registered-erc4626", candidate);
        seenAutoKeys.add(key);
        autoRegistered += 1;
      } else {
        if (seenPendingKeys.has(key)) continue;
        await store.append("treasury/pending-whitelist", candidate);
        seenPendingKeys.add(key);
        pendingStaged += 1;
      }
    }
    if (autoRegistered > 0) {
      console.log(`erc4626AutoRegistered: ${autoRegistered} vault token(s) auto-registered (known underlying)`);
    }
    if (pendingStaged > 0) {
      console.log(`erc4626PendingWhitelist: ${pendingStaged} vault token(s) staged for manual review (unknown underlying)`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(inventory, null, 2));
    return;
  }

  console.log(`address=${inventory.address}`);
  console.log(`inventorySource=${inventory.source || "live_scan"}`);
  console.log(`totalUsd=${inventory.totalUsd.toFixed(4)}`);
  console.log(`externalAddressScan=${inventory.summary.externalProvider || "inactive"}`);
  if (Number.isFinite(inventory.summary.externalWalletUsd)) {
    console.log(`externalWalletUsd=${inventory.summary.externalWalletUsd.toFixed(4)}`);
  }
  if (Number.isFinite(inventory.summary.externalUnclassifiedUsd)) {
    console.log(`externalUnclassifiedUsd=${inventory.summary.externalUnclassifiedUsd.toFixed(4)}`);
  }
  console.log(`native=${inventory.summary.nativeCount} tokens=${inventory.summary.tokenCount} scanErrors=${inventory.summary.scanErrorCount}`);
  console.log(`assetUniverse=${inventory.summary.assetUniverseStatus || "inactive"} targets=${inventory.summary.assetUniverseTargetCount ?? "n/a"} unknown=${inventory.summary.assetUniverseUnknownTargetCount ?? "n/a"}`);
  if (inventory.summary.unknownAssetBalanceCount > 0) {
    console.log(`unknownAssetBalances=${inventory.summary.unknownAssetBalanceCount}`);
  }
  for (const item of [...inventory.native, ...inventory.tokenBalances].slice(0, 12)) {
    console.log(`${item.chain} ${item.ticker}=${item.actualDecimal} usd=${item.estimatedUsd ?? "n/a"}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
