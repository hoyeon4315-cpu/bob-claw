#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import {
  assetPairKey,
  ETHEREUM_WBTC_TOKEN,
  isBtcFamilyRoute,
  UNI_BTC_TOKEN,
  WBTC_OFT_TOKEN,
  ZERO_TOKEN,
} from "../assets/tokens.mjs";
import { hydrateOfframpExecutionFromGatewayBody } from "../gateway/executable-quote.mjs";
import { GatewayClient, routeKey, summarizeRoutes } from "../gateway/client.mjs";
import { buildGatewayQuoteParams } from "../gateway/quote-params.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";

const SCHEMA_VERSION = 4;
const DEFAULT_BTC_TOKEN = WBTC_OFT_TOKEN;
const LOW_COST_CHAIN_ORDER = [
  "base",
  "bob",
  "bsc",
  "sonic",
  "unichain",
  "soneium",
  "avalanche",
  "bera",
  "ethereum",
  "bitcoin",
];

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
    once: flags.has("--once"),
    json: flags.has("--json"),
    allRoutes: flags.has("--all-routes"),
    btcRoutes: flags.has("--btc-routes"),
    bobNeighbors: flags.has("--bob-neighbors"),
    assetCoverage: flags.has("--asset-coverage"),
    retryMinimum: flags.has("--retry-minimum"),
    onePerChainPair: flags.has("--one-per-chain-pair"),
    onePerAssetPair: flags.has("--one-per-asset-pair"),
    routeLimit: options["route-limit"] ? Number(options["route-limit"]) : null,
    srcChain: options["src-chain"] || null,
    dstChain: options["dst-chain"] || null,
    chain: options.chain || null,
    routeKey: options["route-key"] || null,
    amounts: options.amounts
      ? options.amounts
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : null,
    timeBudgetMs: options["time-budget-ms"] ? Number(options["time-budget-ms"]) : null,
  };
}

export function shouldAbortForBudget({ elapsedMs, budgetMs }) {
  if (budgetMs === null || budgetMs === undefined) return false;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return false;
  return elapsedMs >= budgetMs;
}

export function buildBudgetExceededDiagnostic({
  schemaVersion,
  runId,
  startedAt,
  elapsedMs,
  budgetMs,
  routeSummary,
  checkedRoutes,
  completedRouteCount,
  records,
}) {
  return {
    schemaVersion,
    runId,
    observedAt: new Date().toISOString(),
    startedAt,
    elapsedMs,
    status: "diagnostic_failure",
    failureReason: "time_budget_exceeded_before_completion",
    budgetMs,
    routeSummary,
    checkedRoutes,
    plannedRouteCount: checkedRoutes.length,
    completedRouteCount,
    records,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickInitialRoutes(routes) {
  const preferred = [
    { srcChain: "bitcoin", dstChain: "bob", srcToken: ZERO_TOKEN, dstToken: DEFAULT_BTC_TOKEN },
    { srcChain: "bob", dstChain: "base", srcToken: DEFAULT_BTC_TOKEN, dstToken: DEFAULT_BTC_TOKEN },
    { srcChain: "base", dstChain: "bob", srcToken: DEFAULT_BTC_TOKEN, dstToken: DEFAULT_BTC_TOKEN },
  ];

  return preferred
    .map((target) =>
      routes.find(
        (route) =>
          route.srcChain === target.srcChain &&
          route.dstChain === target.dstChain &&
          route.srcToken.toLowerCase() === target.srcToken.toLowerCase() &&
          route.dstToken.toLowerCase() === target.dstToken.toLowerCase(),
      ),
    )
    .filter(Boolean);
}

function includesChain(route, chain) {
  return route.srcChain === chain || route.dstChain === chain;
}

function isBobNeighborRoute(route) {
  return isBtcFamilyRoute(route) && includesChain(route, "bob");
}

function chainPriority(chain) {
  const index = LOW_COST_CHAIN_ORDER.indexOf(chain);
  return index === -1 ? LOW_COST_CHAIN_ORDER.length : index;
}

function preferCanonicalBtcRoute(route) {
  const src = route.srcToken.toLowerCase();
  const dst = route.dstToken.toLowerCase();
  if (src === DEFAULT_BTC_TOKEN.toLowerCase() || dst === DEFAULT_BTC_TOKEN.toLowerCase()) return 0;
  if (src === ETHEREUM_WBTC_TOKEN.toLowerCase() || dst === ETHEREUM_WBTC_TOKEN.toLowerCase()) return 1;
  if (src === UNI_BTC_TOKEN.toLowerCase() || dst === UNI_BTC_TOKEN.toLowerCase()) return 2;
  return 3;
}

function preferCoverageRoute(route) {
  const srcPriority = chainPriority(route.srcChain);
  const dstPriority = chainPriority(route.dstChain);
  const touchesBitcoin = route.srcChain === "bitcoin" || route.dstChain === "bitcoin" ? 1 : 0;
  const touchesEthereum = route.srcChain === "ethereum" || route.dstChain === "ethereum" ? 1 : 0;
  return srcPriority + dstPriority + touchesBitcoin * 2 + touchesEthereum * 3;
}

function dedupeOnePerChainPair(routes) {
  const byPair = new Map();
  for (const route of routes) {
    const key = `${route.srcChain}->${route.dstChain}`;
    const existing = byPair.get(key);
    if (!existing || preferCanonicalBtcRoute(route) < preferCanonicalBtcRoute(existing)) {
      byPair.set(key, route);
    }
  }
  return [...byPair.values()];
}

function dedupeOnePerAssetPair(routes) {
  const byAssetPair = new Map();
  for (const route of routes) {
    const key = assetPairKey(route);
    const existing = byAssetPair.get(key);
    if (!existing || preferCoverageRoute(route) < preferCoverageRoute(existing)) {
      byAssetPair.set(key, route);
    }
  }
  return [...byAssetPair.values()].sort(
    (left, right) =>
      assetPairKey(left).localeCompare(assetPairKey(right)) || preferCoverageRoute(left) - preferCoverageRoute(right),
  );
}

function selectRoutes(routes, args) {
  let selected;
  const hasRouteFilter = args.routeKey || args.srcChain || args.dstChain || args.chain;
  if (args.allRoutes || hasRouteFilter) {
    selected = routes;
  } else if (args.assetCoverage) {
    selected = dedupeOnePerAssetPair(routes);
  } else if (args.btcRoutes) {
    selected = routes.filter(isBtcFamilyRoute);
  } else if (args.bobNeighbors) {
    selected = routes.filter(isBobNeighborRoute);
  } else {
    selected = pickInitialRoutes(routes);
  }

  if (args.srcChain) {
    selected = selected.filter((route) => route.srcChain === args.srcChain);
  }
  if (args.dstChain) {
    selected = selected.filter((route) => route.dstChain === args.dstChain);
  }
  if (args.chain) {
    selected = selected.filter((route) => includesChain(route, args.chain));
  }
  if (args.routeKey) {
    selected = selected.filter((route) => routeKey(route) === args.routeKey);
  }
  if (args.onePerChainPair) {
    selected = dedupeOnePerChainPair(selected);
  }
  if (args.onePerAssetPair) {
    selected = dedupeOnePerAssetPair(selected);
  }
  if (Number.isFinite(args.routeLimit) && args.routeLimit > 0) {
    selected = selected.slice(0, args.routeLimit);
  }

  return selected;
}

function minimumQuoteAmount(error) {
  const body = error.details?.body;
  if (body?.code !== "QUOTE_AMOUNT_TOO_LOW") return null;
  return body.details?.minimum || null;
}

function quoteParamsFor(route, amount) {
  return buildGatewayQuoteParams({
    route,
    amount,
    sender: config.verifyRecipient,
    recipient: route.dstChain === "bitcoin" ? config.verifyBtcRecipient : config.verifyRecipient,
  });
}

function extractQuoteMetrics(route, amount, quoteResult, executable = {}) {
  const quoteType =
    executable.quoteType ||
    (quoteResult.body.onramp
      ? "onramp"
      : quoteResult.body.offramp
        ? "offramp"
        : quoteResult.body.layerZero
          ? "layerZero"
          : "unknown");
  const quote = quoteResult.body.onramp || quoteResult.body.offramp || quoteResult.body.layerZero || quoteResult.body;
  const inputAmount = BigInt(quote.inputAmount?.amount || amount);
  const outputAmount = BigInt(quote.outputAmount?.amount || 0);
  const fees = BigInt(quote.fees?.amount || 0);
  const executionFees = BigInt(quote.executionFees?.amount || 0);
  const txValue = BigInt(quote.tx?.value || 0);
  const estimatedTimeInSecs = quote.estimatedTimeInSecs ?? null;
  const grossOutputRatio = Number(outputAmount) / Number(inputAmount);
  const feeRatio = Number(fees) / Number(inputAmount);

  return {
    schemaVersion: SCHEMA_VERSION,
    observedAt: new Date().toISOString(),
    route,
    routeKey: routeKey(route),
    quoteType,
    amount,
    latencyMs: quoteResult.latencyMs,
    inputAmount: inputAmount.toString(),
    outputAmount: outputAmount.toString(),
    fees: fees.toString(),
    executionFees: executionFees.toString(),
    txValueWei: executable.txValueWei || txValue.toString(),
    txTo: executable.txTo ?? quote.tx?.to ?? null,
    txData: executable.txData ?? quote.tx?.data ?? null,
    txChain: executable.txChain ?? quote.tx?.chain ?? null,
    txDataBytes: executable.txDataBytes ?? (quote.tx?.data ? Math.max(0, (quote.tx.data.length - 2) / 2) : null),
    feeBreakdown: quote.feeBreakdown || null,
    estimatedTimeInSecs,
    slippageBps: config.slippageBps,
    grossOutputRatio,
    feeRatio,
    hasSignedQuoteData: Boolean(quote.signedQuoteData),
    executionHydratedFromOrder: executable.executionHydratedFromOrder || false,
    executionOrderId: executable.executionOrderId || null,
    rawShape: {
      hasOnramp: Boolean(quoteResult.body.onramp),
      hasOfframp: Boolean(quoteResult.body.offramp),
      hasLayerZero: Boolean(quoteResult.body.layerZero),
      topLevelKeys: Object.keys(quoteResult.body).sort(),
    },
  };
}

function printRouteSummary(summary) {
  console.log(`Gateway routes: ${summary.totalRoutes}`);
  console.log("Top chain pairs:");
  for (const item of summary.chainPairs.slice(0, 12)) {
    console.log(`  ${item.pair}: ${item.count}`);
  }
}

function printQuoteMetric(metric) {
  const feePct = (metric.feeRatio * 100).toFixed(4);
  const outputPct = (metric.grossOutputRatio * 100).toFixed(4);
  console.log(
    [
      `quote ${metric.route.srcChain}->${metric.route.dstChain}`,
      `type=${metric.quoteType}`,
      `amount=${metric.amount}`,
      `output=${metric.outputAmount}`,
      `fees=${metric.fees}`,
      `txValueWei=${metric.txValueWei}`,
      `feePct=${feePct}%`,
      `outputPct=${outputPct}%`,
      `latency=${metric.latencyMs}ms`,
      `eta=${metric.estimatedTimeInSecs ?? "n/a"}s`,
      `signed=${metric.hasSignedQuoteData}`,
    ].join(" "),
  );
}

async function tryRetryQuote({ client, route, retryAmount, originalAmount, runId, store, records, json }) {
  try {
    const quoteResult = await client.getQuote(quoteParamsFor(route, retryAmount));
    const executable = await hydrateOfframpExecutionFromGatewayBody(quoteResult.body, { client });
    const metric = extractQuoteMetrics(route, retryAmount, quoteResult, executable);
    metric.runId = runId;
    metric.retryReason = "QUOTE_AMOUNT_TOO_LOW";
    metric.retryOfAmount = originalAmount;
    records.push({ ok: true, metric });
    await store.append("gateway-quotes", metric);
    if (!json) printQuoteMetric(metric);
    return { ok: true };
  } catch (retryError) {
    return { ok: false, error: retryError };
  }
}

async function recordQuoteFailure({ runId, route, amount, error, store, records, json }) {
  const failure = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    observedAt: new Date().toISOString(),
    route,
    routeKey: routeKey(route),
    amount,
    ok: false,
    error: {
      name: error.name,
      message: error.message,
      details: error.details || null,
    },
  };
  records.push(failure);
  await store.append("gateway-quote-failures", failure);
  if (!json) {
    console.log(`quote failed ${route.srcChain}->${route.dstChain} amount=${amount}: ${error.message}`);
  }
}

async function processQuoteAttempt({ client, route, amount, args, runId, store, records }) {
  try {
    const quoteResult = await client.getQuote(quoteParamsFor(route, amount));
    const executable = await hydrateOfframpExecutionFromGatewayBody(quoteResult.body, { client });
    const metric = extractQuoteMetrics(route, amount, quoteResult, executable);
    metric.runId = runId;
    records.push({ ok: true, metric });
    await store.append("gateway-quotes", metric);
    if (!args.json) printQuoteMetric(metric);
    return;
  } catch (error) {
    const retryAmount = args.retryMinimum ? minimumQuoteAmount(error) : null;
    if (retryAmount && retryAmount !== amount) {
      const retry = await tryRetryQuote({
        client,
        route,
        retryAmount,
        originalAmount: amount,
        runId,
        store,
        records,
        json: args.json,
      });
      if (retry.ok) return;
      await recordQuoteFailure({ runId, route, amount, error: retry.error, store, records, json: args.json });
      return;
    }
    await recordQuoteFailure({ runId, route, amount, error, store, records, json: args.json });
  }
}

async function processRouteAmounts({ client, route, args, runId, store, records }) {
  const configuredAmounts = args.amounts || config.sampleSats;
  const amounts = args.once ? configuredAmounts.slice(0, 1) : configuredAmounts;
  for (let index = 0; index < amounts.length; index += 1) {
    await processQuoteAttempt({ client, route, amount: amounts[index], args, runId, store, records });
    const hasMoreInRoute = index < amounts.length - 1;
    if (hasMoreInRoute && config.requestDelayMs > 0) {
      await sleep(config.requestDelayMs);
    }
  }
}

function buildVerifierResult({
  budgetExceeded,
  runId,
  startedAt,
  elapsedMs,
  budgetMs,
  summary,
  selectedRoutes,
  completedRouteCount,
  records,
}) {
  if (budgetExceeded) {
    return buildBudgetExceededDiagnostic({
      schemaVersion: SCHEMA_VERSION,
      runId,
      startedAt,
      elapsedMs,
      budgetMs,
      routeSummary: summary,
      checkedRoutes: selectedRoutes,
      completedRouteCount,
      records,
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    observedAt: new Date().toISOString(),
    startedAt,
    elapsedMs,
    status: "ok",
    routeSummary: summary,
    checkedRoutes: selectedRoutes,
    completedRouteCount,
    records,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new GatewayClient({ baseUrl: config.gatewayApiBase });
  const store = new JsonlStore(config.dataDir);
  const runId = `${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`;

  const routesResult = await client.getRoutes();
  const routes = routesResult.body;
  const summary = summarizeRoutes(routes);

  await store.append("gateway-routes", {
    schemaVersion: SCHEMA_VERSION,
    runId,
    observedAt: new Date().toISOString(),
    latencyMs: routesResult.latencyMs,
    summary,
    routes,
  });

  if (!args.json) {
    printRouteSummary(summary);
  }

  const selectedRoutes = selectRoutes(routes, args);
  if (selectedRoutes.length === 0) {
    throw new Error("No Gateway routes matched the selected filters. Review route selection before continuing.");
  }

  const records = [];
  const budgetMs = Number.isFinite(args.timeBudgetMs) && args.timeBudgetMs > 0 ? args.timeBudgetMs : null;
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  let completedRouteCount = 0;
  let budgetExceeded = false;
  for (const route of selectedRoutes) {
    if (shouldAbortForBudget({ elapsedMs: Date.now() - startedAtMs, budgetMs })) {
      budgetExceeded = true;
      break;
    }
    await processRouteAmounts({ client, route, args, runId, store, records });
    if (config.requestDelayMs > 0) {
      await sleep(config.requestDelayMs);
    }
    completedRouteCount += 1;
    if (shouldAbortForBudget({ elapsedMs: Date.now() - startedAtMs, budgetMs })) {
      budgetExceeded = true;
      break;
    }
  }

  const elapsedMs = Date.now() - startedAtMs;
  const result = buildVerifierResult({
    budgetExceeded,
    runId,
    startedAt,
    elapsedMs,
    budgetMs,
    summary,
    selectedRoutes,
    completedRouteCount,
    records,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (budgetExceeded) {
    console.log(
      `diagnostic_failure time_budget_exceeded_before_completion completed=${completedRouteCount}/${selectedRoutes.length} elapsedMs=${elapsedMs}`,
    );
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
