#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readMoonwellSupplyRates, latestYieldFeedRecord, yieldFeedIntegrated } from "../defi/yield-feed.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    write: flags.has("--write"),
    json: flags.has("--json"),
  };
}

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const feed = await readMoonwellSupplyRates();

  if (args.write) {
    const store = new JsonlStore(config.dataDir);
    await store.append("yield-feed", feed);
  }

  if (args.json) {
    console.log(JSON.stringify(feed, null, 2));
    return;
  }

  console.log(`source=${feed.source}`);
  console.log(`observedAt=${feed.observedAt}`);
  console.log(`marketCount=${feed.marketCount}`);
  for (const rate of feed.rates) {
    const aprPct = Number.isFinite(rate.supplyAprBps) ? (rate.supplyAprBps / 100).toFixed(2) : "n/a";
    const borrowPct = Number.isFinite(rate.borrowAprBps) ? (rate.borrowAprBps / 100).toFixed(2) : "n/a";
    console.log(`  ${rate.asset}: supply=${aprPct}% (${rate.supplyAprBps}bps) borrow=${borrowPct}% (${rate.borrowAprBps}bps) ${rate.error ? "ERROR=" + rate.error : ""}`);
  }

  if (args.write) {
    const records = await readJsonl(config.dataDir, "yield-feed");
    const latest = latestYieldFeedRecord(records);
    console.log(`yieldFeedIntegrated=${yieldFeedIntegrated(latest)}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});