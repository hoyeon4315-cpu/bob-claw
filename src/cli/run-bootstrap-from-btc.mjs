#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildScoredTargetBalances } from "../executor/capital/scored-target-balances.mjs";
import { buildCapitalRebalancePlan } from "../executor/capital/rebalancer.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { buildChainScoreLedger } from "../strategy/chain-score-ledger.mjs";

function parseArgs(argv) {
  const args = { write: false, json: false, btcSats: null, btcPriceUsd: null, totalCapitalUsd: null };
  for (const value of argv) {
    if (value === "--write") args.write = true;
    else if (value === "--json") args.json = true;
    else if (value.startsWith("--btc-balance-sats=")) args.btcSats = Number(value.split("=")[1]);
    else if (value.startsWith("--btc-price-usd=")) args.btcPriceUsd = Number(value.split("=")[1]);
    else if (value.startsWith("--total-capital-usd=")) args.totalCapitalUsd = Number(value.split("=")[1]);
  }
  return args;
}

function resolveTotalCapitalUsd(args) {
  if (Number.isFinite(args.totalCapitalUsd) && args.totalCapitalUsd > 0) return args.totalCapitalUsd;
  if (
    Number.isFinite(args.btcSats) &&
    args.btcSats > 0 &&
    Number.isFinite(args.btcPriceUsd) &&
    args.btcPriceUsd > 0
  ) {
    return (args.btcSats / 1e8) * args.btcPriceUsd;
  }
  return null;
}

async function loadInputs() {
  const [promotionGate, economics, prices, signerAuditRecords] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "destination-promotion-gate.json")),
    readJsonIfExists(join(config.dataDir, "destination-economics-ledger.json")),
    readJsonIfExists(join(config.dataDir, "price-snapshot.json")),
    readJsonl("logs", "signer-audit").catch(() => []),
  ]);
  return { promotionGate, economics, prices, signerAuditRecords };
}

export function buildBootstrapFromBtcReport({
  promotionGate,
  economics,
  totalCapitalUsd,
  strategyCaps = listStrategyCaps(),
  balancesByChain = {},
  policy = null,
  diversificationPolicy,
  chainScoreLedger = null,
  now = new Date().toISOString(),
} = {}) {
  if (!totalCapitalUsd || !(totalCapitalUsd > 0)) {
    return {
      schemaVersion: 1,
      generatedAt: now,
      decision: "TOTAL_CAPITAL_UNDEFINED",
      totalCapitalUsd: 0,
      scoredTargets: { perStrategy: [], perChain: [] },
      rebalancePlan: null,
    };
  }
  const scoredTargets = buildScoredTargetBalances({
    promotionGate,
    economics,
    strategyCaps,
    totalCapitalUsd,
    ...(diversificationPolicy !== undefined ? { diversificationPolicy } : {}),
    chainScoreLedger,
    now,
  });
  const rebalancePlan = buildCapitalRebalancePlan({
    strategyCaps,
    policy,
    balancesByChain,
    scoredTargets,
    now,
  });
  return {
    schemaVersion: 1,
    generatedAt: now,
    decision: rebalancePlan.decision,
    totalCapitalUsd,
    scoredTargets,
    rebalancePlan,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const totalCapitalUsd = resolveTotalCapitalUsd(args);
  const { promotionGate, economics, prices, signerAuditRecords } = await loadInputs();
  const btcPriceUsd = Number(args.btcPriceUsd ?? prices?.btcUsd ?? 0);
  const chainScoreLedger = buildChainScoreLedger({
    records: signerAuditRecords,
    now: new Date().toISOString(),
  });
  const report = buildBootstrapFromBtcReport({
    promotionGate,
    economics,
    totalCapitalUsd,
    chainScoreLedger,
  });

  const enriched = {
    ...report,
    inputs: {
      btcSats: args.btcSats ?? null,
      btcPriceUsd: btcPriceUsd > 0 ? btcPriceUsd : null,
      totalCapitalUsd: totalCapitalUsd ?? null,
    },
  };

  if (args.write) {
    const outputPath = join(config.dataDir, "bootstrap-from-btc.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(enriched, null, 2)}\n`);
  }

  if (args.json || !args.write) {
    process.stdout.write(`${JSON.stringify(enriched, null, 2)}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("run-bootstrap-from-btc.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exit(1);
  });
}
