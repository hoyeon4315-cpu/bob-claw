#!/usr/bin/env node

/**
 * check-gateway-onramp.mjs
 *
 * Checks the BOB Gateway BTC→Base USDC onramp quote, compares to market
 * BTC price, shows fee breakdown and ZeroConf status, logs to JSONL.
 *
 * Usage:  node src/cli/check-gateway-onramp.mjs [--sats=100000] [--json]
 */

import { config } from "../config/env.mjs";
import { GatewayClient, routeKey } from "../gateway/client.mjs";
import { getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";

// ── Constants ────────────────────────────────────────────────────────────────

const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TARGET_ROUTE = {
  srcChain: "bitcoin",
  dstChain: "base",
  srcToken: ZERO_TOKEN,
  dstToken: USDC_BASE,
};
const SATS_PER_BTC = 1e8;
const USDC_DECIMALS = 6;
const DEFAULT_SATS = 100_000; // 0.001 BTC

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = { sats: DEFAULT_SATS, json: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--sats=")) {
      args.sats = Number(arg.slice(7));
      if (!Number.isFinite(args.sats) || args.sats <= 0) {
        throw new Error(`Invalid --sats value: ${arg.slice(7)}`);
      }
    }
    if (arg === "--json") args.json = true;
  }
  return args;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function findBaseUsdcRoute(routes) {
  return routes.find(
    (r) =>
      r.srcChain === TARGET_ROUTE.srcChain &&
      r.dstChain === TARGET_ROUTE.dstChain &&
      r.dstToken?.toLowerCase() === TARGET_ROUTE.dstToken.toLowerCase(),
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const observedAt = new Date().toISOString();
  const client = new GatewayClient({ baseUrl: config.gatewayApiBase });
  const store = new JsonlStore(config.dataDir);

  // 1. Fetch market BTC price
  const prices = await getCoinGeckoPricesUsd();
  const btcMarketUsd = prices.btc;
  if (!Number.isFinite(btcMarketUsd)) {
    throw new Error("Could not fetch BTC market price");
  }

  // 2. Fetch Gateway routes and find BTC→Base USDC
  const routesResult = await client.getRoutes();
  const routes = routesResult.body || [];
  const route = findBaseUsdcRoute(routes);
  if (!route) {
    const available = routes
      .filter((r) => r.srcChain === "bitcoin")
      .map((r) => `${r.srcChain}:${r.srcToken}->${r.dstChain}:${r.dstToken}`)
      .slice(0, 10)
      .join("\n  ");
    throw new Error(
      `BTC→Base USDC route not found in ${routes.length} routes.\nBitcoin source routes:\n  ${available || "none"}`,
    );
  }

  // 3. Get quote
  const quoteParams = {
    srcChain: route.srcChain,
    dstChain: route.dstChain,
    srcToken: route.srcToken,
    dstToken: route.dstToken,
    amount: String(args.sats),
    recipient: config.verifyRecipient,
    slippage: config.slippageBps,
  };
  const quoteResult = await client.getQuote(quoteParams);
  const quoteType = quoteResult.body.onramp
    ? "onramp"
    : quoteResult.body.layerZero
      ? "layerZero"
      : "unknown";
  const payload =
    quoteResult.body.onramp || quoteResult.body.layerZero || quoteResult.body;

  // 4. Extract amounts
  const inputSats = Number(payload.inputAmount?.amount || args.sats);
  const outputRaw = Number(payload.outputAmount?.amount || 0);
  const feesRaw = Number(payload.fees?.amount || 0);
  const execFeesRaw = Number(payload.executionFees?.amount || 0);
  const estimatedTimeSecs = payload.estimatedTimeInSecs ?? null;

  const inputBtc = inputSats / SATS_PER_BTC;
  const outputUsdc = outputRaw / 10 ** USDC_DECIMALS;
  const feesUsdc = feesRaw / 10 ** USDC_DECIMALS;
  const execFeesUsdc = execFeesRaw / 10 ** USDC_DECIMALS;

  // 5. Calculate rates and costs
  const marketValueUsd = inputBtc * btcMarketUsd;
  const effectiveRateUsd = inputBtc > 0 ? outputUsdc / inputBtc : 0;
  const slippageUsd = marketValueUsd - outputUsdc;
  const slippagePct = marketValueUsd > 0 ? (slippageUsd / marketValueUsd) * 100 : 0;
  const totalFeePct = marketValueUsd > 0 ? ((feesUsdc + execFeesUsdc) / marketValueUsd) * 100 : 0;

  // 6. ZeroConf status (not yet live on Gateway API — flag for awareness)
  const zeroConfAvailable = Boolean(payload.zeroConf || payload.zeroConfEnabled);
  const zeroConfNote = zeroConfAvailable
    ? "ZeroConf ACTIVE — instant confirmation, reduced fees"
    : "ZeroConf not active — standard BTC confirmation required";

  // 7. Build result record
  const record = {
    schemaVersion: 1,
    observedAt,
    routeKey: routeKey(route),
    quoteType,
    inputSats,
    inputBtc: round(inputBtc, 8),
    outputUsdc: round(outputUsdc, 6),
    btcMarketUsd: round(btcMarketUsd, 2),
    marketValueUsd: round(marketValueUsd, 2),
    effectiveRateUsd: round(effectiveRateUsd, 2),
    slippageUsd: round(slippageUsd, 2),
    slippagePct: round(slippagePct, 4),
    protocolFeesUsdc: round(feesUsdc, 6),
    executionFeesUsdc: round(execFeesUsdc, 6),
    totalFeePct: round(totalFeePct, 4),
    estimatedTimeSecs,
    zeroConfAvailable,
    latencyMs: quoteResult.latencyMs,
    pnlType: "estimated",
  };

  // 8. Log to JSONL
  const logPath = await store.append("gateway-onramp-checks", record);

  // 9. Print results
  if (args.json) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  console.log("═══ BOB Gateway BTC → Base USDC Onramp Check ═══");
  console.log();
  console.log(`  Route:            ${record.routeKey}`);
  console.log(`  Quote type:       ${quoteType}`);
  console.log(`  Input:            ${record.inputBtc} BTC (${inputSats} sats)`);
  console.log(`  Output:           ${record.outputUsdc} USDC`);
  console.log();
  console.log("── Market comparison ──");
  console.log(`  BTC market price: $${record.btcMarketUsd.toLocaleString()}`);
  console.log(`  Market value:     $${record.marketValueUsd}`);
  console.log(`  Effective rate:   $${record.effectiveRateUsd.toLocaleString()} / BTC`);
  console.log(`  Total cost:       $${record.slippageUsd} (${record.slippagePct}%)`);
  console.log();
  console.log("── Fee breakdown ──");
  console.log(`  Protocol fees:    $${record.protocolFeesUsdc}`);
  console.log(`  Execution fees:   $${record.executionFeesUsdc}`);
  console.log(`  Total fee %:      ${record.totalFeePct}%`);
  console.log();
  console.log("── Timing & status ──");
  console.log(`  Est. time:        ${estimatedTimeSecs != null ? `${estimatedTimeSecs}s` : "n/a"}`);
  console.log(`  API latency:      ${record.latencyMs}ms`);
  console.log(`  ZeroConf:         ${zeroConfNote}`);
  console.log();
  console.log(`  PnL type:         estimated (not realized)`);
  console.log(`  Logged to:        ${logPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
