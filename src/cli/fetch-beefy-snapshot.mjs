#!/usr/bin/env node

/**
 * fetch-beefy-snapshot.mjs
 *
 * Thin async fetcher for Beefy public REST. Pulls /vaults /apy /tvl
 * /fees, normalizes through normalizeBeefySnapshot(), and writes the
 * frozen snapshot to disk. No keys, no signing.
 *
 * Usage:
 *   node src/cli/fetch-beefy-snapshot.mjs \
 *     --vault-id=<beefy-vault-id> \
 *     --chain-id=<numeric-chain-id> \
 *     [--out=data/snapshots/beefy-<ts>.json] \
 *     [--json]
 *
 * Exit code 0 always (incl. partial). Caller (the tick orchestrator)
 * decides what to do with `partial: true`.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeBeefySnapshot } from "../strategy/snapshots/beefy-snapshot.mjs";

const ENDPOINTS = Object.freeze({
  vaults: "https://api.beefy.finance/vaults",
  apy: "https://api.beefy.finance/apy",
  tvl: "https://api.beefy.finance/tvl",
  fees: "https://api.beefy.finance/fees",
});

const FETCH_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const out = { json: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
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
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const vaultId = args.vaultId;
  const chainIdRaw = args.chainId;
  if (!vaultId) {
    console.error("--vault-id required");
    process.exit(2);
  }
  if (!chainIdRaw) {
    console.error("--chain-id required (numeric, e.g. 8453 for base)");
    process.exit(2);
  }
  const chainId = Number(chainIdRaw);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    console.error(`--chain-id must be positive integer, got ${chainIdRaw}`);
    process.exit(2);
  }

  const fetchedAt = new Date().toISOString();
  const [vaults, apy, tvl, fees] = await Promise.all([
    fetchJson(ENDPOINTS.vaults),
    fetchJson(ENDPOINTS.apy),
    fetchJson(ENDPOINTS.tvl),
    fetchJson(ENDPOINTS.fees),
  ]);

  const snapshot = normalizeBeefySnapshot({
    vaults,
    apy,
    tvl,
    fees,
    vaultId,
    chainId,
  });

  const wrapped = {
    schemaVersion: 1,
    fetchedAt,
    source: "beefy-public-rest",
    endpoints: ENDPOINTS,
    snapshot,
  };

  const outPath = args.out
    || `data/snapshots/beefy-${vaultId}-${fetchedAt.replace(/[:.]/g, "-")}.json`;
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
  console.error(`fetch-beefy-snapshot failed: ${err?.message || err}`);
  process.exit(1);
});
