#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { classifyGatewayAssetUniverse, isBtcFamilyRoute, tokenAsset } from "../assets/tokens.mjs";
import { GatewayClient, routeKey, summarizeRoutes } from "../gateway/client.mjs";

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function tokenSymbol(chain, token) {
  if (String(token).toLowerCase() === "0x0000000000000000000000000000000000000000") return "native";
  const asset = tokenAsset(chain, token);
  return asset?.ticker && asset.ticker !== "Token" ? asset.ticker : token;
}

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
  };
}

function sourceLabel(item) {
  return item?.source?.label ? ` source=${item.source.label}` : "";
}

export function buildGatewayInventorySummary(routes = []) {
  const summary = summarizeRoutes(routes);
  const chains = [...new Set(routes.flatMap((route) => [route.srcChain, route.dstChain]))].sort();
  const btcRoutes = routes.filter(isBtcFamilyRoute);
  const bobRoutes = routes.filter((route) => route.srcChain === "bob" || route.dstChain === "bob");
  const assetUniverse = classifyGatewayAssetUniverse(routes);
  const tokenCounts = countBy(
    routes.flatMap((route) => [
      { chain: route.srcChain, token: route.srcToken },
      { chain: route.dstChain, token: route.dstToken },
    ]),
    (item) => `${item.chain}:${item.token}`,
  ).map(([key, count]) => {
    const separator = key.indexOf(":");
    const chain = separator >= 0 ? key.slice(0, separator) : null;
    const token = separator >= 0 ? key.slice(separator + 1) : key;
    return {
      chain,
      token,
      ticker: tokenSymbol(chain, token),
      count,
    };
  });
  const bobTouchingBtcRoutes = bobRoutes
    .filter(isBtcFamilyRoute)
    .sort((a, b) => routeKey(a).localeCompare(routeKey(b)))
    .map((route) => ({
      routeKey: routeKey(route),
      srcChain: route.srcChain,
      srcTicker: tokenSymbol(route.srcChain, route.srcToken),
      dstChain: route.dstChain,
      dstTicker: tokenSymbol(route.dstChain, route.dstToken),
    }));

  return {
    routes: routes.length,
    chains,
    btcFamilyRoutes: btcRoutes.length,
    bobTouchingRoutes: bobRoutes.length,
    chainPairs: summary.chainPairs,
    tokenCounts,
    observedBtcLikeAssets: assetUniverse.observedBtcLikeAssets,
    btcWatchlistObserved: assetUniverse.watchlistObserved,
    btcWatchlistMissing: assetUniverse.watchlistMissing,
    unknownAssets: assetUniverse.unknownAssets,
    bobTouchingBtcRoutes,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new GatewayClient({ baseUrl: config.gatewayApiBase });
  const result = await client.getRoutes();
  const routes = result.body;
  const inventory = buildGatewayInventorySummary(routes);

  if (args.json) {
    console.log(JSON.stringify(inventory, null, 2));
    return;
  }

  console.log(`routes=${inventory.routes}`);
  console.log(`chains=${inventory.chains.length} ${inventory.chains.join(", ")}`);
  console.log(`btcFamilyRoutes=${inventory.btcFamilyRoutes}`);
  console.log(`bobTouchingRoutes=${inventory.bobTouchingRoutes}`);

  console.log("");
  console.log("Chain pair counts:");
  for (const item of inventory.chainPairs) {
    console.log(`  ${item.pair}: ${item.count}`);
  }

  console.log("");
  console.log("Token counts:");
  for (const item of inventory.tokenCounts) {
    console.log(`  ${item.chain}:${item.ticker} ${item.token}: ${item.count}`);
  }

  console.log("");
  console.log("Observed BTC-like assets:");
  for (const asset of inventory.observedBtcLikeAssets) {
    console.log(`  ${asset.chain}:${asset.ticker} ${asset.token}`);
  }

  console.log("");
  console.log("BTC watchlist missing from live routes:");
  if (inventory.btcWatchlistMissing.length === 0) {
    console.log("  none");
  } else {
    for (const item of inventory.btcWatchlistMissing) {
      console.log(`  ${item.chain || "*"}:${item.ticker} status=${item.status}${sourceLabel(item)}`);
    }
  }

  console.log("");
  console.log("Unknown token addresses requiring review:");
  if (inventory.unknownAssets.length === 0) {
    console.log("  none");
  } else {
    for (const asset of inventory.unknownAssets) {
      console.log(`  ${asset.chain}:${asset.token}`);
    }
  }

  console.log("");
  console.log("BOB-touching BTC-family routes:");
  for (const route of inventory.bobTouchingBtcRoutes) {
    console.log(`  ${route.srcChain}:${route.srcTicker} -> ${route.dstChain}:${route.dstTicker}`);
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
