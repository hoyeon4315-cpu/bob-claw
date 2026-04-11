#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { canQuoteWithOdos, normalizeOdosQuote, OdosClient, STABLE_QUOTE_TOKENS } from "../dex/odos.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { tokenAsset } from "../assets/tokens.mjs";

const SCHEMA_VERSION = 1;

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
    routeLimit: options["route-limit"] ? Number(options["route-limit"]) : 24,
    amountLimitUsd: options["amount-limit-usd"] ? Number(options["amount-limit-usd"]) : null,
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
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
      chain: quote.route.srcChain,
      token: quote.route.srcToken,
      amount: quote.inputAmount,
      gatewayRouteKey: quote.routeKey,
      gatewayObservedAt: quote.observedAt,
      gatewayAmount: quote.amount,
    },
    {
      source: "gateway_dst_leg",
      chain: quote.route.dstChain,
      token: quote.route.dstToken,
      amount: quote.outputAmount,
      gatewayRouteKey: quote.routeKey,
      gatewayObservedAt: quote.observedAt,
      gatewayAmount: quote.amount,
    },
  ];
}

function dedupeLegs(legs) {
  const byKey = new Map();
  for (const leg of legs) {
    const key = `${leg.chain}:${leg.token.toLowerCase()}:${leg.amount}`;
    if (!byKey.has(key)) byKey.set(key, leg);
  }
  return [...byKey.values()];
}

function printableAsset(chain, token) {
  const asset = tokenAsset(chain, token);
  return `${chain}:${asset.ticker}`;
}

export function selectCandidateLegs(quotes, { routeKey = null, amount = null, chains = [], routeLimit = 24 } = {}) {
  const selectedChains = new Set((chains || []).map((item) => String(item).toLowerCase()));
  return dedupeLegs(quotes.flatMap(candidateLegsFromGatewayQuote))
    .filter((leg) => !routeKey || leg.gatewayRouteKey === routeKey)
    .filter((leg) => !amount || String(leg.gatewayAmount) === String(amount))
    .filter((leg) => selectedChains.size === 0 || selectedChains.has(String(leg.chain || "").toLowerCase()))
    .slice(0, routeLimit);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new OdosClient();
  const store = new JsonlStore(config.dataDir);
  const quotes = latestByRouteAndAmount(await readJsonl(config.dataDir, "gateway-quotes"));
  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;
  const selectedLegs = selectCandidateLegs(quotes, args);
  const records = [];

  for (const leg of selectedLegs) {
    const support = canQuoteWithOdos(leg.chain, leg.token);
    if (!support.ok) {
      const failure = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        observedAt: new Date().toISOString(),
        provider: "odos",
        source: leg.source,
        chain: leg.chain,
        token: leg.token,
        amount: leg.amount,
        gatewayRouteKey: leg.gatewayRouteKey,
        ok: false,
        reason: support.reason,
      };
      records.push(failure);
      await store.append("dex-quote-failures", failure);
      if (!args.json) console.log(`dex skipped ${printableAsset(leg.chain, leg.token)} amount=${leg.amount} reason=${support.reason}`);
      continue;
    }

    try {
      const result = await client.quote({
        chain: leg.chain,
        inputToken: support.inputToken,
        outputToken: support.outputToken.token,
        amount: leg.amount,
        userAddr: config.verifyRecipient,
        slippageLimitPercent: Number(config.slippageBps) / 100,
      });
      const record = {
        ...normalizeOdosQuote({
          chain: leg.chain,
          source: leg.source,
          amount: leg.amount,
          inputToken: support.inputToken,
          outputToken: support.outputToken.token,
          outputTicker: support.outputToken.ticker,
          outputDecimals: support.outputToken.decimals,
          result,
        }),
        runId,
        gatewayRouteKey: leg.gatewayRouteKey,
        gatewayObservedAt: leg.gatewayObservedAt,
        gatewayAmount: leg.gatewayAmount,
      };
      records.push({ ok: true, record });
      await store.append("dex-quotes", record);
      if (!args.json) {
        console.log(
          [
            `dex ${printableAsset(leg.chain, leg.token)}->${STABLE_QUOTE_TOKENS[leg.chain].ticker}`,
            `amount=${leg.amount}`,
            `out=${record.outputAmount}`,
            `inUsd=${record.inputValueUsd ?? "n/a"}`,
            `outUsd=${record.outputValueUsd ?? "n/a"}`,
            `gasUsd=${record.gasEstimateValueUsd ?? "n/a"}`,
            `impact=${record.priceImpactPct ?? "n/a"}`,
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
        chain: leg.chain,
        token: leg.token,
        amount: leg.amount,
        gatewayRouteKey: leg.gatewayRouteKey,
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
      if (!args.json) console.log(`dex failed ${printableAsset(leg.chain, leg.token)} amount=${leg.amount}: ${error.message}`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, runId, checkedLegs: selectedLegs, records }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
