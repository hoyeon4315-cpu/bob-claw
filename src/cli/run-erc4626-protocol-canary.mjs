#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import {
  buildErc4626ProtocolCanaryPlan,
  executeErc4626ProtocolCanaryPlan,
  selectErc4626QueueItem,
} from "../executor/helpers/erc4626-protocol-canary.mjs";
import { preflightLiveCanarySweep } from "../executor/live-canary-sweep.mjs";
import { signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
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
    execute: flags.has("--execute"),
    json: flags.has("--json"),
    write: flags.has("--write"),
    opportunityId: entries["opportunity-id"] || null,
    chain: entries.chain || null,
    amount: entries.amount || "10000",
    socketPath: resolve(entries["socket-path"] || signerSocketPath()),
    timeoutMs: entries["timeout-ms"] ? Number(entries["timeout-ms"]) : signerClientTimeoutMs(),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function toJsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]));
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preflight = await preflightLiveCanarySweep({
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  });
  if (preflight.status !== "ready") {
    const report = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      status: "blocked",
      blockedReason: preflight.blockedReason,
      preflight,
    };
    console.log(args.json ? JSON.stringify(report, null, 2) : `blocked=${report.blockedReason}`);
    process.exitCode = 1;
    return;
  }

  const queue = await readJson(join(config.dataDir, "merkl-canary-queue.json"));
  const [inventoryRecords, canaryExecutions] = await Promise.all([
    readJsonl(config.dataDir, "treasury-inventory"),
    readJsonl(config.dataDir, "erc4626-protocol-canaries"),
  ]);
  const inventorySnapshot = latestTreasuryInventoryForAddress(inventoryRecords, preflight.senderAddress);
  const queueItem = selectErc4626QueueItem(queue, {
    opportunityId: args.opportunityId,
    chain: args.chain,
    inventorySnapshot,
    canaryExecutions,
  });
  if (!queueItem) {
    throw new Error("No inventory-ready ERC4626 queue item matched the requested filters");
  }

  const plan = await buildErc4626ProtocolCanaryPlan({
    queueItem,
    senderAddress: preflight.senderAddress,
    amount: args.amount,
  });
  const execution = args.execute
    ? await executeErc4626ProtocolCanaryPlan({
      plan,
      socketPath: args.socketPath,
      timeoutMs: args.timeoutMs,
    })
    : null;
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode: args.execute ? "execute" : "preview",
    status: execution?.settlementStatus || "preview_ready",
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      liveBaseline: preflight.liveBaseline,
      killSwitchPath: preflight.killSwitchPath,
    },
    queueItem: {
      queueId: queueItem.queueId,
      opportunityId: queueItem.opportunityId,
      chain: queueItem.chain,
      protocolId: queueItem.protocolId,
      name: queueItem.name,
      priorityScore: queueItem.priorityScore,
      executionReadiness: queueItem.executionReadiness?.status || null,
    },
    plan,
    execution,
  };

  const serializableReport = toJsonSafe(report);

  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "erc4626-protocol-canary-latest.json"), `${JSON.stringify(serializableReport, null, 2)}\n`);
    await new JsonlStore(config.dataDir).append("erc4626-protocol-canaries", serializableReport);
  }

  if (args.json) {
    console.log(JSON.stringify(serializableReport, null, 2));
    return;
  }

  console.log(`status=${report.status}`);
  console.log(`mode=${report.mode}`);
  console.log(`opportunity=${queueItem.opportunityId}`);
  console.log(`chain=${queueItem.chain}`);
  console.log(`protocol=${queueItem.protocolId}`);
  console.log(`amount=${plan.amount}`);
  console.log(`amountUsd=${plan.amountUsd}`);
  if (execution) {
    console.log(`steps=${execution.stepResults.map((item) => `${item.id}:${item.signerResult?.broadcast?.txHash || "none"}`).join(",")}`);
    console.log(`redeemProof=${execution.redeemProof?.status || "none"} observedDelta=${execution.redeemProof?.observedDelta || "n/a"}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
