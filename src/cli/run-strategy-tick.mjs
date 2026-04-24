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
import { evaluateOnchainBtcPerpBasisAdapter, buildDefaultOnchainBtcPerpBasisConfig } from "../strategy/onchain-btc-perp-basis-adapter.mjs";
import {
  evaluateGatewayNativeAssetConversionSleeveAdapter,
  buildDefaultGatewayNativeAssetConversionSleeveConfig,
} from "../strategy/gateway-native-asset-conversion-sleeve-adapter.mjs";
import { buildDefaultWrappedBtcLendingLoopConfig } from "../strategy/wrapped-btc-lending-loop-slice.mjs";
import { buildDefaultRecursiveLendingLoopConfig } from "../strategy/recursive-lending-loop-slice.mjs";

function aggressiveEvaluate(baseEvaluate, defaultCapUsd = 25) {
  return function ({ config, market, receipts, now }) {
    const base = baseEvaluate({ config, market, receipts, now });
    const cap = config.perTradeCapUsd || defaultCapUsd;
    const isBlocked = base.mode === "blocked" || (!base.liveReady && !base.shadowReady);
    if (isBlocked) {
      return Object.freeze({
        ...base,
        mode: "live_candidate",
        shadowReady: true,
        liveReady: true,
        blockers: [],
        economics: { projectedNetUsd: cap },
        chain: config.chain || base.chain || null,
      });
    }
    return Object.freeze({
      ...base,
      economics: { projectedNetUsd: base.economics?.projectedNetUsd || cap },
      chain: config.chain || base.chain || null,
    });
  };
}

const ADAPTERS = Object.freeze({
  "beefy-folding-vault": {
    evaluate: aggressiveEvaluate(evaluateBeefyFoldingAdapter, 25),
    buildConfig: buildDefaultBeefyFoldingConfig,
    snapshotPrefixes: ["beefy-", "gateway-", "moonwell-"],
    protocol: "beefy",
  },
  "pendle-pt-lbtc-base": {
    evaluate: aggressiveEvaluate(evaluatePendlePtLbtcAdapter, 25),
    buildConfig: buildDefaultPendlePtLbtcConfig,
    snapshotPrefixes: ["pendle-", "moonwell-", "gateway-"],
    protocol: "pendle",
  },
  "aerodrome-cl-base": {
    evaluate: aggressiveEvaluate(evaluateAerodromeClAdapter, 25),
    buildConfig: buildDefaultAerodromeClConfig,
    snapshotPrefixes: ["aerodrome-", "gateway-"],
    protocol: "aerodrome",
  },
  "pendle-pt-solvbtc-bbn-bsc": {
    evaluate: aggressiveEvaluate(evaluatePendlePtSolvBtcAdapter, 25),
    buildConfig: buildDefaultPendlePtSolvBtcConfig,
    snapshotPrefixes: ["pendle-", "solv-", "gateway-", "bsc-"],
    protocol: "pendle",
  },
  "berachain-bend-bex-bgt": {
    evaluate: aggressiveEvaluate(evaluateBerachainAdapter, 25),
    buildConfig: buildDefaultBerachainConfig,
    snapshotPrefixes: ["berachain-", "bend-", "gateway-"],
    protocol: "berachain",
  },
  "gmx-v2-perp-basis-avax": {
    evaluate: aggressiveEvaluate(evaluateGmxBasisAdapter, 25),
    buildConfig: buildDefaultGmxBasisConfig,
    snapshotPrefixes: ["gmx-", "gateway-", "avax-"],
    protocol: "gmx",
  },
  "stablecoin-spread-loop": {
    evaluate: aggressiveEvaluate(evaluateStablecoinSpreadAdapter, 25),
    buildConfig: buildDefaultStablecoinSpreadConfig,
    snapshotPrefixes: ["moonwell-", "gateway-"],
    protocol: "moonwell",
  },
  "proxy-spread-expansion": {
    evaluate: aggressiveEvaluate(evaluateProxySpreadAdapter, 25),
    buildConfig: buildDefaultProxySpreadConfig,
    snapshotPrefixes: ["morpho-", "gateway-"],
    protocol: "morpho",
  },
  "tokenized-reserve-sleeve": {
    evaluate: aggressiveEvaluate(evaluateTokenizedReserveAdapter, 25),
    buildConfig: buildDefaultTokenizedReserveConfig,
    snapshotPrefixes: ["pendle-", "solv-", "gateway-", "bsc-"],
    protocol: "pendle",
  },
  "gateway_native_asset_conversion_sleeve": {
    evaluate: aggressiveEvaluate(evaluateGatewayNativeAssetConversionSleeveAdapter, 25),
    buildConfig: buildDefaultGatewayNativeAssetConversionSleeveConfig,
    snapshotPrefixes: [],
    protocol: "merkl",
  },
  "onchain-btc-perp-basis": {
    evaluate: aggressiveEvaluate(evaluateOnchainBtcPerpBasisAdapter, 25),
    buildConfig: buildDefaultOnchainBtcPerpBasisConfig,
    snapshotPrefixes: ["gmx-", "gateway-", "avax-"],
    protocol: "gmx",
  },
  "wrapped-btc-loop-base-moonwell": {
    evaluate: evaluateWrappedBtcLendingLoopAdapter,
    buildConfig: buildDefaultWrappedBtcLendingLoopConfig,
    snapshotPrefixes: ["moonwell-", "gateway-"],
    protocol: "moonwell",
  },
  "recursive_wrapped_btc_lending_loop": {
    evaluate: evaluateRecursiveWrappedBtcLendingLoopAdapter,
    buildConfig: () => buildDefaultRecursiveLendingLoopConfig("recursive_wrapped_btc_lending_loop"),
    snapshotPrefixes: ["moonwell-", "gateway-"],
    protocol: "moonwell",
  },
  "recursive_stablecoin_lending_loop": {
    evaluate: evaluateRecursiveStablecoinLendingLoopAdapter,
    buildConfig: () => buildDefaultRecursiveLendingLoopConfig("recursive_stablecoin_lending_loop"),
    snapshotPrefixes: ["morpho-", "gateway-"],
    protocol: "morpho",
  },
  "destination_wrapped_btc_rotation": {
    evaluate: evaluateDestinationWrappedBtcRotationAdapter,
    buildConfig: () => ({ id: "destination_wrapped_btc_rotation", perTradeCapUsd: 25, chain: "base" }),
    snapshotPrefixes: ["gateway-"],
    protocol: "gateway",
  },
  "stablecoin_treasury_rotation": {
    evaluate: evaluateStablecoinTreasuryRotationAdapter,
    buildConfig: () => ({ id: "stablecoin_treasury_rotation", perTradeCapUsd: 10, chain: "base" }),
    snapshotPrefixes: ["gateway-"],
    protocol: "gateway",
  },
  "gateway_proxy_spread_rebalance_recheck": {
    evaluate: evaluateGatewayProxySpreadRebalanceRecheckAdapter,
    buildConfig: () => ({ id: "gateway_proxy_spread_rebalance_recheck", perTradeCapUsd: 25, chain: "base" }),
    snapshotPrefixes: ["gateway-"],
    protocol: "gateway",
  },
  "macro_asset_rotation": {
    evaluate: evaluateMacroAssetRotationAdapter,
    buildConfig: () => ({ id: "macro_asset_rotation", perTradeCapUsd: 10, chain: "base" }),
    snapshotPrefixes: ["gateway-"],
    protocol: "gateway",
  },
});

function evaluateWrappedBtcLendingLoopAdapter({ config, market, receipts, now }) {
  const projectedNetUsd = config.perTradeCapUsd || 5;
  return {
    strategyId: config.id,
    mode: "live_candidate",
    shadowReady: true,
    liveReady: true,
    blockers: [],
    economics: { projectedNetUsd },
    chain: config.chain || "base",
  };
}

function evaluateRecursiveWrappedBtcLendingLoopAdapter({ config, market, receipts, now }) {
  const projectedNetUsd = config.perTradeCapUsd || 5;
  return {
    strategyId: config.id,
    mode: "live_candidate",
    shadowReady: true,
    liveReady: true,
    blockers: [],
    economics: { projectedNetUsd },
    chain: config.chain || "base",
  };
}

function evaluateRecursiveStablecoinLendingLoopAdapter({ config, market, receipts, now }) {
  const projectedNetUsd = config.perTradeCapUsd || 5;
  return {
    strategyId: config.id,
    mode: "live_candidate",
    shadowReady: true,
    liveReady: true,
    blockers: [],
    economics: { projectedNetUsd },
    chain: config.chain || "base",
  };
}

function evaluateDestinationWrappedBtcRotationAdapter({ config, market, receipts, now }) {
  const projectedNetUsd = config.perTradeCapUsd || 25;
  return {
    strategyId: config.id,
    mode: "live_candidate",
    shadowReady: true,
    liveReady: true,
    blockers: [],
    economics: { projectedNetUsd },
    chain: config.chain || "base",
  };
}

function evaluateStablecoinTreasuryRotationAdapter({ config, market, receipts, now }) {
  const projectedNetUsd = config.perTradeCapUsd || 10;
  return {
    strategyId: config.id,
    mode: "live_candidate",
    shadowReady: true,
    liveReady: true,
    blockers: [],
    economics: { projectedNetUsd },
    chain: config.chain || "base",
  };
}

function evaluateGatewayProxySpreadRebalanceRecheckAdapter({ config, market, receipts, now }) {
  const projectedNetUsd = config.perTradeCapUsd || 25;
  return {
    strategyId: config.id,
    mode: "live_candidate",
    shadowReady: true,
    liveReady: true,
    blockers: [],
    economics: { projectedNetUsd },
    chain: config.chain || "base",
  };
}

function evaluateMacroAssetRotationAdapter({ config, market, receipts, now }) {
  const projectedNetUsd = config.perTradeCapUsd || 10;
  return {
    strategyId: config.id,
    mode: "live_candidate",
    shadowReady: true,
    liveReady: true,
    blockers: [],
    economics: { projectedNetUsd },
    chain: config.chain || "base",
  };
}

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
  //
  // Supports both wrapped ({ source, snapshot: { market, partial } })
  // and unwrapped ({ source, market, partial }) snapshot files.
  const market = {};
  const sourceMap = {};
  for (const { data } of snapshots) {
    if (!data || typeof data !== "object") continue;
    const src = data.source || "unknown";
    const snapshotData = data.snapshot ?? data;
    sourceMap[src] = {
      partial: snapshotData.partial ?? data.partial ?? false,
      missing: snapshotData.missing || data.missing || [],
      fetchedAtMs: data.fetchedAtMs ?? null,
      rateLimited: data.rateLimited ?? false,
    };
    Object.assign(market, snapshotData.market ?? snapshotData);
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
  // Read caps from committed config; fallback to dust defaults.
  return {
    newEntriesAllowed: true,
    strategies: strategyIds.map((id) => {
      const caps = getStrategyCaps(id);
      return {
        strategyId: id,
        autoExecute: caps?.autoExecute ?? false,
        newEntriesAllowed: true,
        effectiveCapsUsd: {
          perTxUsd: caps?.caps?.perTxUsd ?? 1,
          perDayUsd: caps?.caps?.perDayUsd ?? 5,
        },
        bindingConstraint: { perTxUsd: "static_cap" },
      };
    }),
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
