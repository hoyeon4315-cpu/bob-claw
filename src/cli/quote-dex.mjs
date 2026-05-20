#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import {
  canQuoteWithDex,
  normalizeDexSupportReason,
  normalizeOdosQuote,
  odosRoutingConfig,
  OdosClient,
  STABLE_QUOTE_TOKENS,
} from "../dex/odos.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readFile } from "node:fs/promises";
import { readJsonl } from "../lib/jsonl-read.mjs";
import {
  isBtcLikeAsset,
  isEthLikeAsset,
  isGoldAsset,
  isStableAsset,
  normalizeToken,
  tokenAsset,
  unitsToDecimal,
} from "../assets/tokens.mjs";
import { latestPriceSnapshot, pricesFromSnapshot } from "../market/prices.mjs";

const SCHEMA_VERSION = 2;
const DEFAULT_STABLE_ENTRY_BUFFER_BPS = 100;

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    allowUnsafeSources: flags.has("--allow-unsafe-sources"),
    routeLimit: options["route-limit"] ? Number(options["route-limit"]) : 24,
    amountLimitUsd: options["amount-limit-usd"] ? Number(options["amount-limit-usd"]) : null,
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
    includeStableEntry: flags.has("--include-stable-entry"),
    stableEntryBufferBps: options["stable-entry-buffer-bps"]
      ? Number(options["stable-entry-buffer-bps"])
      : DEFAULT_STABLE_ENTRY_BUFFER_BPS,
    chains: options.chains
      ? options.chains
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  };
}

function latestByRouteAndAmount(quotes) {
  const latest = new Map();
  for (const quote of quotes) {
    if (!quote.routeKey || !quote.route || !quote.inputAmount || !quote.outputAmount) continue;
    const key = `${quote.routeKey}|${quote.amount}`;
    const existing = latest.get(key);
    if (!existing || new Date(quote.observedAt) > new Date(existing.observedAt)) {
      latest.set(key, quote);
    }
  }
  return [...latest.values()].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
}

function candidateLegsFromGatewayQuote(quote) {
  return [
    {
      source: "gateway_src_leg",
      quoteType: "token_to_stable",
      chain: quote.route.srcChain,
      inputToken: quote.route.srcToken,
      amount: quote.inputAmount,
      gatewayRouteKey: quote.routeKey,
      gatewayObservedAt: quote.observedAt,
      gatewayAmount: quote.amount,
    },
    {
      source: "gateway_dst_leg",
      quoteType: "token_to_stable",
      chain: quote.route.dstChain,
      inputToken: quote.route.dstToken,
      amount: quote.outputAmount,
      gatewayRouteKey: quote.routeKey,
      gatewayObservedAt: quote.observedAt,
      gatewayAmount: quote.amount,
    },
  ].filter((leg) => isPositiveAmount(leg.amount));
}

function decimalToUnits(amount, decimals) {
  if (!Number.isFinite(amount) || !Number.isInteger(decimals) || decimals < 0) return null;
  return String(BigInt(Math.max(0, Math.round(amount * 10 ** decimals))));
}

function scoreKey(routeKey, amount) {
  return `${routeKey}|${amount}`;
}

function scoreMap(scoreSnapshot) {
  const map = new Map();
  for (const score of scoreSnapshot?.scores || []) {
    if (!score?.routeKey || !score?.amount) continue;
    map.set(scoreKey(score.routeKey, score.amount), score);
  }
  return map;
}

function estimateStableEntryAmountUnits({ quote, score, stableEntryBufferBps, prices }) {
  const stable = STABLE_QUOTE_TOKENS[quote?.route?.srcChain];
  const srcAsset = tokenAsset(quote?.route?.srcChain, quote?.route?.srcToken);
  if (!stable || !Number.isInteger(stable.decimals) || !Number.isInteger(srcAsset.decimals)) return null;
  const scoreInputUsd = Number.isFinite(score?.inputUsd) ? score.inputUsd : null;
  const tokenAmount = unitsToDecimal(quote.inputAmount, srcAsset.decimals);
  const marketPriceUsd = Number.isFinite(prices?.tokenByKey?.[srcAsset.priceKey])
    ? prices.tokenByKey[srcAsset.priceKey]
    : null;
  const estimatedUsd =
    scoreInputUsd ??
    (Number.isFinite(tokenAmount) && Number.isFinite(marketPriceUsd) ? tokenAmount * marketPriceUsd : null);
  if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) return null;
  return decimalToUnits(estimatedUsd * (1 + Math.max(0, stableEntryBufferBps) / 10_000), stable.decimals);
}

function isEntryLegEligibleSrcAsset(asset) {
  return isBtcLikeAsset(asset) || isEthLikeAsset(asset) || isGoldAsset(asset) || isStableAsset(asset);
}

function stableEntryLegFromGatewayQuote(quote, { scoresByKey, stableEntryBufferBps, prices }) {
  const stable = STABLE_QUOTE_TOKENS[quote?.route?.srcChain];
  const outputAsset = tokenAsset(quote?.route?.srcChain, quote?.route?.srcToken);
  if (!stable || !isEntryLegEligibleSrcAsset(outputAsset)) return null;
  if (normalizeToken(stable.token) === normalizeToken(quote?.route?.srcToken)) return null;
  const amount = estimateStableEntryAmountUnits({
    quote,
    score: scoresByKey.get(scoreKey(quote.routeKey, quote.amount)) || null,
    stableEntryBufferBps,
    prices,
  });
  if (!isPositiveAmount(amount)) return null;
  return {
    source: "gateway_src_entry_leg",
    quoteType: "stable_to_token",
    chain: quote.route.srcChain,
    inputToken: stable.token,
    outputToken: quote.route.srcToken,
    amount,
    gatewayRouteKey: quote.routeKey,
    gatewayObservedAt: quote.observedAt,
    gatewayAmount: quote.amount,
    targetTokenAmount: quote.inputAmount,
  };
}

function dedupeLegs(legs) {
  const byKey = new Map();
  for (const leg of legs) {
    const key = [
      leg.source,
      leg.chain,
      String(leg.inputToken || "").toLowerCase(),
      String(leg.outputToken || "").toLowerCase(),
      leg.amount,
      leg.targetTokenAmount || "",
    ].join(":");
    if (!byKey.has(key)) byKey.set(key, leg);
  }
  return [...byKey.values()];
}

function printableAsset(chain, token, fallback = null) {
  const asset = tokenAsset(chain, token);
  return `${chain}:${fallback || asset.ticker}`;
}

function observedAtMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isPositiveAmount(value) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function isPriorityFamilyLeg(leg) {
  const asset = tokenAsset(leg.chain, leg.outputToken || leg.inputToken);
  return asset.family === "wrapped_btc" || isEthLikeAsset(asset) || isGoldAsset(asset) || isStableAsset(asset);
}

function dexSupportForLeg(leg) {
  return canQuoteWithDex(leg.chain, leg.inputToken, {
    token: leg.outputToken || STABLE_QUOTE_TOKENS[leg.chain]?.token,
    ticker: tokenAsset(leg.chain, leg.outputToken || STABLE_QUOTE_TOKENS[leg.chain]?.token).ticker,
    decimals: tokenAsset(leg.chain, leg.outputToken || STABLE_QUOTE_TOKENS[leg.chain]?.token).decimals,
  });
}

function appendLeg(selection, seen, leg, routeLimit) {
  if (!leg || selection.length >= routeLimit) return;
  const key = [
    leg.source,
    leg.chain,
    String(leg.inputToken || "").toLowerCase(),
    String(leg.outputToken || "").toLowerCase(),
    leg.amount,
    leg.targetTokenAmount || "",
  ].join(":");
  if (seen.has(key)) return;
  seen.add(key);
  selection.push(leg);
}

function prioritizeLegsForCoverage(legs, { routeLimit }) {
  const ordered = [...legs].sort(
    (left, right) => observedAtMs(right.gatewayObservedAt) - observedAtMs(left.gatewayObservedAt),
  );
  const selection = [];
  const seen = new Set();
  const coveredChains = new Set();

  for (const leg of ordered) {
    if (!isPriorityFamilyLeg(leg) || !dexSupportForLeg(leg).ok || coveredChains.has(leg.chain)) continue;
    appendLeg(selection, seen, leg, routeLimit);
    coveredChains.add(leg.chain);
  }

  for (const leg of ordered) {
    if (!dexSupportForLeg(leg).ok || coveredChains.has(leg.chain)) continue;
    appendLeg(selection, seen, leg, routeLimit);
    coveredChains.add(leg.chain);
  }

  for (const leg of ordered) {
    appendLeg(selection, seen, leg, routeLimit);
  }

  return selection;
}

export function selectCandidateLegs(
  quotes,
  {
    routeKey = null,
    amount = null,
    chains = [],
    routeLimit = 24,
    includeStableEntry = false,
    scoreSnapshot = null,
    stableEntryBufferBps = DEFAULT_STABLE_ENTRY_BUFFER_BPS,
    prices = null,
  } = {},
) {
  const selectedChains = new Set((chains || []).map((item) => String(item).toLowerCase()));
  const scoresByKey = scoreMap(scoreSnapshot);
  const directMatches = [...quotes]
    .filter((quote) => !routeKey || quote.routeKey === routeKey)
    .filter((quote) => !amount || String(quote.amount) === String(amount))
    .sort((left, right) => observedAtMs(right.observedAt) - observedAtMs(left.observedAt));
  const directSelection = routeKey && amount ? directMatches.slice(0, 1) : directMatches;

  if (directSelection.length > 0 && (routeKey || amount)) {
    return dedupeLegs([
      ...directSelection.flatMap(candidateLegsFromGatewayQuote),
      ...(includeStableEntry
        ? directSelection
            .map((quote) => stableEntryLegFromGatewayQuote(quote, { scoresByKey, stableEntryBufferBps, prices }))
            .filter(Boolean)
        : []),
    ])
      .filter((leg) => selectedChains.size === 0 || selectedChains.has(String(leg.chain || "").toLowerCase()))
      .sort((left, right) => observedAtMs(right.gatewayObservedAt) - observedAtMs(left.gatewayObservedAt))
      .slice(0, routeLimit);
  }

  const allLegs = [
    ...quotes.flatMap(candidateLegsFromGatewayQuote),
    ...(includeStableEntry
      ? quotes
          .map((quote) => stableEntryLegFromGatewayQuote(quote, { scoresByKey, stableEntryBufferBps, prices }))
          .filter(Boolean)
      : []),
  ];
  const deduped = dedupeLegs(allLegs)
    .filter((leg) => !routeKey || leg.gatewayRouteKey === routeKey)
    .filter((leg) => !amount || String(leg.gatewayAmount) === String(amount))
    .filter((leg) => selectedChains.size === 0 || selectedChains.has(String(leg.chain || "").toLowerCase()))
    .sort((left, right) => observedAtMs(right.gatewayObservedAt) - observedAtMs(left.gatewayObservedAt));
  return prioritizeLegsForCoverage(deduped, { routeLimit });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new OdosClient();
  const store = new JsonlStore(config.dataDir);
  const quotes = latestByRouteAndAmount(await readJsonl(config.dataDir, "gateway-quotes"));
  const scoreSnapshot = args.includeStableEntry
    ? await readJsonIfExists(resolve(config.dataDir, "gateway-scores.json"))
    : null;
  const priceSnapshots = args.includeStableEntry ? await readJsonl(config.dataDir, "market-price-snapshots") : [];
  const prices = latestPriceSnapshot(priceSnapshots) ? pricesFromSnapshot(latestPriceSnapshot(priceSnapshots)) : null;
  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;
  const selectedLegs = selectCandidateLegs(quotes, {
    ...args,
    scoreSnapshot,
    prices,
  });
  const records = [];

  for (const leg of selectedLegs) {
    const inputAsset = tokenAsset(leg.chain, leg.inputToken);
    const outputAsset = tokenAsset(leg.chain, leg.outputToken || STABLE_QUOTE_TOKENS[leg.chain]?.token);
    const support = canQuoteWithDex(leg.chain, leg.inputToken, {
      token: leg.outputToken || STABLE_QUOTE_TOKENS[leg.chain]?.token,
      ticker: outputAsset.ticker,
      decimals: outputAsset.decimals,
    });
    const routing =
      support.provider === "odos"
        ? odosRoutingConfig(leg.chain, { allowUnsafe: args.allowUnsafeSources })
        : {
            sourceWhitelist: null,
            sourceBlacklist: null,
            routingMode: null,
            executionTrust: null,
          };
    if (!support.ok) {
      const failureReason = normalizeDexSupportReason(support.reason, leg.chain);
      const failure = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        observedAt: new Date().toISOString(),
        provider: support.provider || "router_selection",
        source: leg.source,
        quoteType: leg.quoteType,
        chain: leg.chain,
        token: leg.inputToken,
        amount: leg.amount,
        gatewayRouteKey: leg.gatewayRouteKey,
        gatewayAmount: leg.gatewayAmount,
        targetTokenAmount: leg.targetTokenAmount || null,
        sourceWhitelist: routing.sourceWhitelist,
        sourceBlacklist: routing.sourceBlacklist,
        routingMode: routing.routingMode,
        executionTrust: routing.executionTrust,
        ok: false,
        reason: failureReason,
      };
      records.push(failure);
      await store.append("dex-quote-failures", failure);
      if (!args.json) {
        console.log(
          `dex skipped ${printableAsset(leg.chain, leg.inputToken, inputAsset.ticker)}->${printableAsset(leg.chain, leg.outputToken, outputAsset.ticker)} amount=${leg.amount} reason=${failureReason}`,
        );
      }
      continue;
    }

    try {
      if (support.provider !== "odos") {
        throw new Error(`Unsupported DEX quote provider selected: ${support.provider}`);
      }
      const result = await client.quote({
        chain: leg.chain,
        inputToken: support.inputToken,
        outputToken: support.outputToken.token,
        amount: leg.amount,
        userAddr: config.verifyRecipient,
        slippageLimitPercent: Number(config.slippageBps) / 100,
        sourceWhitelist: routing.sourceWhitelist,
        sourceBlacklist: routing.sourceBlacklist,
      });
      const record = {
        ...normalizeOdosQuote({
          chain: leg.chain,
          source: leg.source,
          amount: leg.amount,
          inputToken: support.inputToken,
          outputToken: support.outputToken.token,
          inputTicker: inputAsset.ticker,
          inputDecimals: inputAsset.decimals,
          outputTicker: support.outputToken.ticker,
          outputDecimals: support.outputToken.decimals,
          quoteType: leg.quoteType,
          result,
          sourceWhitelist: routing.sourceWhitelist,
          sourceBlacklist: routing.sourceBlacklist,
        }),
        runId,
        gatewayRouteKey: leg.gatewayRouteKey,
        gatewayObservedAt: leg.gatewayObservedAt,
        gatewayAmount: leg.gatewayAmount,
        targetTokenAmount: leg.targetTokenAmount || null,
      };
      records.push({ ok: true, record });
      await store.append("dex-quotes", record);
      if (!args.json) {
        console.log(
          [
            `dex ${printableAsset(leg.chain, support.inputToken, inputAsset.ticker)}->${printableAsset(leg.chain, support.outputToken.token, support.outputToken.ticker)}`,
            `amount=${leg.amount}`,
            `out=${record.outputAmount}`,
            `inUsd=${record.inputValueUsd ?? "n/a"}`,
            `outUsd=${record.outputValueUsd ?? "n/a"}`,
            `gasUsd=${record.gasEstimateValueUsd ?? "n/a"}`,
            `target=${record.targetTokenAmount ?? "n/a"}`,
            `impact=${record.priceImpactPct ?? "n/a"}`,
            `trust=${record.executionTrust}`,
            `latency=${record.latencyMs}ms`,
          ].join(" "),
        );
      }
    } catch (error) {
      const failure = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        observedAt: new Date().toISOString(),
        provider: "odos",
        source: leg.source,
        quoteType: leg.quoteType,
        chain: leg.chain,
        token: leg.inputToken,
        amount: leg.amount,
        gatewayRouteKey: leg.gatewayRouteKey,
        gatewayAmount: leg.gatewayAmount,
        targetTokenAmount: leg.targetTokenAmount || null,
        sourceWhitelist: routing.sourceWhitelist,
        sourceBlacklist: routing.sourceBlacklist,
        routingMode: routing.routingMode,
        executionTrust: routing.executionTrust,
        ok: false,
        reason: "odos_quote_failed",
        error: {
          name: error.name,
          message: error.message,
          details: error.details || null,
        },
      };
      records.push(failure);
      await store.append("dex-quote-failures", failure);
      if (!args.json) {
        console.log(
          `dex failed ${printableAsset(leg.chain, leg.inputToken, inputAsset.ticker)}->${printableAsset(leg.chain, leg.outputToken, outputAsset.ticker)} amount=${leg.amount}: ${error.message}`,
        );
      }
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, runId, checkedLegs: selectedLegs, records }, null, 2));
  }
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
