#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateTreasuryPolicy, buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildTreasuryPlan } from "../treasury/planner.mjs";
import { buildFundingSourcePlan } from "../treasury/funding-source-planner.mjs";
import { buildTreasuryRefillJobs } from "../treasury/refill-job.mjs";
import { buildTreasuryRouteDemand, selectFundingRouteContext } from "../treasury/route-demand.mjs";
import { latestWholeWalletInventoryForAddress } from "../treasury/whole-wallet-scan.mjs";
import { resolveShadowCycleContext } from "../session/shadow-cycle-context.mjs";

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
    refreshInventory: flags.has("--refresh-inventory"),
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
  const inventory =
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

  const routeDemand = buildTreasuryRouteDemand({ routePlan, inventory, policy });

  const plan = buildTreasuryPlan({ policy, inventory, routeDemand });
  const routeContext = selectFundingRouteContext(routePlan);
  const supplementalInventory = latestWholeWalletInventoryForAddress(wholeWalletInventoryRecords, resolved.address);
  const fundingSourcePlan = buildFundingSourcePlan({ plan, policy, routeContext, supplementalInventory });
  const jobs = buildTreasuryRefillJobs({ plan, policy, fundingSourcePlan, routeCandidates: routePlan.candidates || [] });
  const store = new JsonlStore(config.dataDir);
  for (const job of jobs.jobs) {
    await store.append("treasury-refill-jobs", job);
  }

  if (args.json) {
    console.log(JSON.stringify({
      ...jobs,
      inventorySource: !args.refreshInventory && context.inventorySnapshot ? "stored_snapshot" : "live_scan",
    }, null, 2));
    return;
  }

  console.log(`decision=${jobs.decision}`);
  console.log(`inventorySource=${!args.refreshInventory && context.inventorySnapshot ? "stored_snapshot" : "live_scan"}`);
  console.log(`requiresManualReview=${jobs.requiresManualReview}`);
  console.log(`jobCount=${jobs.summary.jobCount}`);
  console.log(`estimatedAssetValueUsd=${jobs.summary.estimatedAssetValueUsd.toFixed(4)}`);
  for (const job of jobs.jobs) {
    console.log(`${job.jobId} ${job.type} ${job.chain} ${job.asset} amount=${job.targetAmountDecimal} method=${job.executionMethod}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
