#!/usr/bin/env node

/**
 * DEX Spread Collector — monitors BTC token prices across all viable chains via Odos.
 *
 * Tracks BTC tokens on: Base, Arbitrum, Ethereum, BSC, Avalanche, Optimism, Polygon
 * Computes cross-chain spread matrix and LBTC premium.
 * Writes JSONL samples + latest JSON for dashboard integration.
 *
 * Usage:
 *   node src/cli/collect-dex-spreads.mjs [--interval=90] [--refresh-dashboard] [--once] [--json]
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { config } from "../config/env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");

const SCHEMA_VERSION = 2;

// ── Multi-chain BTC token registry ───────────────────────────────────────────
// Only tokens verified to have Odos routing + meaningful liquidity (impact <10%)

const CHAIN_CONFIGS = [
  {
    chain: "base", chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", usdcDecimals: 6,
    tokens: [
      { symbol: "LBTC",  address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8, issuer: "Lombard" },
      { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, issuer: "Coinbase" },
      { symbol: "tBTC",  address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", decimals: 18, issuer: "Threshold" },
    ],
  },
  {
    chain: "arbitrum", chainId: 42161,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", usdcDecimals: 6,
    tokens: [
      { symbol: "WBTC", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, issuer: "BitGo" },
      { symbol: "tBTC", address: "0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40", decimals: 18, issuer: "Threshold" },
    ],
  },
  {
    chain: "ethereum", chainId: 1,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", usdcDecimals: 6,
    tokens: [
      { symbol: "WBTC",  address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, issuer: "BitGo" },
      { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, issuer: "Coinbase" },
    ],
  },
  {
    chain: "bsc", chainId: 56,
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", usdcDecimals: 18,
    tokens: [
      { symbol: "BTCB", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18, issuer: "Binance" },
    ],
  },
  {
    chain: "avalanche", chainId: 43114,
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", usdcDecimals: 6,
    tokens: [
      { symbol: "WBTC.e", address: "0x50b7545627a5162F82A992c33b87aDc75187B218", decimals: 8, issuer: "Wrapped" },
    ],
  },
  {
    chain: "optimism", chainId: 10,
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", usdcDecimals: 6,
    tokens: [
      { symbol: "WBTC", address: "0x68f180fcCe6836688e9084f035309E29Bf0A2095", decimals: 8, issuer: "BitGo" },
    ],
  },
  {
    chain: "polygon", chainId: 137,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", usdcDecimals: 6,
    tokens: [
      { symbol: "WBTC", address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8, issuer: "BitGo" },
    ],
  },
];

const PROBE_BTC = 0.005;
const ODOS_API = "https://api.odos.xyz";
const CALL_DELAY_MS = 2500;

// ── Memory-efficient JSONL tail reader ───────────────────────────────────────

async function readJsonlTail(filePath, maxLines = 2016) {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-maxLines).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ── Odos quote helper (chain-generic) ────────────────────────────────────────

async function quoteOdos(chainId, inputToken, amount, usdcAddr, usdcDecimals) {
  const body = {
    chainId,
    inputTokens: [{ tokenAddress: inputToken, amount }],
    outputTokens: [{ tokenAddress: usdcAddr, proportion: 1 }],
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
  const usdcOut = Number(data.outAmounts?.[0] || 0) / 10 ** usdcDecimals;
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
    gweiPerGas: data.gweiPerGas ?? null,
  };
}

// ── Collect one sample (all chains) ──────────────────────────────────────────

export async function collectOneSample() {
  const ts = new Date().toISOString();
  const allResults = [];
  let errors = 0;

  for (const chainCfg of CHAIN_CONFIGS) {
    for (const token of chainCfg.tokens) {
      const amount = token.decimals === 18
        ? String(BigInt(Math.round(PROBE_BTC * 1e18)))
        : String(Math.round(PROBE_BTC * 10 ** token.decimals));
      const q = await quoteOdos(chainCfg.chainId, token.address, amount, chainCfg.usdc, chainCfg.usdcDecimals);
      if (q.ok) {
        allResults.push({
          chain: chainCfg.chain,
          chainId: chainCfg.chainId,
          symbol: token.symbol,
          issuer: token.issuer,
          usdcOut: q.usdcOut,
          gasUsd: q.gasUsd,
          netUsdc: q.netUsdc,
          impact: q.impact,
          impliedBtcPrice: q.impliedBtcPrice,
          latencyMs: q.latencyMs,
          blockNumber: q.blockNumber,
          gweiPerGas: q.gweiPerGas,
        });
      } else {
        errors++;
        allResults.push({ chain: chainCfg.chain, chainId: chainCfg.chainId, symbol: token.symbol, issuer: token.issuer, error: q.error, latencyMs: q.latencyMs });
      }
      await new Promise(r => setTimeout(r, CALL_DELAY_MS));
    }
  }

  // Global cross-chain spread
  const priced = allResults.filter(r => r.netUsdc != null && !r.error && r.impact < 10);
  priced.sort((a, b) => b.netUsdc - a.netUsdc);

  const best = priced[0];
  const worst = priced[priced.length - 1];
  const spreadUsd = best && worst ? best.netUsdc - worst.netUsdc : 0;
  const spreadPct = best && worst ? (spreadUsd / worst.netUsdc) * 100 : 0;

  // LBTC premium vs cbBTC on Base
  const lbtc = priced.find(r => r.symbol === "LBTC" && r.chain === "base");
  const cbbtc = priced.find(r => r.symbol === "cbBTC" && r.chain === "base");
  const lbtcPremiumUsd = lbtc && cbbtc ? lbtc.netUsdc - cbbtc.netUsdc : null;
  const lbtcPremiumPct = lbtc && cbbtc ? (lbtcPremiumUsd / cbbtc.netUsdc) * 100 : null;

  // Per-chain summaries
  const chainSummaries = {};
  for (const chainCfg of CHAIN_CONFIGS) {
    const chainTokens = priced.filter(r => r.chain === chainCfg.chain);
    if (!chainTokens.length) continue;
    const cBest = chainTokens[0];
    const cWorst = chainTokens[chainTokens.length - 1];
    chainSummaries[chainCfg.chain] = {
      tokenCount: chainTokens.length,
      best: cBest.symbol,
      worst: cWorst.symbol,
      spreadPct: chainTokens.length > 1 ? +((cBest.netUsdc - cWorst.netUsdc) / cWorst.netUsdc * 100).toFixed(4) : 0,
      avgGasUsd: +(chainTokens.reduce((a, r) => a + r.gasUsd, 0) / chainTokens.length).toFixed(4),
      avgLatencyMs: Math.round(chainTokens.reduce((a, r) => a + r.latencyMs, 0) / chainTokens.length),
    };
  }

  // Top cross-chain pairs
  const crossChainPairs = [];
  for (let i = 0; i < Math.min(priced.length, 5); i++) {
    for (let j = Math.max(priced.length - 3, i + 1); j < priced.length; j++) {
      if (priced[i].chain === priced[j].chain) continue;
      const diff = priced[i].netUsdc - priced[j].netUsdc;
      crossChainPairs.push({
        buy: `${priced[j].chain}:${priced[j].symbol}`,
        sell: `${priced[i].chain}:${priced[i].symbol}`,
        spreadUsd: +diff.toFixed(4),
        spreadPct: +((diff / priced[j].netUsdc) * 100).toFixed(4),
      });
    }
  }
  crossChainPairs.sort((a, b) => b.spreadPct - a.spreadPct);

  return {
    schemaVersion: SCHEMA_VERSION,
    observedAt: ts,
    probeBtc: PROBE_BTC,
    chainCount: CHAIN_CONFIGS.length,
    tokenCount: allResults.length,
    tokens: allResults,
    ranked: priced.map(r => `${r.chain}:${r.symbol}`),
    bestToken: best ? `${best.chain}:${best.symbol}` : null,
    worstToken: worst ? `${worst.chain}:${worst.symbol}` : null,
    spreadUsd: +spreadUsd.toFixed(4),
    spreadPct: +spreadPct.toFixed(4),
    lbtcPremiumUsd: lbtcPremiumUsd != null ? +lbtcPremiumUsd.toFixed(4) : null,
    lbtcPremiumPct: lbtcPremiumPct != null ? +lbtcPremiumPct.toFixed(4) : null,
    chainSummaries,
    crossChainPairs: crossChainPairs.slice(0, 5),
    errors,
  };
}

// ── Build summary from history ───────────────────────────────────────────────

export function buildSpreadSummary(samples) {
  if (!samples.length) return null;
  const recent = samples.slice(-288);
  const spreads = recent.map(s => s.spreadPct).filter(v => v != null);
  const premiums = recent.map(s => s.lbtcPremiumPct).filter(v => v != null);

  return {
    sampleCount: recent.length,
    timeRange: { from: recent[0]?.observedAt, to: recent[recent.length - 1]?.observedAt },
    spread: {
      current: spreads[spreads.length - 1] || 0,
      mean: spreads.length ? +(spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(4) : 0,
      max: spreads.length ? +Math.max(...spreads).toFixed(4) : 0,
      min: spreads.length ? +Math.min(...spreads).toFixed(4) : 0,
    },
    lbtcPremium: {
      current: premiums[premiums.length - 1] || 0,
      mean: premiums.length ? +(premiums.reduce((a, b) => a + b, 0) / premiums.length).toFixed(4) : 0,
      max: premiums.length ? +Math.max(...premiums).toFixed(4) : 0,
      min: premiums.length ? +Math.min(...premiums).toFixed(4) : 0,
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
    interval: parseInt(kv["--interval"] || "90", 10),
    refreshDashboard: flags.has("--refresh-dashboard"),
    once: flags.has("--once"),
    json: flags.has("--json"),
  };
}

function printSample(sample) {
  console.log(`\n─── DEX Spread Probe @ ${sample.observedAt.slice(11, 19)} (${sample.chainCount} chains, ${sample.tokenCount} tokens) ──`);
  let lastChain = "";
  for (const t of sample.tokens) {
    if (t.chain !== lastChain) { console.log(`  [${t.chain}]`); lastChain = t.chain; }
    if (t.error) {
      console.log(`    ✗ ${t.symbol.padEnd(8)} ERROR: ${t.error.slice(0, 50)}`);
    } else {
      const net = `$${t.netUsdc.toFixed(2)}`;
      const imp = `${t.impact.toFixed(3)}%`;
      const gas = `$${t.gasUsd.toFixed(3)}`;
      const gwei = t.gweiPerGas != null ? `${t.gweiPerGas.toFixed(1)}gwei` : "";
      console.log(`    ✓ ${t.symbol.padEnd(8)} net=${net.padStart(8)}  gas=${gas.padStart(7)}  impact=${imp.padStart(7)}  ${t.latencyMs}ms ${gwei}`);
    }
  }
  const sp = sample.spreadPct.toFixed(3);
  const lp = sample.lbtcPremiumPct != null ? sample.lbtcPremiumPct.toFixed(3) : "n/a";
  console.log(`  ── cross-chain spread: ${sp}%  LBTC premium: ${lp}%  best: ${sample.bestToken}  errors: ${sample.errors}`);
  if (sample.crossChainPairs?.length) {
    console.log(`  ── top pairs: ${sample.crossChainPairs.slice(0, 3).map(p => `${p.sell}→${p.buy} ${p.spreadPct.toFixed(3)}%`).join(" | ")}`);
  }
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

  const totalTokens = CHAIN_CONFIGS.reduce((n, c) => n + c.tokens.length, 0);
  console.log(`DEX Spread Collector v2 — ${CHAIN_CONFIGS.length} chains, ${totalTokens} tokens, interval ${args.interval}s`);
  for (const c of CHAIN_CONFIGS) {
    console.log(`  ${c.chain}: ${c.tokens.map(t => t.symbol).join(", ")}`);
  }
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
