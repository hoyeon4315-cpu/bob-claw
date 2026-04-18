#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { loadCanaryState, readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildSimulationSummary, selectSimulationTargets, simulateQuoteMechanicalPath } from "../prelive/execution-sim.mjs";

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
    from: options.from || null,
    source: options.source || "objective",
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
    limit: options.limit ? Number(options.limit) : 4,
    targetSuccessCount: options["target-success-count"] ? Number(options["target-success-count"]) : 50,
  };
}

function selectionKey(routeKey, amount) {
  return routeKey && amount ? `${routeKey}|${amount}` : null;
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.from, dataDir: config.dataDir });
  const state = await loadCanaryState({ address: resolved.address, dataDir: config.dataDir });
  const [shadowCycle, refreshPlan] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "shadow-cycle-latest.json")),
    readJsonIfExists(join(config.dataDir, "shadow-refresh-plan.json")),
  ]);
  const walletReadiness = await readJsonl(config.dataDir, "estimator-wallet-readiness");
  const scoreBySelection = new Map(
    (state.scoreSnapshot?.scores || []).map((score) => [selectionKey(score.routeKey, score.amount), score]),
  );
  const selections = selectSimulationTargets({
    quotes: state.quotes || [],
    walletReadiness,
    address: resolved.address,
    refreshPlan,
    shadowCycle,
    source: args.routeKey ? "exact" : args.source,
    routeKey: args.routeKey,
    amount: args.amount,
    limit: args.limit,
  });

  if (!selections.length) {
    if (args.json) {
      console.log(JSON.stringify({ schemaVersion: 1, selectedCount: 0, results: [] }, null, 2));
      return;
    }
    console.log("selectedCount=0");
    console.log("reason=no_simulation_targets_with_latest_quotes");
    return;
  }

  const store = new JsonlStore(config.dataDir);
  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;
  const records = [];
  for (const selection of selections) {
    const score = scoreBySelection.get(selectionKey(selection.routeKey, selection.amount)) || null;
    const record = await simulateQuoteMechanicalPath({
      selection: { ...selection, score },
      from: resolved.address,
      prices: state.prices,
    });
    const persisted = {
      ...record,
      runId,
      address: resolved.address,
      addressSource: resolved.source,
    };
    records.push(persisted);
    if (args.write) {
      await store.append("prelive-simulation-runs", persisted);
    }
  }

  const summary = {
    ...buildSimulationSummary(records, { targetSuccessCount: args.targetSuccessCount }),
    runId,
    address: resolved.address,
    addressSource: resolved.source,
    source: args.routeKey ? "exact_route" : args.source,
  };

  if (args.write) {
    const outputPath = join(config.dataDir, "prelive-simulation-latest.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify({ summary, results: records }, null, 2));
    return;
  }

  console.log(`runId=${runId}`);
  console.log(`selectedCount=${records.length}`);
  console.log(`successCount=${summary.successCount}`);
  console.log(`failureCount=${summary.failureCount}`);
  console.log(`skippedCount=${summary.skippedCount}`);
  console.log(`successRemaining=${summary.successRemaining}`);
  for (const record of records) {
    console.log(
      [
        `status=${record.status}`,
        `route=${record.routeLabel || record.routeKey || "unknown"}`,
        `amount=${record.amount || "n/a"}`,
        `source=${record.source || "unknown"}`,
        record.queueRank != null ? `rank=${record.queueRank}` : null,
        record.estimatedGasUsd != null ? `gasUsd=${record.estimatedGasUsd}` : null,
        record.gasEstimate?.ok === false ? `gasReason=${record.gasEstimate.reason}` : null,
        record.call?.ok === false ? `callReason=${record.call.reason}` : null,
        record.skipReason ? `skipReason=${record.skipReason}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
