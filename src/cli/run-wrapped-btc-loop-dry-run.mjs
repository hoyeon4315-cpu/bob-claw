#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildWrappedBtcLendingLoopDryRunPacket, buildWrappedBtcLendingLoopDryRunReceipt, summarizeWrappedBtcLendingLoopDryRunRuns } from "../strategy/wrapped-btc-lending-loop-dry-run.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../strategy/wrapped-btc-lending-loop-slice.mjs";

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
    write: flags.has("--write"),
    scenario: options.scenario || "health_factor_breach",
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { observedAt, generatedAt, runId, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scaffold =
    (await readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json"))) || buildWrappedBtcLendingLoopScaffold();
  const packet = buildWrappedBtcLendingLoopDryRunPacket({ scaffold });
  const receipt = buildWrappedBtcLendingLoopDryRunReceipt({
    scaffold,
    packet,
    scenarioId: args.scenario,
  });
  const store = new JsonlStore(config.dataDir);
  if (args.write) {
    await store.append("wrapped-btc-loop-dry-runs", receipt);
  }
  const allRecords = args.write ? await readJsonl(config.dataDir, "wrapped-btc-loop-dry-runs") : [receipt];
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strategyId: scaffold.strategy?.id || null,
    ...summarizeWrappedBtcLendingLoopDryRunRuns(allRecords),
  };

  if (args.write) {
    const outputPath = join(config.dataDir, "wrapped-btc-lending-loop-dry-run-latest.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify({ receipt, summary }, null, 2));
    return;
  }

  console.log(`scenario=${receipt.scenarioId}`);
  console.log(`result=${receipt.result}`);
  console.log(`watcherStatus=${receipt.watcherStatus}`);
  console.log(`dryRunReceiptRecorded=${summary.dryRunReceiptRecorded}`);
  console.log(`autoUnwindPassCount=${summary.autoUnwindPassCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
