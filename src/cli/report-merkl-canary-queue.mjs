#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildMerklCanaryQueue } from "../strategy/merkl-canary-queue.mjs";
import { latestTreasuryInventoryForAddress } from "../strategy/merkl-canary-execution-readiness.mjs";

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
  const [inventoryRecords, protocolCanaryExecutions, autopilotExecutions] = await Promise.all([
    readJsonl(config.dataDir, "treasury-inventory"),
    readJsonl(config.dataDir, "erc4626-protocol-canaries"),
    readJsonl(config.dataDir, "merkl-canary-autopilot-runs").catch(() => []),
  ]);
  const canaryExecutions = [...protocolCanaryExecutions, ...autopilotExecutions];
  const inventorySnapshot = latestTreasuryInventoryForAddress(inventoryRecords, report?.address || inventoryRecords.at(-1)?.address || null);
  const queue = buildMerklCanaryQueue({
    report,
    limit: args.limit,
    inventorySnapshot,
    canaryExecutions,
  });

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
  console.log(`topExecutableOpportunity=${queue.summary.topExecutableOpportunityId || "n/a"}`);
  console.log(`chainCount=${queue.summary.chainCount}`);
  console.log(`protocolBindingReadyCount=${queue.summary.protocolBindingReadyCount}`);
  console.log(`protocolBindingRequiredCount=${queue.summary.protocolBindingRequiredCount}`);
  console.log(`unsupportedProtocolBindingCount=${queue.summary.unsupportedProtocolBindingCount}`);
  console.log(`chainRouteGapCount=${queue.summary.chainRouteGapCount}`);
  console.log(`executableNowCount=${queue.summary.executableNowCount ?? 0}`);
  console.log(`cooldownActiveCount=${queue.summary.cooldownActiveCount ?? 0}`);
  console.log(`nativeGasGapCount=${queue.summary.nativeGasGapCount ?? 0}`);
  console.log(`executorMissingCount=${queue.summary.executorMissingCount ?? 0}`);
  for (const item of queue.queue.slice(0, 5)) {
    console.log(
      `${item.rank}. ${item.opportunityId} ${item.chain}/${item.protocolId} strategy=${item.mappedStrategyId} action=${item.nextAction} priority=${item.priorityScore} ready=${item.executionReadiness?.status || "unknown"}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
