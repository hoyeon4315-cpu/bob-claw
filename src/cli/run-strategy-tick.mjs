#!/usr/bin/env node

/**
 * run-strategy-tick.mjs
 *
 * Operational tick driver. Loads the latest market snapshot per source
 * from `data/snapshots/`, loads receipts from `logs/signer-audit.jsonl`,
 * builds a minimal adaptiveCapitalPlan from `src/config/strategy-caps.mjs`,
 * runs `runStrategyTick`, and appends the result as one JSONL line to
 * `logs/strategy-tick.jsonl`.
 *
 * Usage:
 *   node src/cli/run-strategy-tick.mjs \
 *     --strategy=beefy-folding-vault [--strategy=...] \
 *     [--snapshot-dir=data/snapshots] \
 *     [--audit=logs/signer-audit.jsonl] \
 *     [--out=logs/strategy-tick.jsonl] \
 *     [--btc-price-usd=60000] \
 *     [--allow-shadow] [--json] [--quiet]
 *
 * No keys, no signing. The output JSONL is the input the
 * (still-to-be-wired) signer broadcaster would consume — until then,
 * this is the executable proof that the wiring path is alive.
 */

import { readFileSync, readdirSync, statSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { config as envConfig } from "../config/env.mjs";
import { runStrategyTick } from "../executor/tick/strategy-tick.mjs";
import { getStrategyCaps } from "../config/strategy-caps.mjs";
import { buildObservedGasFloats } from "../executor/bootstrap/gas-float-observation.mjs";
import { evaluateBeefyFoldingAdapter, buildDefaultBeefyFoldingConfig } from "../strategy/beefy-folding-adapter.mjs";
import { evaluatePendlePtLbtcAdapter, buildDefaultPendlePtLbtcConfig } from "../strategy/pendle-pt-lbtc-adapter.mjs";
import { evaluateAerodromeClAdapter, buildDefaultAerodromeClConfig } from "../strategy/aerodrome-cl-adapter.mjs";
import { evaluatePendlePtSolvBtcAdapter, buildDefaultPendlePtSolvBtcConfig } from "../strategy/pendle-pt-solvbtc-bbn-adapter.mjs";
import { evaluateBerachainAdapter, buildDefaultBerachainConfig } from "../strategy/berachain-bend-bex-adapter.mjs";
import { evaluateGmxBasisAdapter, buildDefaultGmxBasisConfig } from "../strategy/gmx-basis-adapter.mjs";
import { evaluateStablecoinSpreadAdapter, buildDefaultStablecoinSpreadConfig } from "../strategy/stablecoin-spread-loop-adapter.mjs";
import { evaluateProxySpreadAdapter, buildDefaultProxySpreadConfig } from "../strategy/proxy-spread-expansion-adapter.mjs";
import { evaluateTokenizedReserveAdapter, buildDefaultTokenizedReserveConfig } from "../strategy/tokenized-reserve-sleeve-adapter.mjs";

const ADAPTERS = Object.freeze({
  "beefy-folding-vault": {
    evaluate: evaluateBeefyFoldingAdapter,
    buildConfig: buildDefaultBeefyFoldingConfig,
    snapshotPrefixes: ["beefy-", "gateway-", "moonwell-"],
    protocol: "beefy",
  },
  "pendle-pt-lbtc-base": {
    evaluate: evaluatePendlePtLbtcAdapter,
    buildConfig: buildDefaultPendlePtLbtcConfig,
    snapshotPrefixes: ["pendle-", "moonwell-", "gateway-"],
    protocol: "pendle",
  },
  "aerodrome-cl-base": {
    evaluate: evaluateAerodromeClAdapter,
    buildConfig: buildDefaultAerodromeClConfig,
    snapshotPrefixes: ["aerodrome-", "gateway-"],
    protocol: "aerodrome",
  },
  "pendle-pt-solvbtc-bbn-bsc": {
    evaluate: evaluatePendlePtSolvBtcAdapter,
    buildConfig: buildDefaultPendlePtSolvBtcConfig,
    snapshotPrefixes: ["pendle-", "solv-", "gateway-", "bsc-"],
    protocol: "pendle",
  },
  "berachain-bend-bex-bgt": {
    evaluate: evaluateBerachainAdapter,
    buildConfig: buildDefaultBerachainConfig,
    snapshotPrefixes: ["berachain-", "bend-", "gateway-"],
    protocol: "berachain",
  },
  "gmx-v2-perp-basis-avax": {
    evaluate: evaluateGmxBasisAdapter,
    buildConfig: buildDefaultGmxBasisConfig,
    snapshotPrefixes: ["gmx-", "gateway-", "avax-"],
    protocol: "gmx",
  },
  "stablecoin-spread-loop": {
    evaluate: evaluateStablecoinSpreadAdapter,
    buildConfig: buildDefaultStablecoinSpreadConfig,
    snapshotPrefixes: ["moonwell-", "gateway-"],
    protocol: "moonwell",
  },
  "proxy-spread-expansion": {
    evaluate: evaluateProxySpreadAdapter,
    buildConfig: buildDefaultProxySpreadConfig,
    snapshotPrefixes: ["morpho-", "gateway-"],
    protocol: "morpho",
  },
  "tokenized-reserve-sleeve": {
    evaluate: evaluateTokenizedReserveAdapter,
    buildConfig: buildDefaultTokenizedReserveConfig,
    snapshotPrefixes: ["pendle-", "solv-", "gateway-", "bsc-"],
    protocol: "pendle",
  },
});

function parseArgs(argv) {
  const out = { json: false, quiet: false, allowShadow: false, strategies: [] };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--quiet") { out.quiet = true; continue; }
    if (arg === "--allow-shadow") { out.allowShadow = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === "strategy") { out.strategies.push(m[2]); continue; }
    out[m[1]] = m[2];
  }
  return out;
}

function loadLatestSnapshots(dir, prefixes) {
  if (!existsSync(dir)) return { snapshots: [], dir };
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => prefixes.some((p) => f.startsWith(p)));
  // Group by prefix, pick newest per group by mtime.
  const byPrefix = new Map();
  for (const f of entries) {
    const prefix = prefixes.find((p) => f.startsWith(p));
    const full = join(dir, f);
    const m = statSync(full).mtimeMs;
    const cur = byPrefix.get(prefix);
    if (!cur || cur.mtime < m) byPrefix.set(prefix, { path: full, mtime: m });
  }
  const out = [];
  for (const [prefix, { path }] of byPrefix.entries()) {
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      out.push({ prefix, path, data });
    } catch (err) {
      console.error(`WARN: snapshot parse failed ${path}: ${err.message}`);
    }
  }
  return { snapshots: out, dir };
}

function mergeMarket(snapshots) {
  // Layer snapshots into a single `market` object the adapters consume.
  // Each snapshot's source key is preserved so the adapter can detect
  // partials and stale data.
  const market = {};
  const sourceMap = {};
  for (const { data } of snapshots) {
    if (!data || typeof data !== "object") continue;
    const src = data.source || "unknown";
    sourceMap[src] = {
      partial: data.partial ?? false,
      missing: data.missing || [],
      fetchedAtMs: data.fetchedAtMs ?? null,
      rateLimited: data.rateLimited ?? false,
    };
    Object.assign(market, data);
  }
  market._sources = sourceMap;
  return market;
}

function loadReceipts(auditPath, strategyIds) {
  if (!existsSync(auditPath)) return [];
  const lines = readFileSync(auditPath, "utf-8").split("\n").filter(Boolean);
  const receipts = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (!r?.strategyId) continue;
      if (!strategyIds.includes(r.strategyId)) continue;
      receipts.push(r);
    } catch { /* skip malformed lines */ }
  }
  return receipts;
}

function loadJsonlIfExists(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildAdaptiveCapitalPlan(strategyIds) {
  // Minimal plan — gives every requested strategy default open caps of
  // $1/$5 (dust canary). Operator must still flip `autoExecute:true` in
  // src/config/strategy-caps.mjs before signer would broadcast; this
  // plan is what the dispatcher expects from upstream cap evaluation.
  return {
    newEntriesAllowed: true,
    strategies: strategyIds.map((id) => ({
      strategyId: id,
      autoExecute: false,                       // hard off until operator commits otherwise
      newEntriesAllowed: true,
      effectiveCapsUsd: { perTxUsd: 1, perDayUsd: 5 },
      bindingConstraint: { perTxUsd: "static_cap" },
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.strategies.length === 0) {
    console.error("ERR: at least one --strategy=<id> required");
    process.exit(2);
  }

  const unknown = args.strategies.filter((s) => !ADAPTERS[s]);
  if (unknown.length > 0) {
    console.error(`ERR: unknown strategies: ${unknown.join(",")}`);
    console.error(`     known: ${Object.keys(ADAPTERS).join(",")}`);
    process.exit(2);
  }

  const snapshotDir = resolve(args["snapshot-dir"] || "data/snapshots");
  const dataDir = resolve(args["data-dir"] || envConfig.dataDir);
  const auditPath = resolve(args.audit || "logs/signer-audit.jsonl");
  const outPath = resolve(args.out || "logs/strategy-tick.jsonl");
  const btcPriceUsd = Number(args["btc-price-usd"] || 60_000);
  const gasSnapshots = loadJsonlIfExists(join(dataDir, "gas-snapshots.jsonl"));
  const walletReadiness = loadJsonlIfExists(join(dataDir, "estimator-wallet-readiness.jsonl"));
  const treasuryInventory = loadJsonlIfExists(join(dataDir, "treasury-inventory.jsonl"));

  const entries = [];
  const snapshotSummary = [];
  for (const sid of args.strategies) {
    const adapter = ADAPTERS[sid];
    const { snapshots } = loadLatestSnapshots(snapshotDir, adapter.snapshotPrefixes);
    snapshotSummary.push({
      strategyId: sid,
      snapshotCount: snapshots.length,
      snapshotPaths: snapshots.map((s) => s.path),
    });
    const market = mergeMarket(snapshots);
    const config = { ...adapter.buildConfig(), id: sid };
    const receipts = loadReceipts(auditPath, [sid]);
    const caps = getStrategyCaps(sid);
    const gasObservation = caps
      ? buildObservedGasFloats({
          strategyCaps: caps,
          gasSnapshots,
          walletReadiness,
          treasuryInventory,
        })
      : {
          operatorAddress: null,
          gasFloats: Object.freeze({}),
          summary: Object.freeze({
            configuredChainCount: 0,
            observedChainCount: 0,
            chains: Object.freeze([]),
          }),
        };
    const gasFloats = gasObservation.gasFloats;
    snapshotSummary[snapshotSummary.length - 1].capsConfigured = Boolean(caps);
    snapshotSummary[snapshotSummary.length - 1].gasFloatSummary = gasObservation.summary;
    snapshotSummary[snapshotSummary.length - 1].operatorAddress = gasObservation.operatorAddress;
    entries.push({
      strategyId: sid,
      evaluate: adapter.evaluate,
      config,
      market,
      receipts,
      protocol: adapter.protocol,
      gasFloats,
      hopCatalog: [],
    });
  }

  const adaptiveCapitalPlan = buildAdaptiveCapitalPlan(args.strategies);
  const dynamicLiveGate = { gated: false, blockers: [] };
  const feedFreshness = { ok: true, worstSeverity: "ok", staleCount: 0 };

  const result = runStrategyTick({
    entries,
    adaptiveCapitalPlan,
    dynamicLiveGate,
    feedFreshness,
    btcPriceUsd,
    allowShadow: args.allowShadow,
    now: new Date().toISOString(),
  });

  const tickRecord = {
    schemaVersion: 1,
    tickAt: result.observedAt,
    btcPriceUsd,
    strategies: args.strategies,
    snapshotSummary,
    summary: result.summary,
    blockers: result.reports.map((r) => ({
      strategyId: r.strategyId,
      mode: r.mode || (r.liveReady ? "live_candidate" : r.shadowReady ? "shadow_ready" : "blocked"),
      blockers: [...(r.blockers || [])],
    })),
    dispatchSummary: result.dispatch?.summary || null,
    candidateCount: result.builder.candidateCount,
    skippedCount: result.builder.skippedCount,
    errorCount: result.errors.length,
    reportSummaries: result.reports.map((r) => ({
      strategyId: r.strategyId,
      mode: r.mode || (r.liveReady ? "live_candidate" : r.shadowReady ? "shadow_ready" : "blocked"),
      shadowReady: Boolean(r.shadowReady),
      liveReady: Boolean(r.liveReady),
      microCanaryStatus: r.microCanaryStatus || "not_started",
      blockerCount: r.blockers?.length ?? 0,
      topBlocker: r.blockers?.[0] || null,
      projectedNetUsd: r.economics?.projectedNetUsd ?? null,
      signerBackedCount: r.evidence?.signerBackedCount ?? 0,
      passedCount: r.evidence?.passedCount ?? 0,
    })),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  appendFileSync(outPath, JSON.stringify(tickRecord) + "\n");

  if (!args.quiet) {
    if (args.json) {
      console.log(JSON.stringify({ outPath, tickRecord }));
    } else {
      console.log(`tick written: ${outPath}`);
      console.log(`  strategies=${args.strategies.length} candidates=${tickRecord.candidateCount} allow=${tickRecord.dispatchSummary?.allowCount ?? 0} deny=${tickRecord.dispatchSummary?.denyCount ?? 0}`);
      for (const b of tickRecord.blockers) {
        console.log(`  ${b.strategyId} [${b.mode}] blockers=${b.blockers.join(",") || "(none)"}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
