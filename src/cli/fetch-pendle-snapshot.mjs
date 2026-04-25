#!/usr/bin/env node

/**
 * fetch-pendle-snapshot.mjs
 *
 * Thin async fetcher for Pendle public REST.
 * Pulls /v2/markets/all, normalizes, writes snapshot.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizePendleSnapshot } from "../strategy/snapshots/pendle-snapshot.mjs";

const ENDPOINT = "https://api-v2.pendle.finance/core/v2/markets/all";
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
  const chainId = Number(args.chainId || 8453);
  const marketAddress = args.marketAddress || null;
  const underlyingSymbol = args.underlyingSymbol || null;

  const fetchedAt = new Date().toISOString();
  const url = `${ENDPOINT}?chainId=${chainId}&limit=100`;
  const response = await fetchJson(url);

  const snapshot = normalizePendleSnapshot({ response, marketAddress, underlyingSymbol, chainId });

  const wrapped = {
    schemaVersion: 1,
    fetchedAt,
    source: "pendle-public-rest",
    endpoint: url,
    snapshot,
  };

  const outPath = args.out || `data/snapshots/pendle-${chainId}-${fetchedAt.replace(/[:.]/g, "-")}.json`;
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
  console.error(`fetch-pendle-snapshot failed: ${err?.message || err}`);
  process.exit(1);
});
