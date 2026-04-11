#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { GatewayClient, routeKey, summarizeRoutes } from "../gateway/client.mjs";

const BTC_FAMILY = new Set(
  [
    "0x0000000000000000000000000000000000000000",
    "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    "0x236f8c0a61dA474dB21B693fB2ea7AAB0c803894",
  ].map((token) => token.toLowerCase()),
);

function isBtcFamilyRoute(route) {
  return BTC_FAMILY.has(route.srcToken.toLowerCase()) && BTC_FAMILY.has(route.dstToken.toLowerCase());
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function tokenSymbol(token) {
  const normalized = token.toLowerCase();
  if (normalized === "0x0000000000000000000000000000000000000000") return "native";
  if (normalized === "0x0555e30da8f98308edb960aa94c0db47230d2b9c") return "Gateway BTC";
  if (normalized === "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599") return "Ethereum WBTC";
  if (normalized === "0x236f8c0a61da474db21b693fb2ea7aab0c803894") return "uniBTC-like";
  return token;
}

async function main() {
  const client = new GatewayClient({ baseUrl: config.gatewayApiBase });
  const result = await client.getRoutes();
  const routes = result.body;
  const summary = summarizeRoutes(routes);
  const chains = [...new Set(routes.flatMap((route) => [route.srcChain, route.dstChain]))].sort();
  const btcRoutes = routes.filter(isBtcFamilyRoute);
  const bobRoutes = routes.filter((route) => route.srcChain === "bob" || route.dstChain === "bob");

  console.log(`routes=${routes.length}`);
  console.log(`chains=${chains.length} ${chains.join(", ")}`);
  console.log(`btcFamilyRoutes=${btcRoutes.length}`);
  console.log(`bobTouchingRoutes=${bobRoutes.length}`);

  console.log("");
  console.log("Chain pair counts:");
  for (const item of summary.chainPairs) {
    console.log(`  ${item.pair}: ${item.count}`);
  }

  console.log("");
  console.log("Token counts:");
  for (const [token, count] of countBy(routes.flatMap((route) => [route.srcToken, route.dstToken]), (token) => token)) {
    console.log(`  ${tokenSymbol(token)} ${token}: ${count}`);
  }

  console.log("");
  console.log("BOB-touching BTC-family routes:");
  for (const route of bobRoutes.filter(isBtcFamilyRoute).sort((a, b) => routeKey(a).localeCompare(routeKey(b)))) {
    console.log(`  ${route.srcChain}:${tokenSymbol(route.srcToken)} -> ${route.dstChain}:${tokenSymbol(route.dstToken)}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

