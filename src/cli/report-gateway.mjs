#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { GatewayError, classifyGatewayBlockedReason } from "../gateway/client.mjs";

const NATIVE_PRICE_IDS = {
  avalanche: "avalanche-2",
  base: "ethereum",
  bera: "berachain-bera",
  bob: "ethereum",
  bsc: "binancecoin",
  ethereum: "ethereum",
  soneium: "ethereum",
  sonic: "sonic-3",
  unichain: "ethereum",
};

async function readJsonl(name) {
  const path = join(config.dataDir, `${name}.jsonl`);
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(4)}%`;
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 4 : 6)}`;
}

async function getNativePricesUsd() {
  const ids = [...new Set(Object.values(NATIVE_PRICE_IDS))];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return {};
    const body = await response.json();
    return Object.fromEntries(
      Object.entries(NATIVE_PRICE_IDS).map(([chain, id]) => [chain, body[id]?.usd || null]),
    );
  } catch {
    return {};
  }
}

function nativeCostUsd(quote, nativePricesUsd) {
  const value = BigInt(quote.txValueWei || 0);
  if (value === 0n) return 0;
  const price = nativePricesUsd[quote.route.srcChain];
  if (!Number.isFinite(price)) return null;
  return (Number(value) / 1e18) * price;
}

function min(values) {
  return values.length > 0 ? Math.min(...values) : null;
}

function max(values) {
  return values.length > 0 ? Math.max(...values) : null;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function failureBlockedReason(failure) {
  const details = failure?.error?.details || null;
  if (!details) return null;
  const error = new GatewayError(failure?.error?.message || "Gateway request failed", details);
  return classifyGatewayBlockedReason(error);
}

function formatFailureReasonCounts(failures) {
  const counts = new Map();
  for (const failure of failures) {
    const reason = failureBlockedReason(failure) || "unknown";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${reason}:${count}`)
    .join(",") || "none";
}

async function main() {
  const quotes = await readJsonl("gateway-quotes");
  const failures = await readJsonl("gateway-quote-failures");
  const nativePricesUsd = await getNativePricesUsd();
  const validQuotes = quotes.filter(
    (quote) => quote.quoteType && Number.isFinite(quote.grossOutputRatio) && quote.grossOutputRatio > 0,
  );
  const malformedQuotes = quotes.length - validQuotes.length;
  const routeGroups = groupBy(validQuotes, (quote) => quote.routeKey);
  const failureGroups = groupBy(failures, (failure) => failure.routeKey);
  const latestSuccess = quotes.at(-1) || null;
  const latestFailure = failures.at(-1) || null;

  console.log(`quotes=${quotes.length} validQuotes=${validQuotes.length} malformedOrLegacy=${malformedQuotes} failures=${failures.length}`);
  console.log(`latestSuccessAt=${latestSuccess?.observedAt || "none"}`);
  console.log(`latestSuccessRoute=${latestSuccess?.routeKey || "none"}`);
  console.log(`latestFailureAt=${latestFailure?.observedAt || "none"}`);
  console.log(`latestFailureRoute=${latestFailure?.routeKey || "none"}`);
  console.log(`latestFailureReason=${failureBlockedReason(latestFailure) || "none"}`);
  console.log(`failureReasonCounts=${formatFailureReasonCounts(failures)}`);

  const sortedRouteGroups = [...routeGroups.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [routeKey, routeQuotes] of sortedRouteGroups) {
    const failureCount = failureGroups.get(routeKey)?.length || 0;
    const latencies = routeQuotes.map((quote) => quote.latencyMs).filter(Number.isFinite);
    const feeRatios = routeQuotes.map((quote) => quote.feeRatio).filter(Number.isFinite);
    const outputRatios = routeQuotes.map((quote) => quote.grossOutputRatio).filter(Number.isFinite);
    const etas = routeQuotes.map((quote) => quote.estimatedTimeInSecs).filter(Number.isFinite);
    const nativeValues = [
      ...new Set(routeQuotes.map((quote) => quote.txValueWei).filter((value) => value && value !== "0")),
    ];
    const nativeCostsUsd = routeQuotes
      .map((quote) => nativeCostUsd(quote, nativePricesUsd))
      .filter(Number.isFinite);

    console.log("");
    console.log(routeKey);
    console.log(`  samples=${routeQuotes.length} failures=${failureCount}`);
    console.log(`  quoteTypes=${[...new Set(routeQuotes.map((quote) => quote.quoteType))].join(",")}`);
    console.log(`  latencyMs p50=${percentile(latencies, 50) ?? "n/a"} p95=${percentile(latencies, 95) ?? "n/a"}`);
    console.log(`  etaSec p50=${percentile(etas, 50) ?? "n/a"} p95=${percentile(etas, 95) ?? "n/a"}`);
    console.log(`  feePct min=${formatPct(min(feeRatios))} max=${formatPct(max(feeRatios))}`);
    console.log(`  outputPct min=${formatPct(min(outputRatios))} max=${formatPct(max(outputRatios))}`);
    if (nativeValues.length > 0) {
      console.log(`  nativeTxValueWei=${nativeValues.join(",")}`);
      console.log(`  nativeCostUsd min=${formatUsd(min(nativeCostsUsd))} max=${formatUsd(max(nativeCostsUsd))}`);
    }
  }

  for (const [routeKey, routeFailures] of failureGroups.entries()) {
    if (routeGroups.has(routeKey)) continue;
    console.log("");
    console.log(routeKey);
    console.log(`  samples=0 failures=${routeFailures.length}`);
    console.log(`  latestError=${routeFailures.at(-1)?.error?.message || "unknown"}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
