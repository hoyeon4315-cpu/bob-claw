#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { buildEstimatorFundingPlan } from "../estimator/funding-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";

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

function formatDecimal(value, ticker) {
  if (!Number.isFinite(value)) return `unknown ${ticker}`;
  if (value === 0) return `0 ${ticker}`;
  if (value >= 1000) return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${ticker}`;
  if (value >= 1) return `${value.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${ticker}`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 12 })} ${ticker}`;
}

function printChain(chainPlan) {
  console.log("");
  console.log(`${chainPlan.chain} (${chainPlan.nativeSymbol})`);
  if (chainPlan.native) {
    const native = chainPlan.native;
    console.log(
      `  native shortfall=${formatDecimal(native.shortfallDecimal, chainPlan.nativeSymbol)} required=${formatDecimal(native.requiredDecimal, chainPlan.nativeSymbol)} actual=${formatDecimal(native.actualDecimal, chainPlan.nativeSymbol)}`,
    );
  }
  for (const token of chainPlan.tokens) {
    console.log(
      `  token ${token.ticker} shortfall=${formatDecimal(token.shortfallDecimal, token.ticker)} required=${formatDecimal(token.requiredDecimal, token.ticker)} actual=${formatDecimal(token.actualDecimal, token.ticker)}`,
    );
  }
  for (const allowance of chainPlan.allowances) {
    console.log(
      `  allowance ${allowance.ticker} spender=${allowance.spender} shortfall=${formatDecimal(allowance.shortfallDecimal, allowance.ticker)} required=${formatDecimal(allowance.requiredDecimal, allowance.ticker)} actual=${formatDecimal(allowance.actualDecimal, allowance.ticker)}`,
    );
  }
  for (const route of chainPlan.routes.slice(0, 5)) {
    console.log(
      `  route ${route.routeKey} amount=${route.amount} status=${route.overallReady ? "ready" : route.blockers.join("+") || "ready"}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [readinessRecords, readinessFailures] = await Promise.all([
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
  ]);
  const plan = buildEstimatorFundingPlan({ readinessRecords, readinessFailures }, { address: args.address });

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`address=${plan.address}`);
  console.log(`walletCheckedRoutes=${plan.routeCount} ready=${plan.readyRouteCount} blocked=${plan.blockedRouteCount} skipped=${plan.skippedRouteCount}`);
  if (plan.failureReasons.length) {
    console.log(`skippedReasons=${plan.failureReasons.map((item) => `${item.reason}:${item.count}`).join(",")}`);
  }
  for (const chainPlan of plan.chains) {
    printChain(chainPlan);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
