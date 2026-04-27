#!/usr/bin/env node

import { config } from "../config/env.mjs";
import {
  clearReportingPnlBaseline,
  readReportingPnlBaseline,
  setReportingPnlBaseline,
  summarizeReportingPnlBaseline,
} from "../status/reporting-pnl-baseline.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const anchoredAtArg = argv.find((item) => item.startsWith("--at="));
  const reasonArg = argv.find((item) => item.startsWith("--reason="));
  return {
    json: flags.has("--json"),
    clear: flags.has("--clear"),
    set: flags.has("--set") || Boolean(anchoredAtArg),
    anchoredAt: anchoredAtArg ? anchoredAtArg.slice("--at=".length) : new Date().toISOString(),
    reason: reasonArg ? reasonArg.slice("--reason=".length) : "manual_reporting_reset",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.clear) {
    const result = await clearReportingPnlBaseline({ dataDir: config.dataDir });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`cleared=${result.cleared}`);
    return;
  }

  if (args.set) {
    const result = await setReportingPnlBaseline({
      dataDir: config.dataDir,
      anchoredAt: args.anchoredAt,
      reason: args.reason,
    });
    if (args.json) {
      console.log(JSON.stringify(result.baseline, null, 2));
      return;
    }
    console.log(`anchoredAt=${result.baseline.anchoredAt}`);
    console.log(`reason=${result.baseline.reason || "n/a"}`);
    console.log(`changed=${result.changed}`);
    return;
  }

  const baseline = await readReportingPnlBaseline({ dataDir: config.dataDir });
  const summary = summarizeReportingPnlBaseline(baseline);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`active=${summary.active}`);
  console.log(`anchoredAt=${summary.anchoredAt || "n/a"}`);
  console.log(`applied=${summary.applied}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
