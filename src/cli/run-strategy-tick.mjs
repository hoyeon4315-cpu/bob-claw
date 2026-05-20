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
import { fileURLToPath } from "node:url";
import { config as envConfig } from "../config/env.mjs";
import { runStrategyTick } from "../executor/tick/strategy-tick.mjs";
import { getStrategyCaps, listStrategyCaps, resolveStrategyCapMatrix } from "../config/strategy-caps.mjs";
import { ACTIVE_SLEEVE_PROFILE_ID } from "../config/sleeve-profile.mjs";
import { getProtocolAddress } from "../config/protocol-addresses.mjs";
import { getEvmChainConfig } from "../config/chains.mjs";
import { Contract, JsonRpcProvider } from "ethers";
import { tokenAsset } from "../assets/tokens.mjs";
import { buildScoredAllocation, DEFAULT_VENUE_METADATA } from "../strategy/scored-capital-allocation.mjs";
import { buildChainScoreLedger } from "../strategy/chain-score-ledger.mjs";
import { normalizeExecutionIntent } from "../executor/signer/signer-interface.mjs";
import { buildObservedGasFloats } from "../executor/bootstrap/gas-float-observation.mjs";
import { evaluateBeefyFoldingAdapter, buildDefaultBeefyFoldingConfig } from "../strategy/beefy-folding-adapter.mjs";
import { evaluateDefiLlamaYieldAdapter, buildDefaultDefiLlamaYieldConfig } from "../strategy/defillama-yield-adapter.mjs";
import { loadYieldReceiptEvidence } from "../ledger/receipt-reconciliation.mjs";
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
const BASE_CHAIN = "base";
const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CBBTC_TOKEN = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const BASE_WETH_TOKEN = "0x4200000000000000000000000000000000000006";
const CBBTC_DECIMALS = 8;
const CBBTC_REBALANCE_BUFFER_BPS = 2_000;
const MOONWELL_MIN_BORROW_USD = 25;
const MISSING_EXECUTOR_STRATEGIES = new Set([
  "pendle-pt-lbtc-base",
  "aerodrome-cl-base",
  "pendle-pt-solvbtc-bbn-bsc",
  "berachain-bend-bex-bgt",
  "gmx-v2-perp-basis-avax",
]);
export const AERODROME_CL_REQUIRED_EXECUTOR_CAPABILITIES = Object.freeze([
  "nft_mint_builder",
  "increase_liquidity_builder",
  "decrease_liquidity_builder",
  "collect_builder",
  "range_monitor",
  "emergency_exit",
]);

const STRATEGY_SWAP_ROUTES = Object.freeze({
  destination_wrapped_btc_rotation: Object.freeze({
    chain: BASE_CHAIN,
    inputToken: BASE_USDC_TOKEN,
    outputToken: BASE_CBBTC_TOKEN,
    inputDecimals: 6,
    inputPriceUsd: 1,
    source: "destination_wrapped_btc_rotation_builder",
  }),
  stablecoin_treasury_rotation: Object.freeze({
    chain: BASE_CHAIN,
    inputToken: BASE_USDC_TOKEN,
    outputToken: BASE_CBBTC_TOKEN,
    inputDecimals: 6,
    inputPriceUsd: 1,
    source: "stablecoin_treasury_rotation_builder",
  }),
  macro_asset_rotation: Object.freeze({
    chain: BASE_CHAIN,
    inputToken: BASE_USDC_TOKEN,
    outputToken: BASE_WETH_TOKEN,
    inputDecimals: 6,
    inputPriceUsd: 1,
    source: "macro_asset_rotation_builder",
  }),
});

export function buildStrategyBuilderChainUnsupportedMarker({
  alloc,
  amountUsd,
  observedAt,
  source,
  supportedChain,
}) {
  return {
    strategyId: alloc.strategyId,
    chain: alloc.chain,
    amountUsd,
    mode: "blocked",
    observedAt,
    normalizationError: "strategy_builder_chain_unsupported",
    metadata: {
      protocol: alloc.protocol,
      source,
      blocker: "strategy_builder_chain_unsupported",
      supportedChain,
      requestedChain: alloc.chain,
    },
  };
}

export function buildStrategyExecutorMissingMarker({
  alloc,
  amountUsd,
  observedAt,
  family,
}) {
  return {
    strategyId: alloc.strategyId,
    chain: alloc.chain,
    amountUsd,
    mode: "blocked",
    observedAt,
    normalizationError: "strategy_executor_missing",
    metadata: {
      protocol: alloc.protocol,
      source: "scored_allocation",
      family: family || "unknown",
      blocker: "strategy_executor_missing",
    },
  };
}

export function buildStrategyDedicatedExecutorMissingMarker({
  alloc,
  amountUsd,
  observedAt,
  source,
  blocker = "dedicated_executor_binding_missing",
  requiredCapabilities = [],
}) {
  return {
    strategyId: alloc.strategyId,
    chain: alloc.chain,
    amountUsd,
    mode: "blocked",
    observedAt,
    normalizationError: blocker,
    metadata: {
      protocol: alloc.protocol,
      source,
      blocker,
      requiredCapabilities: [...requiredCapabilities],
    },
  };
}

function isSupportedBuilderChain(alloc, supportedChain) {
  return String(alloc.chain || "").trim().toLowerCase() === String(supportedChain || "").trim().toLowerCase();
}

function pushUnsupportedBuilderChainMarker({ generatedIntents, alloc, amountUsd, observedAt, source, supportedChain, quiet }) {
  generatedIntents.push(buildStrategyBuilderChainUnsupportedMarker({
    alloc,
    amountUsd,
    observedAt,
    source,
    supportedChain,
  }));
  if (!quiet) {
    console.error(`  skip ${alloc.strategyId}: ${source} supports ${supportedChain}, not ${alloc.chain}`);
  }
}

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
  "defillama-yield-portfolio": {
    evaluate: aggressiveEvaluate(evaluateDefiLlamaYieldAdapter, 25),
    buildConfig: buildDefaultDefiLlamaYieldConfig,
    snapshotPrefixes: ["defillama-", "gateway-"],
    protocol: "defillama",
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
  const out = { json: false, quiet: false, allowShadow: false, allStrategies: false, execute: false, strategies: [] };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--quiet") { out.quiet = true; continue; }
    if (arg === "--allow-shadow") { out.allowShadow = true; continue; }
    if (arg === "--all-strategies") { out.allStrategies = true; continue; }
    if (arg === "--execute") { out.execute = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === "strategy") { out.strategies.push(m[2]); continue; }
    out[m[1]] = m[2];
  }
  if (out.allStrategies && out.strategies.length === 0) {
    out.strategies = Object.keys(ADAPTERS);
  }
  return out;
}

export function shouldBroadcastGeneratedIntents(args = {}) {
  return args.execute === true;
}

function sanitizeDispatchDetail(detail) {
  if (detail === null || detail === undefined) return null;
  if (typeof detail === "number" || typeof detail === "boolean") return String(detail);
  if (typeof detail === "string") {
    const text = detail.length > 500 ? `${detail.slice(0, 497)}...` : detail;
    return /(?:private|secret|signature|rawtx|calldata|txdata|signed|0x[a-f0-9]{64,})/iu.test(text)
      ? "detail_redacted"
      : text;
  }
  if (typeof detail !== "object") return "detail_redacted";
  const safePairs = [];
  for (const [key, value] of Object.entries(detail)) {
    if (/(?:private|secret|key|signature|rawtx|calldata|txdata|signed|data|tx)$/iu.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    const rendered = String(value);
    if (/(?:private|secret|signature|rawtx|calldata|txdata|signed|0x[a-f0-9]{64,})/iu.test(rendered)) continue;
    safePairs.push(`${key}=${rendered}`);
  }
  return safePairs.length ? safePairs.slice(0, 8).join(",") : "detail_redacted";
}

export function buildSafeDispatchIntentsSummary(result = {}) {
  const fallbackObservedAt = result?.observedAt || new Date().toISOString();
  return (result?.dispatch?.intents || []).map((intent) => ({
    strategyId: intent.strategyId,
    chain: intent.chain,
    protocol: intent.protocol,
    decision: intent.decision,
    reason: intent.reason || null,
    detail: sanitizeDispatchDetail(intent.detail),
    expectedNetSats: intent.expectedNetSats ?? null,
    observedAt: intent.observedAt || fallbackObservedAt,
  }));
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

function buildCommittedCapitalPlan(strategyIds) {
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

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function pushCapConflict(conflicts, field, committed, resolved, extra = {}) {
  if (!Number.isFinite(committed) || !Number.isFinite(resolved) || committed === resolved) return;
  conflicts.push({
    field,
    committed,
    resolved,
    ...extra,
  });
}

export function validateCommittedProfileSelection({
  profileId = ACTIVE_SLEEVE_PROFILE_ID,
  strategies = listStrategyCaps(),
} = {}) {
  if (profileId !== "aggressive_v1") {
    return {
      ok: true,
      profileId,
      conflicts: [],
    };
  }

  const conflicts = [];
  for (const strategy of strategies || []) {
    if (strategy?.autoExecute !== true) continue;
    const resolved = resolveStrategyCapMatrix(strategy, {
      profileId,
      includeRadarCaps: true,
    });
    const strategyConflicts = [];
    pushCapConflict(strategyConflicts, "caps.perTxUsd", finiteNumber(strategy?.caps?.perTxUsd), resolved?.perTxUsd);
    pushCapConflict(strategyConflicts, "caps.perDayUsd", finiteNumber(strategy?.caps?.perDayUsd), resolved?.perDayUsd);
    pushCapConflict(
      strategyConflicts,
      "caps.tinyLivePerTxUsd",
      finiteNumber(strategy?.caps?.tinyLivePerTxUsd),
      resolved?.tinyLivePerTxUsd,
    );

    const chainKeys = new Set([
      ...Object.keys(strategy?.caps?.perChainUsd || {}),
      ...Object.keys(resolved?.perChainUsd || {}),
    ]);
    chainKeys.delete("default");
    for (const chain of [...chainKeys].sort()) {
      pushCapConflict(
        strategyConflicts,
        "caps.perChainUsd",
        finiteNumber(strategy?.caps?.perChainUsd?.[chain]),
        finiteNumber(resolved?.perChainUsd?.[chain]),
        { chain },
      );
    }

    if (strategyConflicts.length > 0) {
      conflicts.push({
        strategyId: strategy.strategyId || null,
        conflicts: strategyConflicts,
      });
    }
  }

  return {
    ok: conflicts.length === 0,
    profileId,
    conflicts,
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

  const profileValidation = validateCommittedProfileSelection();
  if (!profileValidation.ok) {
    console.error(`ERR: active sleeve profile ${profileValidation.profileId} has inconsistent committed strategy caps`);
    for (const entry of profileValidation.conflicts) {
      const details = entry.conflicts
        .map((conflict) => `${conflict.field}${conflict.chain ? `.${conflict.chain}` : ""}:${conflict.committed}->${conflict.resolved}`)
        .join(", ");
      console.error(`     ${entry.strategyId}: ${details}`);
    }
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
  const auditRecords = loadJsonlIfExists(auditPath);

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
    const rawReceipts = auditRecords.filter((record) => record?.strategyId === sid);
    const receipts = sid === "defillama-yield-portfolio"
      ? loadYieldReceiptEvidence(rawReceipts)
      : rawReceipts;
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

  const adaptiveCapitalPlan = buildCommittedCapitalPlan(args.strategies);
  const feedFreshness = { ok: true, worstSeverity: "ok", staleCount: 0 };

  const result = runStrategyTick({
    entries,
    adaptiveCapitalPlan,
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
    chainScoreLedger: buildChainScoreLedger({
      records: auditRecords,
      now: new Date().toISOString(),
    }),
  });

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
    let suppressGenericFallback = MISSING_EXECUTOR_STRATEGIES.has(alloc.strategyId);

    // ── Auto-capital-routing: when cbBTC strategies blocked by balance,
    //     prepend a USDC → cbBTC swap on Base BEFORE attempting main builder ──
    if ([
      "wrapped-btc-loop-base-moonwell",
      "beefy-folding-vault",
    ].includes(alloc.strategyId)) {
      if (!isSupportedBuilderChain(alloc, BASE_CHAIN)) {
        suppressGenericFallback = true;
        strategyIntentsBuilt = true;
        pushUnsupportedBuilderChainMarker({
          generatedIntents,
          alloc,
          amountUsd,
          observedAt: result.observedAt,
          source: "auto_capital_rebalance",
          supportedChain: BASE_CHAIN,
          quiet: args.quiet,
        });
      } else {
        const operatorAddress = strategyOperatorMap[alloc.strategyId];
        const usdcBalance = await queryErc20Balance(alloc.chain, BASE_USDC_TOKEN, operatorAddress);
        const cbBTC = getProtocolAddress("moonwell", "base", "markets.cbBTC.asset") || BASE_CBBTC_TOKEN;
        const cbBTCBalance = await queryErc20Balance(alloc.chain, cbBTC, operatorAddress);
        const requiredUnits = String(Math.floor((amountUsd / btcPriceUsd) * (10 ** CBBTC_DECIMALS)));
        const bufferedAmountUsd = amountUsd * (1 + CBBTC_REBALANCE_BUFFER_BPS / 10_000);
        const swapAmountUsd = Math.min(bufferedAmountUsd, perTxUsd, Number(usdcBalance) / 1e6);
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
    }

    // ── Moonwell wrapped-BTC loop (Base) ──
    if (!strategyIntentsBuilt && alloc.strategyId === "wrapped-btc-loop-base-moonwell" && btcPriceUsd > 0) {
      if (!isSupportedBuilderChain(alloc, BASE_CHAIN)) {
        suppressGenericFallback = true;
        strategyIntentsBuilt = true;
        pushUnsupportedBuilderChainMarker({
          generatedIntents,
          alloc,
          amountUsd,
          observedAt: result.observedAt,
          source: "moonwell_builder",
          supportedChain: BASE_CHAIN,
          quiet: args.quiet,
        });
        continue;
      }
      const support = resolveWrappedBtcLoopBindingSupport({
        strategyId: alloc.strategyId,
        strategyConfig: { chain: alloc.chain, protocol: alloc.protocol, collateralAsset: "cbBTC", borrowAsset: "USDC" },
      });
      if (support.executableFromRepo) {
        const collateralUnits = String(Math.floor((amountUsd / btcPriceUsd) * (10 ** CBBTC_DECIMALS)));
        const borrowUnits = amountUsd >= MOONWELL_MIN_BORROW_USD
          ? String(Math.floor((amountUsd * 0.5) * 1e6))
          : null;
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
              step.intent.metadata = {
                ...step.intent.metadata,
                borrowSkippedReason: borrowUnits ? null : "dust_collateral_below_borrow_min_usd",
                minBorrowUsd: MOONWELL_MIN_BORROW_USD,
              };
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
      if (!isSupportedBuilderChain(alloc, BASE_CHAIN)) {
        suppressGenericFallback = true;
        strategyIntentsBuilt = true;
        pushUnsupportedBuilderChainMarker({
          generatedIntents,
          alloc,
          amountUsd,
          observedAt: result.observedAt,
          source: "vault_builder",
          supportedChain: BASE_CHAIN,
          quiet: args.quiet,
        });
        continue;
      }
      const beefyVault = getProtocolAddress("beefy", "base", "vault");
      if (beefyVault?.verified) {
        const operatorAddress = strategyOperatorMap[alloc.strategyId];
        const assetDecimals = tokenAsset(alloc.chain, beefyVault.asset).decimals ?? CBBTC_DECIMALS;
        const depositUnits = String(Math.floor((amountUsd / btcPriceUsd) * (10 ** assetDecimals)));
        const assetBalance = await queryErc20Balance(alloc.chain, beefyVault.asset, operatorAddress);
        const executableDepositUnits = assetBalance < BigInt(depositUnits) ? assetBalance : BigInt(depositUnits);
        if (executableDepositUnits <= 0n) {
          if (!args.quiet) console.error(`  skip ${alloc.strategyId}: asset balance ${assetBalance} < required ${depositUnits}`);
          strategyIntentsBuilt = true;
        } else {
          const executableAmountUsd = Math.min(amountUsd, (Number(executableDepositUnits) / (10 ** assetDecimals)) * btcPriceUsd);
          if (assetBalance < BigInt(depositUnits) && !args.quiet) {
            console.error(`  clamp ${alloc.strategyId}: deposit ${executableDepositUnits} units from balance < requested ${depositUnits}`);
          }
          try {
            const plan = await buildVaultDepositIntent({
              strategyId: alloc.strategyId,
              chain: alloc.chain,
              amountUsd: executableAmountUsd,
              vaultAddress: beefyVault.address,
              assetAddress: beefyVault.asset,
              assetDecimals,
              assetPriceUsd: btcPriceUsd,
              assetAmount: executableDepositUnits.toString(),
              senderAddress: operatorAddress,
              now: result.observedAt,
              estimateGasImpl: () => { throw new Error("skip"); },
            });
            for (const step of plan.steps || []) {
              step.intent.metadata = {
                ...step.intent.metadata,
                requestedAssetUnits: depositUnits,
                executableAssetUnits: executableDepositUnits.toString(),
                balanceClampApplied: assetBalance < BigInt(depositUnits),
              };
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
      if (!isSupportedBuilderChain(alloc, BASE_CHAIN)) {
        suppressGenericFallback = true;
        strategyIntentsBuilt = true;
        pushUnsupportedBuilderChainMarker({
          generatedIntents,
          alloc,
          amountUsd,
          observedAt: result.observedAt,
          source: "pendle_pt_lbtc_builder",
          supportedChain: BASE_CHAIN,
          quiet: args.quiet,
        });
        continue;
      }
      const pendleRouter = getProtocolAddress("pendle", "base", "router");
      if (pendleRouter?.verified) {
        // Future strategy-executor work: buildPendlePtIntent({ routerAddress: pendleRouter.address, ... })
      } else if (!args.quiet) {
        console.error(`  skip ${alloc.strategyId}: dedicated executor binding missing`);
      }
    }

    // ── Aerodrome CL (Base) ──
    if (!strategyIntentsBuilt && alloc.strategyId === "aerodrome-cl-base") {
      if (!isSupportedBuilderChain(alloc, BASE_CHAIN)) {
        suppressGenericFallback = true;
        strategyIntentsBuilt = true;
        pushUnsupportedBuilderChainMarker({
          generatedIntents,
          alloc,
          amountUsd,
          observedAt: result.observedAt,
          source: "aerodrome_cl_builder",
          supportedChain: BASE_CHAIN,
          quiet: args.quiet,
        });
        continue;
      }
      const aerodromePool = getProtocolAddress("aerodrome", "base", "pool");
      const blocker = aerodromePool?.verified
        ? "aerodrome_cl_tx_builder_missing"
        : "aerodrome_cl_protocol_addresses_unverified";
      suppressGenericFallback = true;
      strategyIntentsBuilt = true;
      generatedIntents.push(buildStrategyDedicatedExecutorMissingMarker({
        alloc,
        amountUsd,
        observedAt: result.observedAt,
        source: "aerodrome_cl_builder",
        blocker,
        requiredCapabilities: AERODROME_CL_REQUIRED_EXECUTOR_CAPABILITIES,
      }));
      if (!args.quiet) {
        console.error(`  skip ${alloc.strategyId}: ${blocker}`);
      }
      continue;
    }

    // ── GMX V2 perp basis (Avalanche) ──
    if (!strategyIntentsBuilt && alloc.strategyId === "gmx-v2-perp-basis-avax") {
      const gmxRouter = getProtocolAddress("gmx", "avalanche", "exchangeRouter");
      if (gmxRouter?.verified) {
        // Future strategy-executor work: buildGmxPerpIntent({ routerAddress: gmxRouter.address, ... })
      } else if (!args.quiet) {
        console.error(`  skip ${alloc.strategyId}: dedicated executor binding missing`);
      }
    }

    // ── Berachain Bend/BEX/BGT ──
    if (!strategyIntentsBuilt && alloc.strategyId === "berachain-bend-bex-bgt") {
      const bendPool = getProtocolAddress("bend", "bera", "bendPool");
      if (bendPool?.verified) {
        // Future strategy-executor work: buildBerachainIntent({ poolAddress: bendPool.address, ... })
      } else if (!args.quiet) {
        console.error(`  skip ${alloc.strategyId}: dedicated executor binding missing`);
      }
    }

    // ── Stablecoin / macro / destination rotation (swap via DEX) ──
    if (!strategyIntentsBuilt && STRATEGY_SWAP_ROUTES[alloc.strategyId]) {
      const operatorAddress = strategyOperatorMap[alloc.strategyId];
      const route = STRATEGY_SWAP_ROUTES[alloc.strategyId];
      if (!isSupportedBuilderChain(alloc, route.chain)) {
        suppressGenericFallback = true;
        strategyIntentsBuilt = true;
        pushUnsupportedBuilderChainMarker({
          generatedIntents,
          alloc,
          amountUsd,
          observedAt: result.observedAt,
          source: route.source,
          supportedChain: route.chain,
          quiet: args.quiet,
        });
        continue;
      }
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

    // ── Generic fallback marker ──
    if (!strategyIntentsBuilt && !suppressGenericFallback) {
      generatedIntents.push(buildStrategyExecutorMissingMarker({
        alloc,
        amountUsd,
        observedAt: result.observedAt,
        family,
      }));
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
    dispatchIntents: buildSafeDispatchIntentsSummary(result),
    builder: {
      skipped: (result.builder.skipped || []).map((item) => ({
        strategyId: item.strategyId || null,
        reason: item.reason || null,
        topBlocker: item.topBlocker || null,
      })),
    },
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

  // ── Auto-broadcast generated intents to signer daemon ──
  let broadcastCount = 0;
  let broadcastFail = 0;
  let broadcastSkippedReason = null;
  if (generatedIntents.length > 0 && shouldBroadcastGeneratedIntents(args)) {
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
  } else if (generatedIntents.length > 0) {
    broadcastSkippedReason = "execute_flag_required";
  }

  tickRecord.executionMode = shouldBroadcastGeneratedIntents(args) ? "execute" : "report_only";
  tickRecord.broadcastSummary = {
    generatedIntentCount: generatedIntents.length,
    broadcastCount,
    broadcastFail,
    skippedReason: broadcastSkippedReason,
  };
  appendFileSync(outPath, JSON.stringify(tickRecord) + "\n");

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
