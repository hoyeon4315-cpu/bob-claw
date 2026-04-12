#!/usr/bin/env node

/**
 * Triangular Arb Simulator — tests USDC round-trip profitability on Base.
 *
 * For each pair (X, Y) of Base BTC tokens, simulates:
 *   USDC → X → Y → USDC
 * and reports net profit/loss after gas.
 *
 * Usage:
 *   node src/cli/sim-triangular-arb.mjs [--amount=250] [--json] [--all-chains]
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");
const ODOS_API = "https://api.odos.xyz";
const CALL_DELAY_MS = 2500;

const BASE_CHAIN_ID = 8453;
const USDC_BASE = { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC" };

const BASE_BTC_TOKENS = [
  { symbol: "LBTC",  address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8 },
  { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
  { symbol: "tBTC",  address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", decimals: 18 },
];

async function odosQuote(chainId, inputAddr, inputAmount, outputAddr) {
  const body = {
    chainId,
    inputTokens: [{ tokenAddress: inputAddr, amount: inputAmount }],
    outputTokens: [{ tokenAddress: outputAddr, proportion: 1 }],
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
    return { ok: false, error: `HTTP ${r.status}`, latencyMs };
  }
  const data = await r.json();
  return {
    ok: true,
    outAmount: data.outAmounts?.[0] || "0",
    gasUsd: data.gasEstimateValue ?? 0,
    impact: data.priceImpact ?? 0,
    inValueUsd: data.inValues?.[0] ?? 0,
    outValueUsd: data.outValues?.[0] ?? 0,
    latencyMs,
  };
}

async function simulateTriangle(amountUsd, tokenA, tokenB) {
  const usdcAmount = String(Math.round(amountUsd * 10 ** USDC_BASE.decimals));
  const label = `USDC→${tokenA.symbol}→${tokenB.symbol}→USDC`;
  const steps = [];
  let totalGas = 0;
  let totalLatency = 0;

  // Step 1: USDC → tokenA
  const q1 = await odosQuote(BASE_CHAIN_ID, USDC_BASE.address, usdcAmount, tokenA.address);
  await new Promise(r => setTimeout(r, CALL_DELAY_MS));
  if (!q1.ok) return { label, ok: false, error: `step1: ${q1.error}` };
  steps.push({ step: "USDC→" + tokenA.symbol, outAmount: q1.outAmount, gasUsd: q1.gasUsd, impact: q1.impact });
  totalGas += q1.gasUsd;
  totalLatency += q1.latencyMs;

  // Step 2: tokenA → tokenB
  const q2 = await odosQuote(BASE_CHAIN_ID, tokenA.address, q1.outAmount, tokenB.address);
  await new Promise(r => setTimeout(r, CALL_DELAY_MS));
  if (!q2.ok) return { label, ok: false, error: `step2: ${q2.error}` };
  steps.push({ step: tokenA.symbol + "→" + tokenB.symbol, outAmount: q2.outAmount, gasUsd: q2.gasUsd, impact: q2.impact });
  totalGas += q2.gasUsd;
  totalLatency += q2.latencyMs;

  // Step 3: tokenB → USDC
  const q3 = await odosQuote(BASE_CHAIN_ID, tokenB.address, q2.outAmount, USDC_BASE.address);
  if (!q3.ok) return { label, ok: false, error: `step3: ${q3.error}` };
  steps.push({ step: tokenB.symbol + "→USDC", outAmount: q3.outAmount, gasUsd: q3.gasUsd, impact: q3.impact });
  totalGas += q3.gasUsd;
  totalLatency += q3.latencyMs;

  const finalUsdc = Number(q3.outAmount) / 10 ** USDC_BASE.decimals;
  const grossProfit = finalUsdc - amountUsd;
  const netProfit = grossProfit - totalGas;
  const netPct = (netProfit / amountUsd) * 100;

  return {
    label,
    ok: true,
    startUsdc: amountUsd,
    endUsdc: +finalUsdc.toFixed(6),
    grossProfit: +grossProfit.toFixed(6),
    totalGas: +totalGas.toFixed(6),
    netProfit: +netProfit.toFixed(6),
    netPct: +netPct.toFixed(4),
    profitable: netProfit > 0,
    meetsPolicy: netPct >= 0.5,
    steps,
    totalLatencyMs: totalLatency,
  };
}

function parseArgs(argv) {
  const kv = Object.fromEntries(argv.filter(a => a.includes("=")).map(a => a.split("=")));
  const flags = new Set(argv.filter(a => !a.includes("=")));
  return {
    amount: parseFloat(kv["--amount"] || "250"),
    json: flags.has("--json"),
    allAmounts: flags.has("--sweep"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const amounts = args.allAmounts ? [50, 100, 150, 200, 250, 300] : [args.amount];
  const allResults = [];

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║     Triangular Arb Simulator — Base BTC Tokens      ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  for (const amount of amounts) {
    console.log(`── $${amount} USDC round-trips ──────────────────────────`);
    const results = [];
    const tokens = BASE_BTC_TOKENS;

    for (let i = 0; i < tokens.length; i++) {
      for (let j = 0; j < tokens.length; j++) {
        if (i === j) continue;
        const result = await simulateTriangle(amount, tokens[i], tokens[j]);
        results.push(result);
        await new Promise(r => setTimeout(r, CALL_DELAY_MS));

        if (result.ok) {
          const sign = result.netProfit >= 0 ? "+" : "";
          const flag = result.meetsPolicy ? " ★ MEETS POLICY" : result.profitable ? " ✓" : "";
          console.log(`  ${result.label.padEnd(28)} $${amount} → $${result.endUsdc.toFixed(2)}  net=${sign}$${result.netProfit.toFixed(4)} (${sign}${result.netPct.toFixed(3)}%)  gas=$${result.totalGas.toFixed(4)}${flag}`);
        } else {
          console.log(`  ${result.label.padEnd(28)} FAILED: ${result.error}`);
        }
      }
    }

    const profitable = results.filter(r => r.ok && r.profitable);
    const best = results.filter(r => r.ok).sort((a, b) => b.netPct - a.netPct)[0];
    console.log(`  ── ${results.filter(r => r.ok).length} routes tested, ${profitable.length} profitable`);
    if (best) console.log(`  ── best: ${best.label} at ${best.netPct >= 0 ? "+" : ""}${best.netPct.toFixed(4)}%\n`);

    allResults.push({ amountUsd: amount, results, profitable: profitable.length, best: best?.label || null, bestPct: best?.netPct || null });
  }

  // Save results
  await mkdir(DATA_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    chain: "base",
    chainId: BASE_CHAIN_ID,
    tokens: BASE_BTC_TOKENS.map(t => t.symbol),
    policyMinPct: 0.5,
    sweeps: allResults,
  };
  await writeFile(join(DATA_DIR, "triangular-arb-sim.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Results saved to data/triangular-arb-sim.json`);

  if (args.json) console.log(JSON.stringify(report, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
