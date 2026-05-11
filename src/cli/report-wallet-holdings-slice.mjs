#!/usr/bin/env node
// Emits dashboard/public/wallet-holdings.json from data/whole-wallet-inventory.jsonl.
// Graceful pending fallback when inventory is missing or empty.
// Deterministic, pure I/O; no keys, no network.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dashboardJsonOutputPath,
  hasFlag,
  optionMapFromArgs,
} from '../dashboard/live-snapshot-paths.mjs';
import { config } from '../config/env.mjs';
import { buildProtocolAprSlice } from '../status/protocol-apr-slice.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../..');
const DATA_DIR = config.dataDir || path.join(ROOT, 'data');
const INVENTORY_PATH = path.join(DATA_DIR, 'whole-wallet-inventory.jsonl');
const WRAPPED_BTC_LOOP_SLICE_PATH = path.join(DATA_DIR, 'wrapped-btc-lending-loop-slice.json');
const RECURSIVE_WRAPPED_BTC_LOOP_SCAFFOLD_PATH = path.join(DATA_DIR, 'recursive_wrapped_btc_lending_loop-scaffold.json');
const SOURCE_FRESH_MAX_AGE_MS = 15 * 60 * 1000;
const PRICE_FRESH_MAX_AGE_MS = 5 * 60 * 1000;
const PRICE_DIVERGENCE_WARN_PCT = 1;
const PRICE_DIVERGENCE_BLOCK_PCT = 3;

async function readJsonlRecords(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    return lines.map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function normaliseChain(id) {
  if (!id) return null;
  const low = String(id).toLowerCase();
  // Align with dashboard CHAINS ids.
  const map = { bnb: 'bsc', avax: 'avalanche', berachain: 'bera' };
  return map[low] || low;
}

function normaliseTicker(t) {
  if (!t) return null;
  const low = String(t).toLowerCase();
  const map = { 'wbtc.oft': 'wbtc', 'cbbtc': 'cbbtc' };
  return map[low] || low;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function observedAtOrFallback(...values) {
  return values.find((value) => Number.isFinite(Date.parse(value || ""))) || new Date(0).toISOString();
}

function ageMs(observedAt, now) {
  const observed = Date.parse(observedAt || "");
  const current = Date.parse(now || "");
  if (!Number.isFinite(observed) || !Number.isFinite(current)) return null;
  return Math.max(0, current - observed);
}

function sourceFreshness(observedAt, now, maxAgeMs = SOURCE_FRESH_MAX_AGE_MS) {
  const age = ageMs(observedAt, now);
  return age !== null && age <= maxAgeMs ? "fresh" : "stale";
}

function normalizeTrackingStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pending_whitelist_review" || status === "unknown" || status === "unregistered") {
    return "unregistered";
  }
  return status || null;
}

function isUnregisteredTrackingStatus(value) {
  return normalizeTrackingStatus(value) === "unregistered";
}

function normalizeDivergencePct(item = {}, source = null) {
  return finiteNumber(
    item.priceDivergencePct ??
      item.divergencePct ??
      source?.divergencePct ??
      item.priceSource?.divergencePct,
  ) ?? 0;
}

function priceSourceKindForItem(item = {}) {
  const sym = String(item.sym || item.ticker || item.symbol || item.name || "").toLowerCase();
  const family = String(item.family || "").toLowerCase();
  const valuationKind = item.valuation?.kind || item.priceSource?.valuationKind || null;
  if (valuationKind === "erc4626_preview") {
    return {
      name: "erc4626_preview_underlying_chainlink_oracle",
      type: "erc4626_underlying_preview",
    };
  }
  if (["eth", "weth"].includes(sym) || (family === "native_or_wrapped" && item.chain !== "bsc" && item.chain !== "avalanche")) {
    return { name: "chainlink:eth_usd", type: "chainlink_onchain_feed" };
  }
  if (["btc", "wbtc", "wbtc.oft", "cbbtc", "unibtc", "solvbtc"].includes(sym) || family === "wrapped_btc" || family === "btc") {
    return { name: "chainlink:btc_usd", type: "chainlink_onchain_feed" };
  }
  if (["usdc", "usdt", "ousdt", "rlusd", "usdc.e"].includes(sym) || /(?:usdc|usdt|rlusd)/u.test(sym) || family === "stablecoin") {
    return { name: "chainlink:usd_stable", type: "chainlink_onchain_feed" };
  }
  if (item.usd === null || item.usd === undefined) {
    return { name: "missing_price_source", type: "missing" };
  }
  return { name: "coingecko_http_fallback", type: "coingecko_http" };
}

function normalizePriceSource(item = {}, { observedAt, priceObservedAt } = {}) {
  const existing = item.priceSource && typeof item.priceSource === "object" ? item.priceSource : null;
  const sourceKind = existing || priceSourceKindForItem(item);
  const observed = observedAtOrFallback(sourceKind.observedAt, priceObservedAt, observedAt);
  const divergencePct = normalizeDivergencePct(item, sourceKind);
  return {
    name: String(sourceKind.name || item.priceSource || "missing_price_source"),
    type: String(sourceKind.type || "snapshot"),
    observedAt: observed,
    divergencePct,
    primary: "chainlink_onchain_feed",
    secondary: "dex_pool_median",
    fallback: "coingecko_http",
  };
}

function normalizePriceFreshness(item = {}, { priceObservedAt, now } = {}) {
  const existing = String(item.priceFreshness || "").toLowerCase();
  if (["fresh", "stale", "missing"].includes(existing)) return existing;
  if (!Number.isFinite(Number(item.usd))) return "missing";
  const priceAge = ageMs(priceObservedAt, now);
  return priceAge !== null && priceAge <= PRICE_FRESH_MAX_AGE_MS ? "fresh" : "stale";
}

function normalizeDivergenceStatus(item = {}, { priceSource, priceFreshness } = {}) {
  const existing = String(item.priceDivergenceStatus || "").toLowerCase();
  if (["ok", "warn", "block"].includes(existing)) return existing;
  if (priceFreshness === "missing") return "block";
  const divergencePct = finiteNumber(priceSource?.divergencePct) ?? 0;
  if (divergencePct > PRICE_DIVERGENCE_BLOCK_PCT) return "block";
  if (divergencePct > PRICE_DIVERGENCE_WARN_PCT) return "warn";
  return "ok";
}

function normalizeConfidence(item = {}, { priceFreshness, freshness, trackingStatus } = {}) {
  const existing = String(item.confidence || "").toLowerCase();
  if (["verified_current", "rpc_inferred", "registry_only", "low"].includes(existing)) return existing;
  if (isUnregisteredTrackingStatus(trackingStatus)) return "low";
  if (item.family === "protocol" && freshness === "fresh" && priceFreshness !== "missing") return "verified_current";
  if (priceFreshness === "missing") return "registry_only";
  if (freshness === "fresh") return "rpc_inferred";
  return "registry_only";
}

function normalizeHoldingItem(item = {}, { inventoryObservedAt = null, nowIso } = {}) {
  const sourceObservedAt = observedAtOrFallback(item.sourceObservedAt, item.observedAt, item.markObservedAt, inventoryObservedAt, nowIso);
  const priceObservedAt = observedAtOrFallback(item.priceObservedAt, item.markObservedAt, item.observedAt, sourceObservedAt);
  const freshness = ["fresh", "stale"].includes(String(item.freshness || "").toLowerCase())
    ? String(item.freshness).toLowerCase()
    : sourceFreshness(sourceObservedAt, nowIso);
  const priceSource = normalizePriceSource(item, { observedAt: sourceObservedAt, priceObservedAt });
  const priceFreshness = normalizePriceFreshness(item, { priceObservedAt, now: nowIso });
  const priceDivergenceStatus = normalizeDivergenceStatus(item, { priceSource, priceFreshness });
  const trackingStatus = normalizeTrackingStatus(item.trackingStatus);
  const countedInWalletTotal =
    isUnregisteredTrackingStatus(trackingStatus) || priceDivergenceStatus === "block"
      ? false
      : item.countedInWalletTotal !== false;
  return {
    ...item,
    trackingStatus,
    sourceObservedAt,
    priceSource,
    priceObservedAt,
    priceFreshness,
    priceDivergenceStatus,
    freshness,
    confidence: normalizeConfidence(item, { priceFreshness, freshness, trackingStatus }),
    countedInWalletTotal,
  };
}

export function buildItems(inv, { now = new Date() } = {}) {
  const out = [];
  const inventoryObservedAt = inv?.observedAt || null;
  const nowIso = now instanceof Date ? now.toISOString() : String(now || new Date().toISOString());
  for (const n of inv.native || []) {
    const usd = Number(n.estimatedUsd);
    const amt = Number(n.actualDecimal);
    if (!Number.isFinite(amt)) continue;
    out.push(normalizeHoldingItem({
      sym: normaliseTicker(n.ticker),
      name: n.ticker || '',
      chain: normaliseChain(n.chain),
      amount: amt,
      usd: Number.isFinite(usd) ? usd : null,
      family: 'native',
      source: 'whole_wallet_inventory',
      sourceObservedAt: n.observedAt || inventoryObservedAt,
      priceSource: n.priceSource || inv.priceSource || null,
      priceObservedAt: n.priceObservedAt || n.observedAt || inventoryObservedAt,
      priceFreshness: n.priceFreshness || null,
      priceDivergenceStatus: n.priceDivergenceStatus || null,
      freshness: n.freshness || null,
      confidence: n.confidence || null,
      countedInWalletTotal: true,
    }, { inventoryObservedAt, nowIso }));
  }
  for (const t of inv.tokenBalances || []) {
    if (t?.family === 'external_unclassified') continue;
    const trackingStatus = normalizeTrackingStatus(t.trackingStatus);
    if (t?.countedInWalletTotal === false && trackingStatus === "protocol_reader_covered") continue;
    const usd = Number(t.estimatedUsd);
    const amt = Number(t.actualDecimal);
    if (!Number.isFinite(amt) || amt === 0) continue;
    out.push(normalizeHoldingItem({
      sym: normaliseTicker(t.ticker || t.symbol),
      name: t.ticker || t.symbol || '',
      chain: normaliseChain(t.chain),
      amount: amt,
      usd: Number.isFinite(usd) ? usd : null,
      family: 'token',
      token: t.token || null,
      trackingStatus,
      valuation: t.valuation || null,
      source: 'whole_wallet_inventory',
      sourceObservedAt: t.observedAt || inventoryObservedAt,
      priceSource: t.priceSource || inv.priceSource || null,
      priceObservedAt: t.priceObservedAt || t.valuation?.observedAt || t.observedAt || inventoryObservedAt,
      priceFreshness: t.priceFreshness || null,
      priceDivergenceStatus: t.priceDivergenceStatus || null,
      freshness: t.freshness || null,
      confidence: t.confidence || null,
      countedInWalletTotal: t.countedInWalletTotal !== false,
    }, { inventoryObservedAt, nowIso }));
  }
  for (const p of inv.protocolPositions || []) {
    const usd = Number(p.estimatedUsd ?? p.usdValue);
    const amt = Number(p.actualDecimal);
    if (!Number.isFinite(amt) || amt === 0) continue;
    out.push(normalizeHoldingItem({
      sym: normaliseTicker(p.symbol),
      name: p.symbol || p.positionId || '',
      chain: normaliseChain(p.chain),
      amount: amt,
      usd: Number.isFinite(usd) ? usd : null,
      family: 'protocol',
      protocolId: p.protocolId || null,
      positionId: p.positionId || null,
      bindingKind: p.bindingKind || null,
      confidence: p.confidence || null,
      freshness: p.freshness || null,
      source: 'whole_wallet_inventory',
      sourceObservedAt: p.observedAt || p.markObservedAt || inventoryObservedAt,
      priceSource: p.priceSource || p.markSource || null,
      priceObservedAt: p.priceObservedAt || p.markObservedAt || p.observedAt || inventoryObservedAt,
      priceFreshness: p.priceFreshness || p.markFreshness || p.freshness || null,
      priceDivergenceStatus: p.priceDivergenceStatus || null,
      countedInWalletTotal: false,
    }, { inventoryObservedAt, nowIso }));
  }
  // Sort richest first, then stable tie-break on sym/chain.
  out.sort((a, b) => (b.usd || 0) - (a.usd || 0) || String(a.sym).localeCompare(String(b.sym)));
  return out;
}

function countDoubleCountPrevented(inv = {}) {
  return (inv.tokenBalances || []).filter((token) =>
    token?.countedInWalletTotal === false &&
    /protocol_reader_covered|protocol_position/u.test(String(token?.trackingStatus || "")),
  ).length;
}

function itemIsStale(item = {}) {
  return ["stale", "expired", "failed"].includes(String(item.freshness || "").toLowerCase());
}

function itemPriceIsStale(item = {}) {
  return ["stale", "expired", "failed"].includes(String(item.priceFreshness || "").toLowerCase());
}

function oldestMaterialObservedAt(items = []) {
  const observed = items
    .filter((item) => Number(item.usd || 0) > 0)
    .map((item) => item.sourceObservedAt)
    .filter(Boolean)
    .sort();
  return observed[0] || null;
}

export function buildScanErrors(inv) {
  return Array.isArray(inv?.scanErrors)
    ? inv.scanErrors.filter((error) => error?.kind !== 'external_portfolio').map((error) => ({
        kind: error?.kind || null,
        provider: error?.provider || null,
        chain: normaliseChain(error?.chain),
        token: error?.token || null,
        message: error?.message || null,
      }))
    : [];
}

export function latestExternalCoverage(records = [], inv = null) {
  const currentWalletUsd = finiteNumber(inv?.summary?.externalWalletUsd);
  if (Number.isFinite(currentWalletUsd)) {
    return {
      walletUsd: currentWalletUsd,
      totalPortfolioUsd: finiteNumber(inv.summary?.externalTotalPortfolioUsd),
      unclassifiedUsd: finiteNumber(inv.summary?.externalUnclassifiedUsd),
      provider: inv.summary?.externalProvider || null,
      observedAt: inv.observedAt || null,
      stale: false,
    };
  }
  void records;
  return null;
}

export function buildWalletHoldingsPayload({
  inventoryRecords,
  wrappedBtcLoopSlice = null,
  recursiveWrappedBtcLoopScaffold = null,
  now = new Date(),
} = {}) {
  const inv = Array.isArray(inventoryRecords) ? inventoryRecords.at(-1) : null;
  const protocolApr = buildProtocolAprSlice({
    wrappedBtcLoopSlice,
    recursiveWrappedBtcLoopScaffold,
  });
  if (!inv) {
    return {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      pending: true,
      reason: 'whole-wallet-inventory.jsonl missing or empty',
      address: null,
      totalUsd: null,
      items: [],
      protocolApr,
    };
  }

  const items = buildItems(inv, { now });
  const scanErrors = buildScanErrors(inv);
  const coverage = latestExternalCoverage(inventoryRecords, inv);
  const walletCoverage = coverage
    ? coverage.stale ? 'full_external_stale' : 'full_external'
    : inv.summary?.walletCoverage || 'partial_supported';
  const tokenUsd = finiteNumber(inv.totals?.tokenUsd);
  const protocolUsd = finiteNumber(inv.totals?.protocolUsd);
  const totalUsd = finiteNumber(inv.totals?.totalUsd)
    ?? items.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  const doubleCountPreventedCount = countDoubleCountPrevented(inv);
  const staleItemCount = items.filter(itemIsStale).length;
  const stalePriceItemCount = items.filter(itemPriceIsStale).length;
  const priceSourceCoverageCount = items.filter((item) => item.priceSource && item.priceSource.type !== "missing").length;
  const freshnessCoverageCount = items.filter((item) => item.freshness && item.confidence && item.priceFreshness).length;
  const divergenceWarnCount = items.filter((item) => item.priceDivergenceStatus === "warn").length;
  const divergenceBlockCount = items.filter((item) => item.priceDivergenceStatus === "block").length;
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    observedAt: inv.observedAt || null,
    pending: items.length === 0,
    address: inv.address || null,
    totalUsd,
    walletUsd: tokenUsd,
    protocolUsd,
    protocolStaleUsd: finiteNumber(inv.totals?.protocolStaleUsd),
    totals: {
      freeWalletUsd: tokenUsd,
      protocolUsd,
      staleProtocolUsd: finiteNumber(inv.totals?.protocolStaleUsd),
      unknownUsd: finiteNumber(inv.totals?.unknownUsd ?? inv.summary?.unknownAssetUsd),
      reconciledTotalUsd: totalUsd,
    },
    items,
    protocolApr,
    source: 'whole_wallet_inventory',
    scanErrorCount: scanErrors.length,
    scanErrors,
    itemizedSupportedWalletUsd: finiteNumber(inv.summary?.itemizedWalletUsd),
    walletCoverage,
    fullWalletUsd: coverage?.walletUsd ?? null,
    fullWalletObservedAt: coverage?.observedAt ?? null,
    fullWalletProvider: coverage?.provider ?? null,
    fullWalletStale: coverage?.stale === true,
    externalWalletUsd: coverage?.walletUsd ?? null,
    externalTotalPortfolioUsd: coverage?.totalPortfolioUsd ?? null,
    unclassifiedUsd: coverage?.unclassifiedUsd ?? null,
    assetUniverse: inv.assetUniverse || null,
    unknownAssetBalanceCount: Number(inv.summary?.unknownAssetBalanceCount || 0),
    unknownAssetBalances: Array.isArray(inv.unknownAssetBalances) ? inv.unknownAssetBalances : [],
    staleItemCount,
    stalePriceItemCount,
    assetMetadataCoverage: {
      totalAssetCount: items.length,
      freshnessCoveragePct: items.length > 0 ? freshnessCoverageCount / items.length : 1,
      priceSourceCoveragePct: items.length > 0 ? priceSourceCoverageCount / items.length : 1,
      divergenceWarnCount,
      divergenceBlockCount,
      missingPriceSourceCount: items.length - priceSourceCoverageCount,
    },
    failedProtocolMarkCount: items.filter((item) => item.family === 'protocol' && item.freshness === 'failed').length,
    doubleCountPreventedCount,
    oldestMaterialSourceObservedAt: oldestMaterialObservedAt(items),
  };
}

export async function main() {
  const argv = process.argv.slice(2);
  const options = optionMapFromArgs(argv);
  const outputPath = path.resolve(ROOT, dashboardJsonOutputPath('wallet-holdings.json', {
    options,
    commitPublic: hasFlag(argv, '--commit-public'),
  }));
  const inventoryRecords = await readJsonlRecords(INVENTORY_PATH);
  const [wrappedBtcLoopSlice, recursiveWrappedBtcLoopScaffold] = await Promise.all([
    readJsonIfExists(WRAPPED_BTC_LOOP_SLICE_PATH),
    readJsonIfExists(RECURSIVE_WRAPPED_BTC_LOOP_SCAFFOLD_PATH),
  ]);
  const payload = buildWalletHoldingsPayload({
    inventoryRecords,
    wrappedBtcLoopSlice,
    recursiveWrappedBtcLoopScaffold,
    now: new Date(),
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    ok: true,
    pending: payload.pending,
    itemCount: payload.items.length,
    totalUsd: payload.totalUsd,
    out: path.relative(ROOT, outputPath),
  }) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(err => {
    process.stderr.write(`[report-wallet-holdings-slice] ${err?.stack || err}\n`);
    process.exit(1);
  });
}
