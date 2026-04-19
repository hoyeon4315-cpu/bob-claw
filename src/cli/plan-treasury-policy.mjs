#!/usr/bin/env node

import {
  buildDefaultTreasuryPolicy,
  getNativeBalancePolicy,
  validateTreasuryPolicy,
} from "../treasury/policy.mjs";

function parseArgs(argv) {
  return {
    json: new Set(argv).has("--json"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());

  if (args.json) {
    console.log(JSON.stringify(policy, null, 2));
    return;
  }

  console.log(`schemaVersion=${policy.schemaVersion}`);
  console.log(`activeBudgetUsd=${policy.capital.activeBudgetUsd ?? "n/a"}`);
  console.log(`referenceBudgetUsd=${policy.capital.referenceBudgetUsd ?? "n/a"}`);
  console.log(`activeChains=${policy.activeChains.join(",")}`);

  for (const chain of policy.activeChains) {
    const item = getNativeBalancePolicy(policy, chain);
    if (!item) continue;
    console.log(
      [
        `${chain}`,
        `asset=${item.asset}`,
        `min=${item.minBalance}`,
        `target=${item.targetBalance}`,
        `max=${item.maxBalance}`,
      ].join(" "),
    );
  }

  for (const item of policy.tokenInventories ?? []) {
    console.log(
      [
        `${item.chain}`,
        `token=${item.ticker}`,
        `min=${item.minBalance}`,
        `target=${item.targetBalance}`,
        `max=${item.maxBalance}`,
      ].join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
