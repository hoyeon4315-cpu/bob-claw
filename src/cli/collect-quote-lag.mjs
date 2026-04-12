#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { GatewayClient } from "../gateway/client.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;

// ── Probe routes — lowest-haircut from scan ─────────────────────────────────

const PROBE_ROUTES = [
  {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    label: "BTC→BOB wBTC.OFT",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 2.37,
  },
  {
    routeKey: "ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7->bitcoin:0x0000000000000000000000000000000000000000",
    label: "ETH USDT→BTC (buy)",
    family: "btc_swap",
    amount: "250000000",
    execCostUsd: 5.39,
  },
  {
    routeKey: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
    label: "Base USDC→BTC (buy)",
    family: "btc_swap",
    amount: "250000000",
    execCostUsd: 0.10,
  },
  // Reverse direction — sell BTC for stablecoins (profitable when Gateway lags during crash)
  {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    label: "BTC→Base USDC (sell)",
    family: "btc_swap",
    amount: "350000",
    execCostUsd: 1.50,
  },
  {
    routeKey: "bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    label: "BOB→Base wBTC.OFT",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 0.79,
  },
];

// ── Route key parsing ────────────────────────────────────────────────────────

export function parseRouteKey(rk) {
  const [srcPart, dstPart] = rk.split("->");
  if (!srcPart || !dstPart) return null;
  const srcColon = srcPart.indexOf(":");
  const dstColon = dstPart.indexOf(":");
  if (srcColon < 0 || dstColon < 0) return null;
  return {
    srcChain: srcPart.slice(0, srcColon),
    srcToken: srcPart.slice(srcColon + 1),
    dstChain: dstPart.slice(0, dstColon),
    dstToken: dstPart.slice(dstColon + 1),
  };
}

// ── Quote type detection ─────────────────────────────────────────────────────

function extractQuotePayload(body) {
  return body.onramp || body.offramp || body.layerZero || body;
}

function extractQuoteType(body) {
  if (body.onramp) return "onramp";
  if (body.offramp) return "offramp";
  if (body.layerZero) return "layerZero";
  return "unknown";
}

// ── Amount extraction ─────────────────────────────────────────────────────────

/** Gateway API returns amounts as {amount, address, chain} objects or raw strings. */
function extractAmountStr(field) {
  if (field && typeof field === "object" && "amount" in field) return field.amount;
  if (typeof field === "string" || typeof field === "bigint" || typeof field === "number") return String(field);
  return "0";
}

// ── Lag computation ──────────────────────────────────────────────────────────

/**
 * Compute the gateway implied BTC price and lag vs market.
 *
 * lagPct = (gatewayImplied - market) / market — raw price discrepancy.
 * edgePct = directional benefit to the executor of THIS route:
 *   - btc_wrap / BTC→stable: edgePct = lagPct (positive lag = good for us)
 *   - stable→BTC: edgePct = -lagPct (positive lag = Gateway overprices BTC = we overpay)
 */
export function computeLag(probe, quotePayload, quoteType, btcMarketUsd) {
  const inputAmount = BigInt(extractAmountStr(quotePayload.inputAmount) || probe.amount);
  const outputAmount = BigInt(extractAmountStr(quotePayload.outputAmount) || "0");

  if (outputAmount === 0n) {
    return { gatewayImpliedPriceUsd: null, lagPct: null, edgePct: null, lagUsd: null, edgeUsd: null };
  }

  const inputNum = Number(inputAmount);
  const outputNum = Number(outputAmount);
  let gatewayImpliedPriceUsd;
  let buyingSide = false; // true when executor sends stablecoins and receives BTC

  if (probe.family === "btc_wrap") {
    const effectiveRate = outputNum / inputNum;
    gatewayImpliedPriceUsd = effectiveRate * btcMarketUsd;
  } else if (probe.family === "btc_swap") {
    const parsed = parseRouteKey(probe.routeKey);
    if (!parsed) return { gatewayImpliedPriceUsd: null, lagPct: null, edgePct: null, lagUsd: null, edgeUsd: null };

    if (parsed.srcChain === "bitcoin") {
      // BTC→stablecoin: we sell BTC, receive USD
      const btcSent = inputNum / 1e8;
      const usdReceived = outputNum / 1e6;
      gatewayImpliedPriceUsd = usdReceived / btcSent;
    } else if (parsed.dstChain === "bitcoin") {
      // Stablecoin→BTC: we buy BTC, send USD
      const usdSent = inputNum / 1e6;
      const btcReceived = outputNum / 1e8;
      gatewayImpliedPriceUsd = usdSent / btcReceived;
      buyingSide = true;
    } else {
      return { gatewayImpliedPriceUsd: null, lagPct: null, edgePct: null, lagUsd: null, edgeUsd: null };
    }
  } else {
    const effectiveRate = outputNum / inputNum;
    gatewayImpliedPriceUsd = effectiveRate * btcMarketUsd;
  }

  const lagPct = ((gatewayImpliedPriceUsd - btcMarketUsd) / btcMarketUsd) * 100;
  // edgePct: positive = good for the executor of this route
  const edgePct = buyingSide ? -lagPct : lagPct;

  const probeValueBtc = probe.family === "btc_swap"
    ? (buyingSide ? inputNum / 1e6 / btcMarketUsd : inputNum / 1e8)
    : inputNum / 1e8;
  const lagUsd = (lagPct / 100) * btcMarketUsd * probeValueBtc;
  const edgeUsd = (edgePct / 100) * btcMarketUsd * probeValueBtc;

  return {
    gatewayImpliedPriceUsd: round(gatewayImpliedPriceUsd, 2),
    lagPct: round(lagPct, 4),
    edgePct: round(edgePct, 4),
    lagUsd: round(lagUsd, 2),
    edgeUsd: round(edgeUsd, 2),
  };
}

function round(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ── Percentile helper ────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// ── Summary statistics ───────────────────────────────────────────────────────

export function buildLagSummary(samples) {
  if (!samples || samples.length === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sampleCount: 0,
      oldestSampleAt: null,
      latestSampleAt: null,
      btcPriceRange: { min: null, max: null },
      lagStats: {
        maxEdgePct: null,
        avgEdgePct: null,
        p95EdgePct: null,
        maxEdgeUsd: null,
        profitableSampleCount: 0,
        profitableSamplePct: 0,
      },
      probeStats: [],
      verdict: "no_data",
      collectionStatus: "running",
    };
  }

  const btcPrices = samples.map((s) => s.btcMarketUsd).filter(Number.isFinite);
  const allProbes = samples.flatMap((s) => s.probes || []);
  const successProbes = allProbes.filter((p) => p.success && Number.isFinite(p.edgePct ?? p.lagPct));
  const edgePcts = successProbes.map((p) => p.edgePct ?? p.lagPct).sort((a, b) => a - b);
  const edgeUsds = successProbes.map((p) => p.edgeUsd ?? p.lagUsd).filter(Number.isFinite);
  const profitableSamples = samples.filter(
    (s) => (s.probes || []).some((p) => p.profitable),
  );

  // Per-probe label stats
  const labelMap = new Map();
  for (const probe of allProbes) {
    if (!labelMap.has(probe.label)) {
      labelMap.set(probe.label, { successes: 0, total: 0, edges: [], profitableCount: 0 });
    }
    const entry = labelMap.get(probe.label);
    entry.total += 1;
    if (probe.success) {
      entry.successes += 1;
      const edge = probe.edgePct ?? probe.lagPct;
      if (Number.isFinite(edge)) entry.edges.push(edge);
    }
    if (probe.profitable) entry.profitableCount += 1;
  }

  const probeStats = [...labelMap.entries()].map(([label, entry]) => ({
    label,
    sampleCount: entry.total,
    successRate: entry.total > 0 ? round(entry.successes / entry.total, 4) : 0,
    avgEdgePct: entry.edges.length > 0 ? round(entry.edges.reduce((a, b) => a + b, 0) / entry.edges.length, 4) : null,
    maxEdgePct: entry.edges.length > 0 ? round(Math.max(...entry.edges), 4) : null,
    profitableCount: entry.profitableCount,
  }));

  const hasProfitable = profitableSamples.length > 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    oldestSampleAt: samples[0]?.observedAt || null,
    latestSampleAt: samples[samples.length - 1]?.observedAt || null,
    btcPriceRange: {
      min: btcPrices.length > 0 ? Math.min(...btcPrices) : null,
      max: btcPrices.length > 0 ? Math.max(...btcPrices) : null,
    },
    lagStats: {
      maxEdgePct: edgePcts.length > 0 ? round(Math.max(...edgePcts), 4) : null,
      avgEdgePct: edgePcts.length > 0 ? round(edgePcts.reduce((a, b) => a + b, 0) / edgePcts.length, 4) : null,
      p95EdgePct: percentile(edgePcts, 95),
      maxEdgeUsd: edgeUsds.length > 0 ? round(Math.max(...edgeUsds), 2) : null,
      profitableSampleCount: profitableSamples.length,
      profitableSamplePct: samples.length > 0 ? round((profitableSamples.length / samples.length) * 100, 2) : 0,
    },
    probeStats,
    verdict: hasProfitable ? "profitable_dislocations_found" : "no_profitable_dislocations",
    collectionStatus: "running",
  };
}

// ── Single sample collection ─────────────────────────────────────────────────

export async function collectOneSample(options = {}) {
  const {
    client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
    store = new JsonlStore(config.dataDir),
    probeRoutes = PROBE_ROUTES,
    recipient = config.verifyRecipient,
    btcRecipient = config.verifyBtcRecipient,
    slippageBps = config.slippageBps,
    requestDelayMs = config.requestDelayMs,
    btcMarketUsd: injectedBtcPrice = null,
  } = options;

  const observedAt = new Date().toISOString();

  // 1. Fetch BTC market price
  let btcMarketUsd = injectedBtcPrice;
  if (!Number.isFinite(btcMarketUsd)) {
    const prices = await getCoinGeckoPricesUsd();
    btcMarketUsd = prices.btc;
  }

  if (!Number.isFinite(btcMarketUsd) || btcMarketUsd <= 0) {
    throw new Error(`Failed to get BTC market price (got ${btcMarketUsd})`);
  }

  // 2. Probe each route
  const probes = [];
  for (let i = 0; i < probeRoutes.length; i += 1) {
    const probe = probeRoutes[i];
    const parsed = parseRouteKey(probe.routeKey);
    if (!parsed) {
      probes.push({
        routeKey: probe.routeKey,
        label: probe.label,
        family: probe.family,
        amount: probe.amount,
        success: false,
        error: "invalid_route_key",
        latencyMs: 0,
        inputAmount: probe.amount,
        outputAmount: null,
        gatewayImpliedPriceUsd: null,
        marketPriceUsd: btcMarketUsd,
        lagPct: null,
        lagUsd: null,
        execCostUsd: probe.execCostUsd,
        netAfterExecUsd: null,
        profitable: false,
      });
      continue;
    }

    // Build quote params
    const isBtcSrc = parsed.srcChain === "bitcoin";
    const isBtcDst = parsed.dstChain === "bitcoin";
    const quoteParams = {
      srcChain: parsed.srcChain,
      dstChain: parsed.dstChain,
      srcToken: parsed.srcToken,
      dstToken: parsed.dstToken,
      amount: probe.amount,
      recipient: isBtcDst ? btcRecipient : recipient,
      slippage: slippageBps,
    };
    // Only include sender for non-Bitcoin source
    if (!isBtcSrc) {
      quoteParams.sender = recipient;
    }

    try {
      const quoteResult = await client.getQuote(quoteParams);
      const quoteType = extractQuoteType(quoteResult.body);
      const payload = extractQuotePayload(quoteResult.body);
      const lag = computeLag(probe, payload, quoteType, btcMarketUsd);

      const netAfterExecUsd = Number.isFinite(lag.edgeUsd)
        ? round(lag.edgeUsd - probe.execCostUsd, 2)
        : null;
      const profitable = Number.isFinite(netAfterExecUsd) && netAfterExecUsd > 0;

      probes.push({
        routeKey: probe.routeKey,
        label: probe.label,
        family: probe.family,
        amount: probe.amount,
        success: true,
        latencyMs: quoteResult.latencyMs,
        inputAmount: extractAmountStr(payload.inputAmount) || probe.amount,
        outputAmount: extractAmountStr(payload.outputAmount) || "0",
        gatewayImpliedPriceUsd: lag.gatewayImpliedPriceUsd,
        marketPriceUsd: btcMarketUsd,
        lagPct: lag.lagPct,
        edgePct: lag.edgePct,
        lagUsd: lag.lagUsd,
        edgeUsd: lag.edgeUsd,
        execCostUsd: probe.execCostUsd,
        netAfterExecUsd,
        profitable,
      });
    } catch (error) {
      probes.push({
        routeKey: probe.routeKey,
        label: probe.label,
        family: probe.family,
        amount: probe.amount,
        success: false,
        error: error.message || String(error),
        latencyMs: error.details?.latencyMs || 0,
        inputAmount: probe.amount,
        outputAmount: null,
        gatewayImpliedPriceUsd: null,
        marketPriceUsd: btcMarketUsd,
        lagPct: null,
        lagUsd: null,
        execCostUsd: probe.execCostUsd,
        netAfterExecUsd: null,
        profitable: false,
      });
    }

    // Request delay between probes
    if (i < probeRoutes.length - 1 && requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  // 3. Build sample record
  const successCount = probes.filter((p) => p.success).length;
  const successProbes = probes.filter((p) => p.success && Number.isFinite(p.edgePct));
  const edgePcts = successProbes.map((p) => p.edgePct);
  const edgeUsds = successProbes.map((p) => p.edgeUsd).filter(Number.isFinite);
  const profitableCount = probes.filter((p) => p.profitable).length;

  const record = {
    schemaVersion: SCHEMA_VERSION,
    observedAt,
    btcMarketUsd,
    probes,
    summary: {
      probeCount: probes.length,
      successCount,
      maxEdgePct: edgePcts.length > 0 ? round(Math.max(...edgePcts), 4) : null,
      maxEdgeUsd: edgeUsds.length > 0 ? round(Math.max(...edgeUsds), 2) : null,
      profitableCount,
      btcVolatility1h: null,
    },
  };

  // 4. Persist
  await store.append("quote-lag-samples", record);

  // 5. Update latest summary from all historical samples
  const allSamples = await readJsonl(config.dataDir, "quote-lag-samples");
  const summary = buildLagSummary(allSamples);
  const latestPath = join(config.dataDir, "quote-lag-latest.json");
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(latestPath, JSON.stringify(summary, null, 2) + "\n");

  return { record, summary };
}

// ── CLI argument parsing ─────────────────────────────────────────────────────

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
    interval: options.interval ? Number(options.interval) : 300,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Console output ───────────────────────────────────────────────────────────

function printSample(record) {
  const ts = record.observedAt.slice(11, 19);
  console.log(`\n[${ts}] BTC $${record.btcMarketUsd.toLocaleString()}`);

  for (const probe of record.probes) {
    const status = probe.success ? "✓" : "✗";
    const edge = Number.isFinite(probe.edgePct) ? `${probe.edgePct > 0 ? "+" : ""}${probe.edgePct.toFixed(3)}%` : "n/a";
    const net = Number.isFinite(probe.netAfterExecUsd) ? `$${probe.netAfterExecUsd.toFixed(2)}` : "n/a";
    const flag = probe.profitable ? " 🟢" : "";
    console.log(`  ${status} ${probe.label.padEnd(26)} edge=${edge.padStart(8)}  net=${net.padStart(8)}${flag}`);
  }

  const { summary } = record;
  console.log(`  ── ${summary.successCount}/${summary.probeCount} ok, maxEdge=${summary.maxEdgePct ?? "n/a"}%, profitable=${summary.profitableCount}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.once) {
    const { record, summary } = await collectOneSample();
    if (args.json) {
      console.log(JSON.stringify({ record, summary }, null, 2));
    } else {
      printSample(record);
    }
    return;
  }

  // Continuous mode
  const intervalMs = args.interval * 1000;
  console.log(`quote-lag collector: sampling every ${args.interval}s (Ctrl-C to stop)`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { record } = await collectOneSample();
      if (args.json) {
        console.log(JSON.stringify(record));
      } else {
        printSample(record);
      }
    } catch (error) {
      console.error(`[error] ${error.message}`);
    }
    await sleep(intervalMs);
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
