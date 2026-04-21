#!/usr/bin/env node

/**
 * fetch-gateway-round-trip-quote.mjs
 *
 * Pulls the entry (BTC → destAsset on chainId) and exit
 * (destAsset → BTC) quotes from BOB Gateway, normalizes them through
 * normalizeGatewayRoundTripSnapshot(), and writes the snapshot to disk.
 *
 *   node src/cli/fetch-gateway-round-trip-quote.mjs \
 *     --base=https://gateway-api.gobob.xyz \
 *     --chain-id=8453 \
 *     --dest-asset=cbBTC \
 *     --notional-sats=1000000 \
 *     --btc-price-usd=60000 \
 *     [--out=data/snapshots/gateway-<dest>-<chain>-<ts>.json] \
 *     [--json] [--quiet]
 *
 * Rate-limit handling: HTTP 429 OR { "error": "rate_limit*" } payload →
 * exits 0 with `rateLimited: true` written into the snapshot wrapper.
 * Caller (run-strategy-tick) treats that as a non-fatal "no fresh
 * Gateway quote" and adapter blocks naturally on `gatewayQuoteFresh:
 * false`. Other errors → exit 2.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeGatewayRoundTripQuote } from "../strategy/snapshots/gateway-round-trip-snapshot.mjs";

const FETCH_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const out = { json: false, quiet: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--quiet") { out.quiet = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function fetchJson(url, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429) {
      return { rateLimited: true, status: 429, label };
    }
    const body = await res.text();
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
    if (!res.ok) {
      // Gateway returns rate-limit signals in body sometimes.
      const errStr = JSON.stringify(parsed).toLowerCase();
      if (errStr.includes("rate") && errStr.includes("limit")) {
        return { rateLimited: true, status: res.status, label, body: parsed };
      }
      return { error: `${label} HTTP ${res.status}`, body: parsed };
    }
    return { payload: parsed };
  } catch (err) {
    if (err.name === "AbortError") return { error: `${label} timeout` };
    return { error: `${label}: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function buildQuoteUrl(base, { fromAsset, toAsset, fromChain, toChain, amount }) {
  const u = new URL("/v1/get-quote", base);
  u.searchParams.set("fromAsset", fromAsset);
  u.searchParams.set("toAsset", toAsset);
  u.searchParams.set("fromChain", fromChain);
  u.searchParams.set("toChain", toChain);
  u.searchParams.set("amount", String(amount));
  return u.toString();
}

async function main() {
  const args = parseArgs(process.argv);
  for (const k of ["base", "chain-id", "dest-asset", "notional-sats", "btc-price-usd"]) {
    if (!args[k]) { console.error(`ERR: --${k} required`); process.exit(2); }
  }
  const fetchedAt = Date.now();

  // entry: BTC L1 → destAsset on dest chain
  const entryRes = await fetchJson(
    buildQuoteUrl(args.base, {
      fromAsset: "BTC",
      toAsset: args["dest-asset"],
      fromChain: "bitcoin",
      toChain: args["chain-id"],
      amount: args["notional-sats"],
    }),
    "entry quote",
  );
  // exit: destAsset on dest chain → BTC L1
  const exitRes = await fetchJson(
    buildQuoteUrl(args.base, {
      fromAsset: args["dest-asset"],
      toAsset: "BTC",
      fromChain: args["chain-id"],
      toChain: "bitcoin",
      amount: args["notional-sats"],
    }),
    "exit quote",
  );

  const rateLimited = Boolean(entryRes.rateLimited || exitRes.rateLimited);

  let snapshot;
  if (rateLimited || entryRes.error || exitRes.error) {
    // Synthesize a partial snapshot — adapter blocks on
    // gatewayQuoteFresh:false. We do NOT pass partial payloads to
    // normalizer (it would try to compute fields).
    snapshot = Object.freeze({
      source: "gateway-round-trip",
      destAsset: args["dest-asset"],
      destChainId: Number(args["chain-id"]),
      fetchedAtMs: fetchedAt,
      gatewayQuoteFresh: false,
      partial: true,
      rateLimited,
      missing: Object.freeze(rateLimited
        ? ["entry-quote:rate-limited", "exit-quote:rate-limited"]
        : [
            entryRes.error ? `entry-quote:${entryRes.error}` : null,
            exitRes.error ? `exit-quote:${exitRes.error}` : null,
          ].filter(Boolean)),
    });
  } else {
    snapshot = normalizeGatewayRoundTripQuote({
      entryQuote: entryRes.payload,
      exitQuote: exitRes.payload,
      entryQuoteFetchedAt: new Date(fetchedAt).toISOString(),
      exitQuoteFetchedAt: new Date(fetchedAt).toISOString(),
      btcPriceUsd: Number(args["btc-price-usd"]),
      now: new Date(fetchedAt).toISOString(),
    });
  }

  const out = args.out || resolve(
    "data/snapshots",
    `gateway-${args["dest-asset"]}-${args["chain-id"]}-${fetchedAt}.json`,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snapshot, null, 2));

  if (!args.quiet) {
    if (args.json) {
      console.log(JSON.stringify({ outPath: out, snapshot, rateLimited }));
    } else {
      console.log(`gateway round-trip snapshot written: ${out}`);
      console.log(`  rateLimited=${rateLimited} partial=${snapshot.partial} fresh=${snapshot.gatewayQuoteFresh}`);
      if (!snapshot.partial) {
        console.log(`  roundTripCostBps=${snapshot.gatewayRoundTripCostBps} offrampCostBps=${snapshot.offrampCostBps}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
