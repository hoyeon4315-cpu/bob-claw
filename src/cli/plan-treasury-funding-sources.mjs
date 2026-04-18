#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateTreasuryPolicy, buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildTreasuryPlan } from "../treasury/planner.mjs";
import { buildFundingSourcePlan } from "../treasury/funding-source-planner.mjs";
import { buildTreasuryRouteDemand, selectFundingRouteContext } from "../treasury/route-demand.mjs";
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
  const [quotes, readinessRecords, readinessFailures, scoreSnapshot] = await Promise.all([
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
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
  const fundingSourcePlan = buildFundingSourcePlan({ plan, policy, routeContext });

  if (args.json) {
    console.log(JSON.stringify({
      ...fundingSourcePlan,
      inventorySource: !args.refreshInventory && context.inventorySnapshot ? "stored_snapshot" : "live_scan",
    }, null, 2));
    return;
  }

  console.log(`decision=${fundingSourcePlan.decision}`);
  console.log(`inventorySource=${!args.refreshInventory && context.inventorySnapshot ? "stored_snapshot" : "live_scan"}`);
  if (fundingSourcePlan.routeContext?.routeKey) {
    console.log(`routeKey=${fundingSourcePlan.routeContext.routeKey}`);
  }
  if (fundingSourcePlan.reasons.length) {
    console.log(`reasons=${fundingSourcePlan.reasons.join(",")}`);
  }
  console.log(`selectionCount=${fundingSourcePlan.summary.selectionCount}`);
  console.log(
    `executionRefillExpectedCostUsd=${Number.isFinite(fundingSourcePlan.summary.executionRefillExpectedCostUsd) ? fundingSourcePlan.summary.executionRefillExpectedCostUsd.toFixed(4) : "n/a"}`,
  );
  console.log(
    `effectiveSystemNetPnlUsd=${Number.isFinite(fundingSourcePlan.summary.effectiveSystemNetPnlUsd) ? fundingSourcePlan.summary.effectiveSystemNetPnlUsd.toFixed(4) : "n/a"}`,
  );

  for (const selection of fundingSourcePlan.selections) {
    console.log(
      `${selection.resourceKey} method=${selection.selectedMethod} status=${selection.selectionStatus} costUsd=${selection.expectedExecutionRefillCostUsd ?? "n/a"}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
