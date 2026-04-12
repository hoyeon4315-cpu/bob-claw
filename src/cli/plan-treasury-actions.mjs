#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateTreasuryPolicy, buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildTreasuryPlan } from "../treasury/planner.mjs";
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

export function formatPlanValue(value, { digits = null, fallback = "n/a" } = {}) {
  if (!Number.isFinite(value)) return fallback;
  return Number.isInteger(digits) && digits >= 0 ? value.toFixed(digits) : String(value);
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

  const routeDemand = routePlan.topCandidates
    .filter((item) => item.viableForPrep)
    .flatMap((item) => [
      { chain: item.srcChain },
      { chain: item.srcChain, token: item.routeKey.split(":")[1]?.split("->")[0] || null },
    ]);

  const plan = buildTreasuryPlan({ policy, inventory, routeDemand });

  if (args.json) {
    console.log(JSON.stringify({
      ...plan,
      inventorySource: !args.refreshInventory && context.inventorySnapshot ? "stored_snapshot" : "live_scan",
    }, null, 2));
    return;
  }

  console.log(`decision=${plan.decision}`);
  if (plan.reasons.length) {
    console.log(`reasons=${plan.reasons.join(",")}`);
  }
  console.log(`inventorySource=${!args.refreshInventory && context.inventorySnapshot ? "stored_snapshot" : "live_scan"}`);
  console.log(`refillEstimatedUsd=${formatPlanValue(plan.summary.refillEstimatedUsd, { digits: 4 })}`);
  console.log(`estimatedWalletUsd=${formatPlanValue(plan.summary.estimatedWalletUsd, { digits: 4 })}`);

  for (const action of plan.actions) {
    console.log(
      `${action.type} ${action.chain} ${action.asset || action.ticker} amount=${formatPlanValue(action.refillAmountDecimal)} estimatedUsd=${formatPlanValue(action.refillEstimatedUsd, { digits: 4 })}`,
    );
  }
  for (const blocker of plan.blockers) {
    console.log(`blocker ${blocker.type} ${blocker.chain} ${blocker.asset || blocker.ticker || blocker.spender}`);
  }
  for (const item of plan.observations) {
    console.log(`observe ${item.type} ${item.chain} ${item.asset || item.ticker || item.spender}`);
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
