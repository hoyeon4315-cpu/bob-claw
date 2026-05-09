#!/usr/bin/env node

import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import {
  emptyPricesUsd,
  getCoinGeckoPricesUsd,
  latestPriceSnapshot,
  overlayObservedPricesUsd,
  pricesFromSnapshot,
} from "../market/prices.mjs";
import { ZERO_TOKEN, tokenAsset } from "../assets/tokens.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildDefaultTreasuryPolicy, decimalToUnits, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { buildTreasuryRouteDemand, selectFundingRouteContext } from "../treasury/route-demand.mjs";
import { knownWholeWalletTokenTargets, latestWholeWalletInventoryForAddress } from "../treasury/whole-wallet-scan.mjs";
import { buildCapitalManagerRefillJobs } from "../executor/capital/rebalancer.mjs";
import { resolveShadowCycleContext } from "../session/shadow-cycle-context.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

export function parseArgs(argv) {
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
    write: flags.has("--write"),
    refreshInventory: flags.has("--refresh-inventory"),
    includeInactive: flags.has("--include-inactive"),
    address: options.address || null,
  };
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
  };
}

export async function resolveCapitalManagerTreasuryInventory({
  refreshInventory = false,
  context = {},
  policy,
  address,
  prices,
  scanInventory = scanTreasuryInventory,
} = {}) {
  if (!refreshInventory && context.inventorySnapshot) {
    return {
      treasuryInventory: context.inventorySnapshot,
      inventorySource: "stored_snapshot",
      inventoryRefreshError: null,
    };
  }

  const fallbackInventory = context.inventorySnapshot || null;
  try {
    const treasuryInventory = await scanInventory({
      policy,
      address,
      prices,
      continueOnError: Boolean(fallbackInventory),
      fallbackInventory,
    });
    return {
      treasuryInventory,
      inventorySource: refreshInventory ? "live_scan" : "live_scan",
      inventoryRefreshError: null,
    };
  } catch (error) {
    if (!fallbackInventory) throw error;
    return {
      treasuryInventory: fallbackInventory,
      inventorySource: "stored_snapshot_fallback",
      inventoryRefreshError: serializeError(error),
    };
  }
}

export async function resolveCapitalManagerPrices({
  dataDir = config.dataDir,
  livePriceReader = getCoinGeckoPricesUsd,
  readJsonlImpl = readJsonl,
} = {}) {
  const [livePrices, priceSnapshots, gasSnapshots, bitcoinFeeSnapshots] = await Promise.all([
    livePriceReader().catch(() => emptyPricesUsd()),
    readJsonlImpl(dataDir, "market-price-snapshots").catch(() => []),
    readJsonlImpl(dataDir, "gas-snapshots").catch(() => []),
    readJsonlImpl(dataDir, "bitcoin-fee-snapshots").catch(() => []),
  ]);
  const observedSnapshot = latestPriceSnapshot(priceSnapshots);
  const observedPrices = observedSnapshot ? pricesFromSnapshot(observedSnapshot) : livePrices;
  return overlayObservedPricesUsd(observedPrices, { gasSnapshots, bitcoinFeeSnapshots });
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeAssetName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unitsFromActualDecimal(amount, decimals) {
  if (!Number.isFinite(amount) || !Number.isInteger(decimals) || decimals < 0) return null;
  const precision = Math.min(decimals, 18);
  return decimalToUnits(Number(amount).toFixed(precision), decimals).toString();
}

function resolveDashboardWalletItemToken(chain, item = {}) {
  if (item.family === "native") return ZERO_TOKEN;
  const targets = new Set([
    normalizeAssetName(item.name),
    normalizeAssetName(item.sym),
  ].filter(Boolean));
  for (const definition of knownWholeWalletTokenTargets({ chain })) {
    const asset = tokenAsset(chain, definition.token);
    const labels = new Set([
      normalizeAssetName(definition.ticker),
      normalizeAssetName(asset.ticker),
    ].filter(Boolean));
    if ([...targets].some((label) => labels.has(label))) {
      return definition.token;
    }
  }
  return null;
}

function dashboardWalletInventoryFromStatus(dashboardStatus = null) {
  const items = Array.isArray(dashboardStatus?.capitalSummary?.walletItems)
    ? dashboardStatus.capitalSummary.walletItems
    : [];
  const native = [];
  const tokenBalances = [];
  for (const item of items) {
    if (!item?.chain || !Number.isFinite(item.amount) || !Number.isFinite(item.usd)) continue;
    const token = resolveDashboardWalletItemToken(item.chain, item);
    if (!token) continue;
    const asset = tokenAsset(item.chain, token);
    const entry = {
      chain: item.chain,
      token,
      ticker: asset.ticker,
      balance: unitsFromActualDecimal(item.amount, asset.decimals),
      actualDecimal: item.amount,
      estimatedUsd: item.usd,
      source: "dashboard_status_snapshot",
    };
    if (token === ZERO_TOKEN) native.push(entry);
    else tokenBalances.push(entry);
  }
  return { native, tokenBalances };
}

function mergeWholeWalletSources(primary = null, dashboard = null) {
  return {
    ...(primary || {}),
    native: [...(primary?.native || []), ...(dashboard?.native || [])],
    tokenBalances: [...(primary?.tokenBalances || []), ...(dashboard?.tokenBalances || [])],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  const context = await resolveShadowCycleContext({
    dataDir: config.dataDir,
    explicitAddress: resolved.address,
    configuredAddress: config.estimateFrom,
  });
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const prices = await resolveCapitalManagerPrices({ dataDir: config.dataDir });
  const strategyCaps = listStrategyCaps({ includeInactive: args.includeInactive }) || [];
  const {
    treasuryInventory,
    inventorySource,
    inventoryRefreshError,
  } = await resolveCapitalManagerTreasuryInventory({
    refreshInventory: args.refreshInventory,
    context,
    policy,
    address: resolved.address,
    prices,
  });

  const [quotes, readinessRecords, readinessFailures, scoreSnapshot, wholeWalletInventoryRecords, bootstrapSnapshot, dashboardStatus] = await Promise.all([
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    readJsonl(config.dataDir, "whole-wallet-inventory").catch(() => []),
    readJsonIfExists(join(config.dataDir, "bootstrap-from-btc.json")),
    readJsonIfExists(resolve("dashboard/public/dashboard-status.json")),
  ]);

  const routePlan = buildCanaryRoutePlan(
    {
      quotes,
      scores: scoreSnapshot?.scores || [],
      readinessRecords,
      readinessFailures,
    },
    {
      address: resolved.address,
      prices,
      limit: 5,
    },
  );
  const routeDemand = buildTreasuryRouteDemand({ routePlan, inventory: treasuryInventory, policy });
  const routeContext = selectFundingRouteContext(routePlan);
  const wholeWalletInventory = mergeWholeWalletSources(
    latestWholeWalletInventoryForAddress(wholeWalletInventoryRecords, resolved.address),
    dashboardWalletInventoryFromStatus(dashboardStatus),
  );

  const result = buildCapitalManagerRefillJobs({
    strategyCaps,
    policy,
    treasuryInventory,
    wholeWalletInventory,
    prices,
    address: resolved.address,
    routeContext,
    routeCandidates: routePlan.candidates || [],
    supplementalInventory: wholeWalletInventory,
    scoredTargets: bootstrapSnapshot?.scoredTargets || null,
  });

  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "capital-manager-refill-jobs-latest.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const store = new JsonlStore(config.dataDir);
    for (const job of result.jobs.jobs || []) {
      await store.append("capital-manager-refill-jobs", job);
    }
  }

  if (args.json) {
    console.log(JSON.stringify({
      ...result,
      inventorySource,
        inventoryRefreshError,
        routeDemandSignalCount: (routeDemand?.signals || []).length,
        bootstrapObservedAt: bootstrapSnapshot?.generatedAt || null,
      }, null, 2));
    return;
  }

  console.log(`observedAt=${result.observedAt}`);
  console.log(`strategyCapCount=${strategyCaps.length}`);
  console.log(`rebalanceDecision=${result.rebalancePlan.decision}`);
  console.log(`jobCount=${result.jobs.summary.jobCount}`);
  console.log(`requiresManualReview=${result.jobs.requiresManualReview}`);
  console.log(`estimatedAssetValueUsd=${result.jobs.summary.estimatedAssetValueUsd.toFixed(4)}`);
  for (const job of result.jobs.jobs || []) {
    console.log(
      `${job.jobId} ${job.type} ${job.chain} ${job.asset} amount=${job.targetAmountDecimal} method=${job.executionMethod}`,
    );
  }
}

const entrypointHref = process.argv[1] ? new URL(`file://${resolve(process.argv[1])}`).href : null;
if (entrypointHref && import.meta.url === entrypointHref) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
