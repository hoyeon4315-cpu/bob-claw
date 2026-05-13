#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { resolveShadowCycleContext } from "../session/shadow-cycle-context.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";

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
    address: options.address || null,
  };
}

function formatDecimal(value, ticker) {
  if (!Number.isFinite(value)) return `unknown ${ticker}`;
  if (value === 0) return `0 ${ticker}`;
  if (value >= 1) return `${value.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${ticker}`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 12 })} ${ticker}`;
}

function inventorySourceLabel(inventory = {}) {
  if (!inventory.scanErrors?.length) return "live_scan";
  const usedFallback = [...(inventory.native || []), ...(inventory.tokens || []), ...(inventory.allowances || [])].some(
    (item) => item.staleFallback === true,
  );
  return usedFallback ? "live_scan_with_stale_fallback" : "live_scan_with_errors";
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
  const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  const inventory = await scanTreasuryInventory({
    policy,
    address: resolved.address,
    prices,
    continueOnError: true,
    fallbackInventory: context.inventorySnapshot,
  });
  const store = new JsonlStore(config.dataDir);
  await store.append("treasury-inventory", inventory);

  if (args.json) {
    console.log(JSON.stringify(inventory, null, 2));
    return;
  }

  console.log(`address=${inventory.address}`);
  console.log(`inventorySource=${inventorySourceLabel(inventory)}`);
  console.log(
    `supportedChains=${inventory.summary.supportedChainCount} activeChains=${inventory.summary.activeChainCount}`,
  );
  console.log(
    `nativeRefillRequired=${inventory.summary.nativeRefillRequiredCount} tokenRefillRequired=${inventory.summary.tokenRefillRequiredCount} allowanceOverCap=${inventory.summary.allowanceOverCapCount}`,
  );
  console.log(`scanErrors=${inventory.summary.scanErrorCount}`);
  console.log(`estimatedWalletUsd=${inventory.summary.estimatedWalletUsd.toFixed(4)}`);

  for (const item of inventory.native.filter((entry) => entry.active || entry.actual !== "0")) {
    console.log(
      `${item.chain} native=${formatDecimal(item.actualDecimal, item.asset)} status=${item.status} target=${item.targetBalanceDecimal}`,
    );
  }

  for (const item of inventory.tokens) {
    console.log(
      `${item.chain} ${item.ticker}=${formatDecimal(item.actualDecimal, item.ticker)} status=${item.status} target=${item.targetBalanceDecimal}`,
    );
  }

  for (const item of inventory.allowances) {
    console.log(
      `${item.chain} allowance ${item.ticker} spender=${item.spender} status=${item.status} cap=${item.maxApprovalDecimal}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
