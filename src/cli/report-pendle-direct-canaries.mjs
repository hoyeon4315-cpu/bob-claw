#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildPendleDirectCanaryFeed, buildPendleDirectCanaryFeedOnChain } from "../strategy/pendle-direct-canary-source.mjs";

const PENDLE_SNAPSHOT_CHAIN_IDS = [1, 8453, 56, 10, 130, 146];

// Same floors as src/config/small-capital-merkl-opportunity-policy.mjs assetFamilyTvlFloorUsd
const DEFAULT_MIN_TVL_BY_FAMILY = {
  stable_fixed_yield: 1_000_000,
  eth_fixed_yield: 1_000_000,
  btc_fixed_yield: 500_000,
  non_core_asset: 5_000_000,
};

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((a) => a.startsWith("--") && a.includes("="))
      .map((a) => {
        const i = a.indexOf("=");
        return [a.slice(2, i), a.slice(i + 1)];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    onChain: flags.has("--on-chain"),
    limit: entries.limit ? Number(entries.limit) : null,
    minTvlOverride: entries["min-tvl"] ? Number(entries["min-tvl"]) : null,
    notional: entries.notional ? Number(entries.notional) : null,
  };
}

async function loadSnapshots(dataDir) {
  const out = {};
  for (const chainId of PENDLE_SNAPSHOT_CHAIN_IDS) {
    const snap = await readJsonIfExists(join(dataDir, "snapshots", `pendle-${chainId}-markets-all-latest.json`));
    if (snap) out[chainId] = snap;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotsByChainId = await loadSnapshots(config.dataDir);
  const chainIdsLoaded = Object.keys(snapshotsByChainId);
  if (chainIdsLoaded.length === 0) {
    console.error("no pendle snapshots found under data/snapshots/pendle-*-markets-all-latest.json — run fetch:pendle-snapshot first");
    process.exit(2);
  }

  const minTvlByFamily = args.minTvlOverride
    ? Object.fromEntries(Object.keys(DEFAULT_MIN_TVL_BY_FAMILY).map((k) => [k, args.minTvlOverride]))
    : DEFAULT_MIN_TVL_BY_FAMILY;

  const candidates = args.onChain
    ? await buildPendleDirectCanaryFeedOnChain({
        snapshotsByChainId,
        now: Date.now(),
        minTvlByFamily,
        notionalUsd: args.notional ?? undefined,
      })
    : buildPendleDirectCanaryFeed({
        snapshotsByChainId,
        now: Date.now(),
        minTvlByFamily,
      });
  const limited = args.limit ? candidates.slice(0, args.limit) : candidates;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chainsLoaded: chainIdsLoaded.map(Number),
    minTvlByFamily,
    candidateCount: candidates.length,
    candidates: limited,
  };

  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "pendle-direct-canaries.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`candidateCount=${candidates.length}`);
  console.log(`chainsLoaded=${chainIdsLoaded.join(",")}`);
  for (const c of limited.slice(0, 10)) {
    console.log(
      `${c.chain}/${c.assetSymbol} family=${c.family} tvl=$${(c.tvlUsd || 0).toLocaleString()} apr=${c.aprPct?.toFixed(2)}% maturityHours=${c.maturityHours?.toFixed(0)} pool=${c.poolAddress}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
