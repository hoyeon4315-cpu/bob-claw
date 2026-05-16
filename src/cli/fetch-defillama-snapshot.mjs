#!/usr/bin/env node
/**
 * fetch-defillama-snapshot.mjs
 *
 * Fetches DefiLlama yield pools from yields.llama.fi (working endpoint) for
 * our 11 supported Gateway chains. Attaches family + evidenceClass
 * (protocol_receipt_bound for known receipt-proven protocols like aave/moonwell/beefy/pendle/erc4626,
 * else protocol_not_receipt_bound). Writes dated + latest snapshot for
 * run-strategy-tick + shadow reporting.
 *
 * Usable for shadow reporting:
 *   npm run snapshot:defillama
 *   node src/cli/fetch-defillama-snapshot.mjs --json
 *
 * YCE-001: now reliably produces useful data (non-zero receipt_bound pools).
 * Resilience modeled on fetch-beefy-snapshot / fetch-pendle-snapshot.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

import { getDefiLlamaPoolEvidenceClass } from "../strategy/defillama-yield-adapter.mjs";

const DEFILLAMA_URL = "https://yields.llama.fi/pools";
const FETCH_TIMEOUT_MS = 30_000; // 13MB+ payload can be slow on first hit

const SUPPORTED_CHAINS = [
  "ethereum", "bob", "base", "bsc", "avalanche",
  "unichain", "berachain", "optimism", "soneium", "sei", "sonic",
];

async function fetchAllDefiLlamaPools() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(DEFILLAMA_URL, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`[defillama] HTTP ${res.status} from ${DEFILLAMA_URL}`);
      return { pools: [], partial: true, error: `http_${res.status}` };
    }
    const data = await res.json();
    const pools = Array.isArray(data) ? data : (data?.data || []);
    return { pools, partial: false, error: null };
  } catch (e) {
    const msg = e.name === "AbortError" ? "timeout" : e.message;
    console.error(`[defillama] Network error: ${msg}`);
    return { pools: [], partial: true, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function inferFamily(pool) {
  const symbol = String(pool.symbol || "").toUpperCase();
  if (symbol.includes("BTC") || symbol.includes("WBTC")) return "wrapped_btc";
  return "stablecoin";
}

function parseArgs(argv) {
  const out = { json: false, out: null };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    const eq = arg.indexOf("=");
    if (eq < 0 || !arg.startsWith("--")) continue;
    const k = arg.slice(2, eq);
    const v = arg.slice(eq + 1);
    if (k === "out") out.out = v;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  try {
    console.log("[defillama] fetching pools from yields.llama.fi/pools (YCE-001 revival)...");

    const fetchResult = await fetchAllDefiLlamaPools();
    let allPools = fetchResult.pools || [];
    const partial = !!fetchResult.partial;
    const fetchError = fetchResult.error;

    const filtered = allPools
      .filter(p => {
        const chain = String(p.chain || "").toLowerCase();
        return SUPPORTED_CHAINS.includes(chain);
      })
      .map(pool => {
        const chain = String(pool.chain || "").toLowerCase();
        const family = inferFamily(pool);
        const evidenceClass = getDefiLlamaPoolEvidenceClass(
          pool.project || pool.protocol,
          chain,
          family
        );

        return {
          ...pool,
          chain,
          family,
          evidenceClass,
        };
      });

    const fetchedAt = new Date().toISOString();
    const receiptBoundPools = filtered.filter(p => p.evidenceClass === "protocol_receipt_bound").length;

    const snapshotData = {
      generatedAt: fetchedAt,
      fetchedAt,
      source: "yields.llama.fi/pools",
      chainCount: SUPPORTED_CHAINS.length,
      totalPools: filtered.length,
      receiptBoundPools,
      partial,
      fetchError: fetchError || null,
      pools: filtered,
    };

    const wrapped = {
      schemaVersion: 1,
      fetchedAt,
      source: "yields.llama.fi/pools",
      snapshot: snapshotData,
    };

    const outDir = "data/snapshots";
    mkdirSync(outDir, { recursive: true });

    const dateStr = fetchedAt.slice(0, 10);
    const outPath = `${outDir}/defillama-yield-${dateStr}.json`;
    const absOut = resolve(outPath);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, JSON.stringify(wrapped, null, 2) + "\n");

    // Write defillama-yield-latest.json so loadLatestSnapshots + shadow reports always see fresh data
    const latestPath = resolve(`${outDir}/defillama-yield-latest.json`);
    writeFileSync(latestPath, JSON.stringify(wrapped, null, 2) + "\n");

    console.log(`[defillama] wrote ${absOut}`);
    console.log(`[defillama] wrote latest ${latestPath}`);
    console.log(`[defillama] total=${filtered.length} receipt_bound=${receiptBoundPools} partial=${partial}`);

    if (args.json) {
      process.stdout.write(JSON.stringify(wrapped) + "\n");
    }

    if (partial && filtered.length === 0) {
      console.error("[defillama] WARNING: partial fetch with 0 usable pools");
    }

  } catch (err) {
    console.error(`[defillama] fetch failed: ${err?.message || err}`);
    // Write empty wrapped for pipeline resilience (non-fatal for tick)
    const fetchedAt = new Date().toISOString();
    const emptyWrapped = {
      schemaVersion: 1,
      fetchedAt,
      source: "yields.llama.fi/pools",
      snapshot: {
        generatedAt: fetchedAt,
        fetchedAt,
        source: "yields.llama.fi/pools",
        chainCount: SUPPORTED_CHAINS.length,
        totalPools: 0,
        receiptBoundPools: 0,
        partial: true,
        fetchError: err?.message || String(err),
        pools: [],
      },
    };
    try {
      const outDir = "data/snapshots";
      mkdirSync(outDir, { recursive: true });
      const errPath = resolve(`${outDir}/defillama-yield-${fetchedAt.slice(0,10)}-error.json`);
      writeFileSync(errPath, JSON.stringify(emptyWrapped, null, 2) + "\n");
      const latestErr = resolve(`${outDir}/defillama-yield-latest.json`);
      writeFileSync(latestErr, JSON.stringify(emptyWrapped, null, 2) + "\n");
      if (typeof args !== "undefined" && args.json) process.stdout.write(JSON.stringify(emptyWrapped) + "\n");
    } catch (_) {}
    process.exit(1);
  }
}

main();