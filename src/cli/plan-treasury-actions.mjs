#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateTreasuryPolicy, buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildTreasuryPlan } from "../treasury/planner.mjs";

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
    address: options.address || config.estimateFrom,
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
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  const inventory = await scanTreasuryInventory({ policy, address: args.address, prices });
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
      address: args.address,
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
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`decision=${plan.decision}`);
  if (plan.reasons.length) {
    console.log(`reasons=${plan.reasons.join(",")}`);
  }
  console.log(`refillEstimatedUsd=${plan.summary.refillEstimatedUsd.toFixed(4)}`);
  console.log(`estimatedWalletUsd=${plan.summary.estimatedWalletUsd.toFixed(4)}`);

  for (const action of plan.actions) {
    console.log(
      `${action.type} ${action.chain} ${action.asset || action.ticker} amount=${action.refillAmountDecimal} estimatedUsd=${action.refillEstimatedUsd ?? "n/a"}`,
    );
  }
  for (const blocker of plan.blockers) {
    console.log(`blocker ${blocker.type} ${blocker.chain} ${blocker.asset || blocker.ticker || blocker.spender}`);
  }
  for (const item of plan.observations) {
    console.log(`observe ${item.type} ${item.chain} ${item.asset || item.ticker || item.spender}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
