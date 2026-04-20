#!/usr/bin/env node

import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { buildTreasuryRouteDemand, selectFundingRouteContext } from "../treasury/route-demand.mjs";
import { latestWholeWalletInventoryForAddress } from "../treasury/whole-wallet-scan.mjs";
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

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
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
  const strategyCaps = listStrategyCaps({ includeInactive: args.includeInactive }) || [];
  const treasuryInventory =
    !args.refreshInventory && context.inventorySnapshot
      ? context.inventorySnapshot
      : await scanTreasuryInventory({ policy, address: resolved.address, prices });

  const [quotes, readinessRecords, readinessFailures, scoreSnapshot, wholeWalletInventoryRecords] = await Promise.all([
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    readJsonl(config.dataDir, "whole-wallet-inventory").catch(() => []),
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
  const wholeWalletInventory = latestWholeWalletInventoryForAddress(wholeWalletInventoryRecords, resolved.address);

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
      inventorySource: !args.refreshInventory && context.inventorySnapshot ? "stored_snapshot" : "live_scan",
      routeDemandSignalCount: (routeDemand?.signals || []).length,
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
