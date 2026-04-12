#!/usr/bin/env node

/**
 * DEX Spread Collector — monitors BTC token prices on Base chain via Odos.
 *
 * Tracks: LBTC, cbBTC, wBTC.OFT, tBTC on Base → USDC.
 * Computes inter-token spread matrix and LBTC premium.
 * Writes JSONL samples + latest JSON for dashboard integration.
 *
 * Usage:
 *   node src/cli/collect-dex-spreads.mjs [--interval=60] [--refresh-dashboard] [--once] [--json]
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { config } from "../config/env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");

const SCHEMA_VERSION = 1;

// ── Base chain BTC tokens to monitor ─────────────────────────────────────────

const BASE_CHAIN_ID = 8453;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

const BTC_TOKENS = [
  { symbol: "LBTC",      address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8, issuer: "Lombard" },
  { symbol: "cbBTC",     address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, issuer: "Coinbase" },
  { symbol: "tBTC",      address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", decimals: 18, issuer: "Threshold" },
];

// 0.005 BTC = 500,000 sats (8 decimals) for cbBTC, LBTC, wBTC.OFT
// For tBTC (18 decimals): 0.005 * 1e18 = 5000000000000000
const PROBE_AMOUNT_8DEC = "500000";
const PROBE_AMOUNT_18DEC = "5000000000000000";
const PROBE_BTC = 0.005;

const ODOS_API = "https://api.odos.xyz";
const CALL_DELAY_MS = 2500; // rate limit: 2.5s between calls

// ── Memory-efficient JSONL tail reader ───────────────────────────────────────

async function readJsonlTail(filePath, maxLines = 2016) {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-maxLines).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ── Odos quote helper ────────────────────────────────────────────────────────

async function quoteOdos(inputToken, amount) {
  const body = {
    chainId: BASE_CHAIN_ID,
    inputTokens: [{ tokenAddress: inputToken, amount }],
    outputTokens: [{ tokenAddress: USDC_BASE, proportion: 1 }],
    userAddr: "0x0000000000000000000000000000000000000001",
    slippageLimitPercent: 0.5,
    disableRFQs: true,
    compact: true,
  };
  const start = Date.now();
  const r = await fetch(`${ODOS_API}/sor/quote/v3`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return { ok: false, error: `HTTP ${r.status}: ${detail.slice(0, 200)}`, latencyMs };
  }
  const data = await r.json();
  const usdcOut = Number(data.outAmounts?.[0] || 0) / 10 ** USDC_DECIMALS;
  const gasUsd = data.gasEstimateValue ?? 0;
  const impact = data.priceImpact ?? 0;
  return {
    ok: true,
    usdcOut,
    gasUsd,
    impact,
    netUsdc: usdcOut - gasUsd,
    impliedBtcPrice: usdcOut / PROBE_BTC,
    latencyMs,
    blockNumber: data.blockNumber ?? null,
  };
}

// ── Collect one sample ───────────────────────────────────────────────────────

export async function collectOneSample() {
  const ts = new Date().toISOString();
  const results = [];
  let errors = 0;

  for (const token of BTC_TOKENS) {
    const amount = token.decimals === 18 ? PROBE_AMOUNT_18DEC : PROBE_AMOUNT_8DEC;
    const q = await quoteOdos(token.address, amount);
    if (q.ok) {
      results.push({
        symbol: token.symbol,
        issuer: token.issuer,
        usdcOut: q.usdcOut,
        gasUsd: q.gasUsd,
        netUsdc: q.netUsdc,
        impact: q.impact,
        impliedBtcPrice: q.impliedBtcPrice,
        latencyMs: q.latencyMs,
        blockNumber: q.blockNumber,
      });
    } else {
      errors++;
      results.push({ symbol: token.symbol, issuer: token.issuer, error: q.error, latencyMs: q.latencyMs });
    }
    // Rate limit
    if (token !== BTC_TOKENS[BTC_TOKENS.length - 1]) {
      await new Promise(r => setTimeout(r, CALL_DELAY_MS));
    }
  }

  // Compute spread matrix
  const priced = results.filter(r => r.netUsdc != null && !r.error);
  priced.sort((a, b) => b.netUsdc - a.netUsdc); // best first

  const best = priced[0];
  const worst = priced[priced.length - 1];
  const spreadUsd = best && worst ? best.netUsdc - worst.netUsdc : 0;
  const spreadPct = best && worst ? (spreadUsd / worst.netUsdc) * 100 : 0;

  // LBTC premium vs cbBTC (the most liquid standard BTC token on Base)
  const lbtc = priced.find(r => r.symbol === "LBTC");
  const cbbtc = priced.find(r => r.symbol === "cbBTC");
  const lbtcPremiumUsd = lbtc && cbbtc ? lbtc.netUsdc - cbbtc.netUsdc : null;
  const lbtcPremiumPct = lbtc && cbbtc ? (lbtcPremiumUsd / cbbtc.netUsdc) * 100 : null;

  // Pair spreads
  const pairSpreads = [];
  for (let i = 0; i < priced.length; i++) {
    for (let j = i + 1; j < priced.length; j++) {
      const diff = priced[i].netUsdc - priced[j].netUsdc;
      const pct = (diff / priced[j].netUsdc) * 100;
      pairSpreads.push({
        buy: priced[j].symbol,
        sell: priced[i].symbol,
        spreadUsd: +diff.toFixed(4),
        spreadPct: +pct.toFixed(4),
      });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    observedAt: ts,
    probeBtc: PROBE_BTC,
    chain: "base",
    chainId: BASE_CHAIN_ID,
    tokens: results,
    ranked: priced.map(r => r.symbol),
    bestToken: best?.symbol || null,
    worstToken: worst?.symbol || null,
    spreadUsd: +spreadUsd.toFixed(4),
    spreadPct: +spreadPct.toFixed(4),
    lbtcPremiumUsd: lbtcPremiumUsd != null ? +lbtcPremiumUsd.toFixed(4) : null,
    lbtcPremiumPct: lbtcPremiumPct != null ? +lbtcPremiumPct.toFixed(4) : null,
    pairSpreads,
    errors,
  };
}

// ── Build summary from history ───────────────────────────────────────────────

export function buildSpreadSummary(samples) {
  if (!samples.length) return null;
  const recent = samples.slice(-288); // last 24h at 5-min intervals
  const spreads = recent.map(s => s.spreadPct).filter(v => v != null);
  const premiums = recent.map(s => s.lbtcPremiumPct).filter(v => v != null);

  return {
    sampleCount: recent.length,
    timeRange: { from: recent[0]?.observedAt, to: recent[recent.length - 1]?.observedAt },
    spread: {
      current: spreads[spreads.length - 1] || 0,
      mean: +(spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(4),
      max: +Math.max(...spreads).toFixed(4),
      min: +Math.min(...spreads).toFixed(4),
    },
    lbtcPremium: {
      current: premiums[premiums.length - 1] || 0,
      mean: +(premiums.reduce((a, b) => a + b, 0) / premiums.length).toFixed(4),
      max: +Math.max(...premiums).toFixed(4),
      min: +Math.min(...premiums).toFixed(4),
    },
    bestToken: {
      counts: countBy(recent, s => s.bestToken),
    },
  };
}

function countBy(arr, fn) {
  const counts = {};
  for (const item of arr) {
    const key = fn(item);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// ── Persist ──────────────────────────────────────────────────────────────────

async function persistSample(sample) {
  await mkdir(DATA_DIR, { recursive: true });
  const jsonlPath = join(DATA_DIR, "dex-spread-samples.jsonl");
  await appendFile(jsonlPath, JSON.stringify(sample) + "\n");

  // Latest JSON for dashboard
  const samples = await readJsonlTail(jsonlPath, 2016);
  const summary = buildSpreadSummary(samples);
  const latest = { ...sample, summary };
  await writeFile(join(DATA_DIR, "dex-spread-latest.json"), JSON.stringify(latest, null, 2) + "\n");
  return { sampleCount: samples.length, summary };
}

// ── Dashboard refresh ────────────────────────────────────────────────────────

function refreshDashboard() {
  const result = spawnSync(process.execPath, [resolve(ROOT, "src/cli/status-dashboard.mjs"), "--skip-shadow-cycle"], {
    cwd: ROOT, timeout: 60_000, stdio: "pipe",
  });
  return result.status === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = new Set(argv.filter(a => !a.includes("=")));
  const kv = Object.fromEntries(argv.filter(a => a.includes("=")).map(a => a.split("=")));
  return {
    interval: parseInt(kv["--interval"] || "60", 10),
    refreshDashboard: flags.has("--refresh-dashboard"),
    once: flags.has("--once"),
    json: flags.has("--json"),
  };
}

function printSample(sample) {
  console.log(`\n─── DEX Spread Probe @ ${sample.observedAt.slice(11, 19)} ──────────────`);
  for (const t of sample.tokens) {
    if (t.error) {
      console.log(`  ✗ ${t.symbol.padEnd(10)} ERROR: ${t.error.slice(0, 60)}`);
    } else {
      const net = `$${t.netUsdc.toFixed(2)}`;
      const imp = `${t.impact.toFixed(3)}%`;
      const lat = `${t.latencyMs}ms`;
      console.log(`  ✓ ${t.symbol.padEnd(10)} net=${net.padStart(8)}  impact=${imp.padStart(7)}  ${lat}`);
    }
  }
  const sp = sample.spreadPct.toFixed(3);
  const lp = sample.lbtcPremiumPct != null ? sample.lbtcPremiumPct.toFixed(3) : "n/a";
  console.log(`  spread: ${sp}%  LBTC premium: ${lp}%  best: ${sample.bestToken}  errors: ${sample.errors}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.once || args.json) {
    const sample = await collectOneSample();
    if (args.json) {
      console.log(JSON.stringify(sample, null, 2));
    } else {
      printSample(sample);
    }
    const { sampleCount } = await persistSample(sample);
    console.log(`  → saved (${sampleCount} total samples)`);
    if (args.refreshDashboard) {
      const ok = refreshDashboard();
      console.log(`  dashboard: ${ok ? "✓" : "⚠ refresh failed"}`);
    }
    return;
  }

  // Loop mode
  console.log(`DEX Spread Collector starting — interval ${args.interval}s, dashboard=${args.refreshDashboard}`);
  console.log(`  Monitoring: ${BTC_TOKENS.map(t => t.symbol).join(", ")} on Base`);
  console.log(`  Probe size: ${PROBE_BTC} BTC → USDC\n`);

  let cycles = 0;
  while (true) {
    try {
      const sample = await collectOneSample();
      cycles++;
      printSample(sample);
      const { sampleCount, summary } = await persistSample(sample);
      console.log(`  → #${cycles} saved (${sampleCount} total)`);
      if (summary) {
        console.log(`  summary: spread avg=${summary.spread.mean.toFixed(3)}% max=${summary.spread.max.toFixed(3)}%  LBTC prem avg=${summary.lbtcPremium.mean.toFixed(3)}%`);
      }
      if (args.refreshDashboard) {
        const ok = refreshDashboard();
        if (!ok) console.log("  ⚠ dashboard refresh failed");
      }
    } catch (err) {
      console.error(`  ✗ cycle error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, args.interval * 1000));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
