#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildMerklCanaryQueue } from "../strategy/merkl-canary-queue.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(2, index), item.slice(index + 1)];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    limit: entries.limit ? Number(entries.limit) : null,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await readJson(join(config.dataDir, "merkl-opportunities-report.json"));
  const queue = buildMerklCanaryQueue({ report, limit: args.limit });

  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "merkl-canary-queue.json"), `${JSON.stringify(queue, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(queue, null, 2));
    return;
  }

  console.log(`queueCount=${queue.summary.queueCount}`);
  console.log(`topOpportunity=${queue.summary.topOpportunityId || "n/a"}`);
  console.log(`topNextAction=${queue.summary.topNextAction || "n/a"}`);
  console.log(`chainCount=${queue.summary.chainCount}`);
  console.log(`protocolBindingReadyCount=${queue.summary.protocolBindingReadyCount}`);
  console.log(`protocolBindingRequiredCount=${queue.summary.protocolBindingRequiredCount}`);
  console.log(`unsupportedProtocolBindingCount=${queue.summary.unsupportedProtocolBindingCount}`);
  console.log(`chainRouteGapCount=${queue.summary.chainRouteGapCount}`);
  for (const item of queue.queue.slice(0, 5)) {
    console.log(
      `${item.rank}. ${item.opportunityId} ${item.chain}/${item.protocolId} strategy=${item.mappedStrategyId} action=${item.nextAction} priority=${item.priorityScore}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
