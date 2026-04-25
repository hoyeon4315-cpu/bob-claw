#!/usr/bin/env node

/**
 * fetch-gmx-snapshot.mjs
 *
 * Thin async fetcher for GMX public REST.
 * Pulls /markets/info, normalizes, writes snapshot.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeGmxSnapshot } from "../strategy/snapshots/gmx-snapshot.mjs";

const ENDPOINT = "https://arbitrum-api.gmxinfra.io/markets/info";
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
  const indexTokenAddress = args.indexTokenAddress || null;
  const marketName = args.marketName || "BTC/USD";

  const fetchedAt = new Date().toISOString();
  const response = await fetchJson(ENDPOINT);

  const snapshot = normalizeGmxSnapshot({ response, indexTokenAddress, marketName });

  const wrapped = {
    schemaVersion: 1,
    fetchedAt,
    source: "gmx-public-rest",
    endpoint: ENDPOINT,
    snapshot,
  };

  const outPath = args.out || `data/snapshots/gmx-${marketName.replace(/[^a-z0-9]/gi, "-")}-${fetchedAt.replace(/[:.]/g, "-")}.json`;
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
  console.error(`fetch-gmx-snapshot failed: ${err?.message || err}`);
  process.exit(1);
});
