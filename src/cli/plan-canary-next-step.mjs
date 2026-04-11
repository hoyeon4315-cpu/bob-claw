#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";

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

function formatAmount(value, ticker) {
  if (!Number.isFinite(value)) return `unknown ${ticker}`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value >= 1 ? 6 : 12 })} ${ticker}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { nextStep: next } = await loadCanaryState({ address: args.address, dataDir: config.dataDir });

  if (args.json) {
    console.log(JSON.stringify(next, null, 2));
    return;
  }

  console.log(`decision=${next.decision}`);
  console.log(next.headline);
  if (next.route) {
    console.log(`route=${next.route.label} amount=${next.route.amount}`);
  }
  if (next.reasons?.length) {
    console.log(`reasons=${next.reasons.join(",")}`);
  }
  for (const action of next.actions || []) {
    if (action.type === "fund_native") {
      console.log(`action fund ${formatAmount(action.shortfallDecimal, action.ticker)} on ${action.chain}`);
    } else if (action.type === "fund_token") {
      console.log(`action fund ${formatAmount(action.shortfallDecimal, action.ticker)} on ${action.chain}`);
    } else if (action.type === "approve_allowance") {
      console.log(`action approve ${formatAmount(action.shortfallDecimal, action.ticker)} for spender ${action.spender} on ${action.chain}`);
    } else if (action.type === "estimate_exact_gas") {
      console.log(`action run exact gas for ${action.chain} ${action.routeKey} amount=${action.amount}`);
    } else if (action.type === "rerun_scoring") {
      console.log(`action rerun scoring for ${action.routeKey} amount=${action.amount}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
