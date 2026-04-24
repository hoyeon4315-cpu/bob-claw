#!/usr/bin/env node

/**
 * dry-run-policy-evaluation.mjs
 *
 * Given a strategyId and a mock intent shape, runs evaluateIntentPolicies
 * and prints the verdict. Proves that the policy gate is open for each
 * newly activated strategy without spending capital.
 *
 * Usage:
 *   node src/cli/dry-run-policy-evaluation.mjs \
 *     --strategy=wrapped-btc-loop-base-moonwell \
 *     --amount-usd=5 \
 *     --chain=base \
 *     --intent-type=aave_supply
 */

import { evaluateIntentPolicies } from "../executor/policy/index.mjs";

function parseArgs(argv) {
  const out = { strategyId: null, amountUsd: 5, chain: "base", intentType: "aave_supply" };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === "strategy") out.strategyId = m[2];
    if (m[1] === "amount-usd") out.amountUsd = Number(m[2]);
    if (m[1] === "chain") out.chain = m[2];
    if (m[1] === "intent-type") out.intentType = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.strategyId) {
    console.error("ERR: --strategy=<id> required");
    process.exit(2);
  }

  const intent = {
    strategyId: args.strategyId,
    chain: args.chain,
    intentType: args.intentType,
    amountUsd: args.amountUsd,
    family: "evm",
    observedAt: new Date().toISOString(),
    metadata: {
      protocol: "moonwell",
      skipAutoIngest: false,
    },
  };

  const policy = await evaluateIntentPolicies({ intent, auditRecords: [] });

  console.log(JSON.stringify({
    strategyId: args.strategyId,
    decision: policy.decision,
    blockers: policy.blockers,
    requiresUnwind: policy.requiresUnwind,
    results: policy.results.map((r) => ({
      policy: r.policy,
      decision: r.decision,
      blockers: r.blockers,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
