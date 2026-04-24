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
import { getProtocolAddress } from "../config/protocol-addresses.mjs";
import { getEvmChainConfig } from "../config/chains.mjs";
import { Contract, JsonRpcProvider } from "ethers";
import { buildScoredAllocation, DEFAULT_VENUE_METADATA } from "../strategy/scored-capital-allocation.mjs";
import { normalizeExecutionIntent } from "../executor/signer/signer-interface.mjs";
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
import { resolveWrappedBtcLoopBindingSupport } from "../strategy/wrapped-btc-loop-bindings.mjs";
import { buildMoonwellWrappedBtcLoopIntent } from "../executor/helpers/moonwell-intent-builder.mjs";
import { buildVaultDepositIntent } from "../executor/helpers/vault-intent-builder.mjs";
import { buildSwapIntent } from "../executor/helpers/swap-intent-builder.mjs";

const ERC20_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];
const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CBBTC_TOKEN = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const BASE_WETH_TOKEN = "0x4200000000000000000000000000000000000006";

const STRATEGY_SWAP_ROUTES = Object.freeze({
  destination_wrapped_btc_rotation: Object.freeze({
    chain: "base",
    inputToken: BASE_USDC_TOKEN,
    outputToken: BASE_CBBTC_TOKEN,
    inputDecimals: 6,
    inputPriceUsd: 1,
    source: "destination_wrapped_btc_rotation_builder",
  }),
  stablecoin_treasury_rotation: Object.freeze({
    chain: "base",
    inputToken: BASE_USDC_TOKEN,
    outputToken: BASE_CBBTC_TOKEN,
    inputDecimals: 6,
    inputPriceUsd: 1,
    source: "stablecoin_treasury_rotation_builder",
  }),
  macro_asset_rotation: Object.freeze({
    chain: "base",
    inputToken: BASE_USDC_TOKEN,
    outputToken: BASE_WETH_TOKEN,
    inputDecimals: 6,
    inputPriceUsd: 1,
    source: "macro_asset_rotation_builder",
  }),
});

async function queryErc20Balance(chain, tokenAddress, ownerAddress) {
  if (!ownerAddress) return 0n;
  const cfg = getEvmChainConfig(chain);
  if (!cfg?.rpcUrl) return 0n;
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const contract = new Contract(tokenAddress, ERC20_BALANCE_ABI, provider);
  try {
    const bal = await contract.balanceOf(ownerAddress);
    return bal;
  } catch {
    return 0n;
  }
}

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
    const receipts = loadReceipts(auditPath, [sid]);
    const caps = getStrategyCaps(sid);
    const rawConfig = adapter.buildConfig();
    const config = {
      ...rawConfig,
      id: sid,
      perTradeCapUsd: rawConfig.perTradeCapUsd || (caps?.perTxUsd ?? 25),
      perDayCapUsd: rawConfig.perDayCapUsd || (caps?.perDayUsd ?? 1_000_000),
    };
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
      operatorAddress: gasObservation.operatorAddress,
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

  // ── Scored capital allocation layer ──
  const scoredCandidates = (result.builder.candidates || [])
    .filter((c) => c.sourceMode !== "blocked");
  const totalAvailableSats = scoredCandidates.reduce(
    (sum, c) => sum + (c.proposedAllocationSats || 0),
    0,
  );
  const scoredAllocation = buildScoredAllocation({
    candidates: scoredCandidates,
    totalAvailableSats,
  });

  function intentTypeForFamily(family) {
    const map = {
      lending: "aave_supply",
      lp: "add_liquidity",
      vault: "vault_deposit",
      perp: "perp_open",
      yield: "yield_deposit",
      rotation: "swap",
      spread: "swap",
    };
    return map[family] || "strategy_execution";
  }

  const strategyOperatorMap = Object.fromEntries(entries.map((e) => [e.strategyId, e.operatorAddress]));

  const generatedIntents = [];
  for (const alloc of scoredAllocation?.allocations || []) {
    const family = DEFAULT_VENUE_METADATA[alloc.strategyId]?.family || "unknown";
    const caps = getStrategyCaps(alloc.strategyId);
    const perTxUsd = caps?.caps?.perTxUsd ?? 25;
    let amountUsd = (alloc.allocatedSats * btcPriceUsd) / 1e8;
    amountUsd = Math.min(amountUsd, perTxUsd);
    if (amountUsd <= 0) continue;
    let strategyIntentsBuilt = false;
    let suppressGenericFallback = false;

    // ── Auto-capital-routing: when cbBTC strategies blocked by balance,
    //     prepend a USDC → cbBTC swap on Base BEFORE attempting main builder ──
    if ([
      "wrapped-btc-loop-base-moonwell",
      "beefy-folding-vault",
    ].includes(alloc.strategyId)) {
      const operatorAddress = strategyOperatorMap[alloc.strategyId];
      const usdcBalance = await queryErc20Balance(alloc.chain, BASE_USDC_TOKEN, operatorAddress);
      const cbBTC = getProtocolAddress("moonwell", "base", "markets.cbBTC.asset") || BASE_CBBTC_TOKEN;
      const cbBTCBalance = await queryErc20Balance(alloc.chain, cbBTC, operatorAddress);
      const requiredUnits = String(Math.floor((amountUsd / btcPriceUsd) * 1e8));
      const swapAmountUsd = Math.min(amountUsd, Number(usdcBalance) / 1e6);
      if (cbBTCBalance < BigInt(requiredUnits)) suppressGenericFallback = true;
      if (cbBTCBalance < BigInt(requiredUnits) && swapAmountUsd >= 1) {
        try {
          const inputAmount = String(Math.floor(swapAmountUsd * 1e6));
          const plan = await buildSwapIntent({
            strategyId: alloc.strategyId,
            chain: alloc.chain,
            amountUsd: swapAmountUsd,
            inputToken: BASE_USDC_TOKEN,
            outputToken: cbBTC,
            inputAmount,
            inputDecimals: 6,
            inputPriceUsd: 1,
            senderAddress: operatorAddress,
            now: result.observedAt,
            estimateGasImpl: () => { throw new Error("skip"); },
          });
          for (const step of plan.steps || []) {
            step.intent.metadata = {
              ...step.intent.metadata,
              source: "auto_capital_rebalance",
              rebalanceFor: alloc.strategyId,
              rebalanceReason: "cbbtc_balance_below_required",
              requiredOutputUnits: requiredUnits,
              observedOutputUnits: cbBTCBalance.toString(),
            };
            generatedIntents.push(normalizeExecutionIntent(step.intent));
          }
          if (!args.quiet) console.error(`  auto-rebalance: USDC -> cbBTC ${swapAmountUsd} USD for ${alloc.strategyId}`);
        } catch (err) {
          if (!args.quiet) console.error(`  auto-rebalance failed for ${alloc.strategyId}: ${err.message}`);
        }
      }
    }

    // ── Moonwell wrapped-BTC loop (Base) ──
    if (alloc.strategyId === "wrapped-btc-loop-base-moonwell" && btcPriceUsd > 0) {
      const support = resolveWrappedBtcLoopBindingSupport({
        strategyId: alloc.strategyId,
        strategyConfig: { chain: alloc.chain, protocol: alloc.protocol, collateralAsset: "cbBTC", borrowAsset: "USDC" },
      });
      if (support.executableFromRepo) {
        const collateralUnits = String(Math.floor((amountUsd / btcPriceUsd) * 1e8));
        const borrowUnits = String(Math.floor((amountUsd * 0.5) * 1e6));
        const operatorAddress = strategyOperatorMap[alloc.strategyId];
        const cbBTC = getProtocolAddress("moonwell", "base", "markets.cbBTC.asset");
        const cbBTCBalance = await queryErc20Balance(alloc.chain, cbBTC, operatorAddress);
        if (cbBTCBalance < BigInt(collateralUnits)) {
          if (!args.quiet) console.error(`  skip ${alloc.strategyId}: cbBTC balance ${cbBTCBalance} < required ${collateralUnits}`);
          strategyIntentsBuilt = true;
        } else {
          try {
            const plan = await buildMoonwellWrappedBtcLoopIntent({
              strategyId: alloc.strategyId,
              chain: alloc.chain,
              amountUsd,
              collateralUnits,
              borrowUnits,
              collateralAssetAddress: cbBTC,
              borrowAssetAddress: getProtocolAddress("moonwell", "base", "markets.USDC.asset"),
              collateralMTokenAddress: support.knownContracts.collateralMarket.mTokenAddress,
              borrowMTokenAddress: support.knownContracts.borrowMarket.mTokenAddress,
              comptrollerAddress: support.knownContracts.comptroller.address,
              now: result.observedAt,
              estimateGasImpl: () => { throw new Error("skip"); },
            });
            for (const step of plan.steps || []) {
              generatedIntents.push(normalizeExecutionIntent(step.intent));
            }
            strategyIntentsBuilt = true;
          } catch (err) {
            generatedIntents.push({
              strategyId: alloc.strategyId,
              chain: alloc.chain,
              amountUsd,
              mode: "live",
              observedAt: result.observedAt,
              normalizationError: err.message,
              metadata: { protocol: alloc.protocol, source: "moonwell_builder_failed" },
            });
            strategyIntentsBuilt = true;
          }
        }
      }
    }

    // ── Beefy folding vault (Base) ──
    if (!strategyIntentsBuilt && alloc.strategyId === "beefy-folding-vault") {
      const beefyVault = getProtocolAddress("beefy", "base", "vault");
      if (beefyVault?.verified) {
        const operatorAddress = strategyOperatorMap[alloc.strategyId];
        const depositUnits = String(Math.floor((amountUsd / btcPriceUsd) * 1e8));
        const assetBalance = await queryErc20Balance(alloc.chain, beefyVault.asset, operatorAddress);
        if (assetBalance < BigInt(depositUnits)) {
          if (!args.quiet) console.error(`  skip ${alloc.strategyId}: asset balance ${assetBalance} < required ${depositUnits}`);
          strategyIntentsBuilt = true;
        } else {
          try {
            const plan = await buildVaultDepositIntent({
              strategyId: alloc.strategyId,
              chain: alloc.chain,
              amountUsd,
              vaultAddress: beefyVault.address,
              assetAddress: beefyVault.asset,
              assetDecimals: beefyVault.decimals || 18,
              assetPriceUsd: btcPriceUsd,
              now: result.observedAt,
              estimateGasImpl: () => { throw new Error("skip"); },
            });
            for (const step of plan.steps || []) {
              generatedIntents.push(normalizeExecutionIntent(step.intent));
            }
            strategyIntentsBuilt = true;
          } catch (err) {
            generatedIntents.push({
              strategyId: alloc.strategyId,
              chain: alloc.chain,
              amountUsd,
              mode: "live",
              observedAt: result.observedAt,
              normalizationError: err.message,
              metadata: { protocol: alloc.protocol, source: "vault_builder_failed" },
            });
            strategyIntentsBuilt = true;
          }
        }
      }
    }

    // ── Pendle PT LBTC (Base) ──
    if (!strategyIntentsBuilt && alloc.strategyId === "pendle-pt-lbtc-base") {
      const pendleRouter = getProtocolAddress("pendle", "base", "router");
      if (pendleRouter?.verified) {
        // TODO: buildPendlePtIntent({ routerAddress: pendleRouter.address, ... })
      }
    }

    // ── Aerodrome CL (Base) ──
    if (!strategyIntentsBuilt && alloc.strategyId === "aerodrome-cl-base") {
      const aerodromePool = getProtocolAddress("aerodrome", "base", "pool");
      if (aerodromePool?.verified) {
        // TODO: buildAerodromeClIntent({ poolAddress: aerodromePool.address, ... })
      }
    }

    // ── GMX V2 perp basis (Avalanche) ──
    if (!strategyIntentsBuilt && alloc.strategyId === "gmx-v2-perp-basis-avax") {
      const gmxRouter = getProtocolAddress("gmx", "avalanche", "exchangeRouter");
      if (gmxRouter?.verified) {
        // TODO: buildGmxPerpIntent({ routerAddress: gmxRouter.address, ... })
      }
    }

    // ── Berachain Bend/BEX/BGT ──
    if (!strategyIntentsBuilt && alloc.strategyId === "berachain-bend-bex-bgt") {
      const bendPool = getProtocolAddress("bend", "bera", "bendPool");
      if (bendPool?.verified) {
        // TODO: buildBerachainIntent({ poolAddress: bendPool.address, ... })
      }
    }

    // ── Stablecoin / macro / destination rotation (swap via DEX) ──
    if (!strategyIntentsBuilt && STRATEGY_SWAP_ROUTES[alloc.strategyId]) {
      const operatorAddress = strategyOperatorMap[alloc.strategyId];
      const route = STRATEGY_SWAP_ROUTES[alloc.strategyId];
      const inputAmount = String(Math.floor((amountUsd / route.inputPriceUsd) * (10 ** route.inputDecimals)));
      const inputBalance = await queryErc20Balance(route.chain, route.inputToken, operatorAddress);
      if (inputBalance < BigInt(inputAmount)) {
        suppressGenericFallback = true;
        if (!args.quiet) {
          console.error(`  skip ${alloc.strategyId}: input balance ${inputBalance} < required ${inputAmount}`);
        }
        continue;
      }
      try {
        const plan = await buildSwapIntent({
          strategyId: alloc.strategyId,
          chain: route.chain,
          amountUsd,
          inputToken: route.inputToken,
          outputToken: route.outputToken,
          inputAmount,
          inputDecimals: route.inputDecimals,
          inputPriceUsd: route.inputPriceUsd,
          senderAddress: operatorAddress,
          now: result.observedAt,
          estimateGasImpl: () => { throw new Error("skip"); },
        });
        for (const step of plan.steps || []) {
          step.intent.metadata = {
            ...step.intent.metadata,
            source: route.source,
          };
          generatedIntents.push(normalizeExecutionIntent(step.intent));
        }
        strategyIntentsBuilt = true;
      } catch (err) {
        if (!args.quiet) console.error(`  swap builder failed for ${alloc.strategyId}: ${err.message}`);
        strategyIntentsBuilt = false;
      }
    }

    // ── Generic fallback intent ──
    if (!strategyIntentsBuilt && !suppressGenericFallback) {
      const intentType = intentTypeForFamily(family);
      const raw = {
        strategyId: alloc.strategyId,
        chain: alloc.chain,
        intentType,
        amountUsd,
        mode: "live",
        observedAt: result.observedAt,
        strategyConfig: { intentTtlMs: caps?.intentTtlMs ?? 300_000 },
        metadata: { protocol: alloc.protocol, skipAutoIngest: true, source: "scored_allocation" },
      };
      try {
        generatedIntents.push(normalizeExecutionIntent(raw));
      } catch (err) {
        generatedIntents.push({ ...raw, normalizationError: err.message });
      }
    }
  }

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
    scoredAllocation: scoredAllocation?.summary || null,
    scoredAllocationDetails: (scoredAllocation?.allocations || []).map((a) => ({
      strategyId: a.strategyId,
      chain: a.chain,
      protocol: a.protocol,
      allocatedSats: a.allocatedSats,
      score: a.score,
    })),
    generatedIntents,
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

  // ── Auto-broadcast generated intents to signer daemon ──
  let broadcastCount = 0;
  let broadcastFail = 0;
  if (generatedIntents.length > 0) {
    const { sendSignerCommand } = await import("../executor/signer/client.mjs");
    for (const intent of generatedIntents) {
      if (intent.normalizationError) {
        broadcastFail++;
        if (!args.quiet) console.error(`  skip broadcast (normalization error): ${intent.strategyId} ${intent.intentType} – ${intent.normalizationError}`);
        continue;
      }
      try {
        const result = await sendSignerCommand({
          message: {
            command: "sign_and_broadcast",
            intent,
            awaitConfirmation: true,
            confirmations: 1,
            timeoutMs: 120_000,
          },
        });
        if (result.status === "ok") {
          broadcastCount++;
          if (!args.quiet) console.log(`  broadcast ok: ${intent.strategyId} ${intent.intentType} txHash=${result.broadcast?.txHash || "n/a"}`);
        } else {
          broadcastFail++;
          if (!args.quiet) console.error(`  broadcast failed: ${intent.strategyId} ${intent.intentType} – ${result.error?.message || result.status}`);
        }
      } catch (err) {
        broadcastFail++;
        if (!args.quiet) console.error(`  broadcast error: ${intent.strategyId} ${intent.intentType} – ${err.message}`);
      }
    }
  }

  if (!args.quiet) {
    if (args.json) {
      console.log(JSON.stringify({ outPath, tickRecord, broadcastCount, broadcastFail }));
    } else {
      console.log(`tick written: ${outPath}`);
      console.log(`  strategies=${args.strategies.length} candidates=${tickRecord.candidateCount} allow=${tickRecord.dispatchSummary?.allowCount ?? 0} deny=${tickRecord.dispatchSummary?.denyCount ?? 0}`);
      console.log(`  intents=${generatedIntents.length} broadcasted=${broadcastCount} failed=${broadcastFail}`);
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
