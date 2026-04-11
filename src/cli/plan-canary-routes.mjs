#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { getCoinGeckoPricesUsd } from "../market/prices.mjs";

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
    address: options.address || config.estimateFrom,
    limit: options.limit ? Number(options.limit) : 5,
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [quotes, readinessRecords, readinessFailures, scoreSnapshot, prices] = await Promise.all([
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    getCoinGeckoPricesUsd().catch(() => null),
  ]);

  const plan = buildCanaryRoutePlan(
    {
      quotes,
      scores: scoreSnapshot?.scores || [],
      readinessRecords,
      readinessFailures,
    },
    {
      address: args.address,
      prices,
      limit: args.limit,
    },
  );

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`address=${plan.address}`);
  console.log(`routes=${plan.candidateCount} txReady=${plan.txReadyCount} viableForPrep=${plan.viableCount}`);
  for (const candidate of plan.topCandidates) {
    console.log("");
    console.log(`${candidate.label} amount=${candidate.amount}`);
    console.log(
      `  prep=${candidate.viableForPrep ? "viable" : "blocked"} txReady=${candidate.txReady} exactGas=${candidate.exactGasDone} readiness=${candidate.tradeReadiness || "none"}`,
    );
    if (candidate.prepBlockers.length) {
      console.log(`  blockers=${candidate.prepBlockers.join(",")}`);
    }
    if (candidate.readinessFailureReason) {
      console.log(`  failure=${candidate.readinessFailureReason}`);
    }
    if (candidate.scoreDisqualifiers.length) {
      console.log(`  scoreGaps=${candidate.scoreDisqualifiers.join(",")}`);
    }
    console.log(
      `  input=${formatUsd(candidate.inputUsd)} prepFunding=${formatUsd(candidate.prepFundingUsd)} nativeShortfall=${formatUsd(candidate.nativeShortfallUsd)} tokenShortfall=${formatUsd(candidate.tokenShortfallUsd)} netEdge=${formatUsd(candidate.netEdgeUsd)} execNet=${formatUsd(candidate.executableNetEdgeUsd)}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
