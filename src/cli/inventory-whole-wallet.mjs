#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { scanWholeWalletInventory } from "../treasury/whole-wallet-scan.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";

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
    families: options.families ? options.families.split(",").map((item) => item.trim()).filter(Boolean) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  const inventory = await scanWholeWalletInventory({
    address: resolved.address,
    prices,
    chains: policy.supportedChains,
    families: args.families,
  });
  const store = new JsonlStore(config.dataDir);
  await store.append("whole-wallet-inventory", inventory);

  if (args.json) {
    console.log(JSON.stringify(inventory, null, 2));
    return;
  }

  console.log(`address=${inventory.address}`);
  console.log(`totalUsd=${inventory.totalUsd.toFixed(4)}`);
  console.log(`native=${inventory.summary.nativeCount} tokens=${inventory.summary.tokenCount} scanErrors=${inventory.summary.scanErrorCount}`);
  for (const item of [...inventory.native, ...inventory.tokenBalances].slice(0, 12)) {
    console.log(`${item.chain} ${item.ticker}=${item.actualDecimal} usd=${item.estimatedUsd ?? "n/a"}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
