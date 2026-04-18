#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { loadCanaryState, readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { selectSimulationTargets } from "../prelive/execution-sim.mjs";
import { buildForkExecutionPlan } from "../prelive/fork-execution.mjs";

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
    address: options.address || null,
    source: options.source || "objective",
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
    limit: options.limit ? Number(options.limit) : 1,
  };
}

function selectionKey(routeKey, amount) {
  return routeKey && amount ? `${routeKey}|${amount}` : null;
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { observedAt, generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
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
  }).map((selection) => ({
    ...selection,
    score: scoreBySelection.get(selectionKey(selection.routeKey, selection.amount)) || null,
  }));

  const plans = selections.map((selection) =>
    buildForkExecutionPlan({
      selection,
      address: resolved.address,
    }),
  );
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    address: resolved.address,
    addressSource: resolved.source,
    source: args.routeKey ? "exact_route" : args.source,
    selectedCount: plans.length,
    plans,
  };

  if (args.write) {
    const outputPath = join(config.dataDir, "prelive-fork-plan.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(output, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`selectedCount=${output.selectedCount}`);
  for (const plan of plans) {
    console.log(
      [
        `planId=${plan.planId}`,
        `status=${plan.status}`,
        `route=${plan.routeLabel || plan.routeKey || "unknown"}`,
        `amount=${plan.amount || "n/a"}`,
        `source=${plan.selectionSource || "unknown"}`,
        `code=${plan.selectionCode || "unknown"}`,
        plan.blockers.length ? `blockers=${plan.blockers.join(",")}` : null,
        plan.commands.submit ? `submit=${plan.commands.submit}` : null,
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
