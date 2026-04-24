#!/usr/bin/env node

/**
 * fetch-berachain-snapshot.mjs
 *
 * Thin async fetcher for Berachain ecosystem data via DefiLlama yields API.
 * Pulls /pools, filters Berachain+Bend/BEX, normalizes, writes snapshot.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeBerachainSnapshot } from "../strategy/snapshots/berachain-snapshot.mjs";

const ENDPOINT = "https://yields.llama.fi/pools";
const FETCH_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const out = { json: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    const eq = arg.indexOf("=");
    if (eq < 0 || !arg.startsWith("--")) continue;
    const k = arg.slice(2, eq);
    const v = arg.slice(eq + 1);
    out[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}

async function fetchJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const chainId = Number(args.chainId || 80094);
  const lendingSymbolIncludes = args.lendingSymbolIncludes || "WBTC";
  const lendingProject = args.lendingProject || "bend";
  const lpSymbolIncludes = args.lpSymbolIncludes || "WBTC";
  const lpProject = args.lpProject || "bex";

  const fetchedAt = new Date().toISOString();
  const response = await fetchJson(ENDPOINT);

  const snapshot = normalizeBerachainSnapshot({
    response,
    lendingSymbolIncludes,
    lendingProject,
    lpSymbolIncludes,
    lpProject,
    chainId,
  });

  const wrapped = {
    schemaVersion: 1,
    fetchedAt,
    source: "defillama-yields",
    endpoint: ENDPOINT,
    snapshot,
  };

  const outPath = args.out || `data/snapshots/berachain-${chainId}-${fetchedAt.replace(/[:.]/g, "-")}.json`;
  const abs = resolve(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(wrapped, null, 2) + "\n");

  if (args.json) {
    process.stdout.write(JSON.stringify(wrapped) + "\n");
  } else {
    process.stdout.write(
      `wrote ${abs}\n  partial=${snapshot.partial} missing=[${snapshot.missing.join(",")}]\n`,
    );
  }
}

main().catch((err) => {
  console.error(`fetch-berachain-snapshot failed: ${err?.message || err}`);
  process.exit(1);
});
