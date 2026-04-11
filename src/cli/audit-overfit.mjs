#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { buildOverfitAudit, formatAudit } from "../audit/overfit.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";

async function main() {
  const [routesRecords, quotes, failures, gasSnapshots, gasFailures] = await Promise.all([
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonl(config.dataDir, "gas-snapshots"),
    readJsonl(config.dataDir, "gas-snapshot-failures"),
  ]);

  const audit = buildOverfitAudit({ routesRecords, quotes, failures, gasSnapshots, gasFailures });
  console.log(formatAudit(audit));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

