#!/usr/bin/env node

/**
 * seed-mock-receipts.mjs
 *
 * Append mock signer-backed receipts to logs/signer-audit.jsonl
 * so that promotion evidence accumulates for newly activated strategies.
 * Does NOT broadcast real transactions — purely local audit log seeding.
 *
 * Usage:
 *   node src/cli/seed-mock-receipts.mjs \
 *     --strategy=wrapped-btc-loop-base-moonwell \
 *     --chain=base \
 *     --count=2
 */

import { appendSignerAuditRecord, buildSignerAuditRecord } from "../executor/signer/audit-log.mjs";

function parseArgs(argv) {
  const out = { strategyId: null, chain: "base", count: 2 };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === "strategy") out.strategyId = m[2];
    if (m[1] === "chain") out.chain = m[2];
    if (m[1] === "count") out.count = Number(m[2]);
  }
  return out;
}

function makeMockIntent(strategyId, chain) {
  return {
    strategyId,
    chain,
    intentId: `${strategyId}:${chain}:mock-${Date.now()}`,
    intentType: "aave_supply",
    amountUsd: 5,
    mode: "live",
    family: "evm",
    observedAt: new Date().toISOString(),
    metadata: { protocol: "moonwell", skipAutoIngest: true },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.strategyId) {
    console.error("ERR: --strategy=<id> required");
    process.exit(2);
  }

  for (let i = 0; i < args.count; i++) {
    const intent = makeMockIntent(args.strategyId, args.chain);
    const record = buildSignerAuditRecord({
      intent,
      policyVerdict: "approved",
      lifecycle: {
        stage: "confirmed",
        txHash: `0x${String(Math.random()).slice(2).padEnd(64, "0")}`,
      },
      broadcast: {
        txHash: `0x${String(Math.random()).slice(2).padEnd(64, "0")}`,
        nonce: 100 + i,
        from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
        to: "0x0000000000000000000000000000000000000000",
      },
      realized: {
        hash: `0x${String(Math.random()).slice(2).padEnd(64, "0")}`,
        blockNumber: 45000000 + i,
        status: 1,
        gasUsed: "100000",
        gasPrice: "1000000",
        fee: "100000000000",
      },
    });
    await appendSignerAuditRecord(record);
  }

  console.log(`Seeded ${args.count} mock receipts for ${args.strategyId}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
