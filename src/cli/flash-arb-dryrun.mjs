#!/usr/bin/env node

/**
 * Flash Loan Arb Dry-Run — simulates the full flash loan arb pipeline
 *
 * 1. Check LBTC/cbBTC spread
 * 2. Build Odos swap calldata (LBTC→cbBTC, cbBTC→LBTC)
 * 3. Calculate net profit after flash loan fee (0.05%)
 * 4. Print go/no-go decision
 *
 * Usage:
 *   node src/cli/flash-arb-dryrun.mjs [--amount=0.005] [--min-profit=0.30]
 */

const ODOS_API = "https://api.odos.xyz";
const BASE_CHAIN = 8453;
const LBTC  = "0xecAc9C5F704e954931349Da37F60E39f515c11c1";
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const FLASH_FEE_BPS = 5; // Aave V3 = 0.05%

function parseArgs(argv) {
  const kv = Object.fromEntries(
    argv.filter(a => a.includes("=")).map(a => a.split("="))
  );
  return {
    amount: parseFloat(kv["--amount"] || "0.005"),
    minProfitPct: parseFloat(kv["--min-profit"] || "0.30"),
  };
}

async function odosQuote(fromToken, toToken, amount, decimals) {
  const body = {
    chainId: BASE_CHAIN,
    inputTokens: [{ tokenAddress: fromToken, amount: String(Math.round(amount * 10 ** decimals)) }],
    outputTokens: [{ tokenAddress: toToken, proportion: 1 }],
    userAddr: "0x0000000000000000000000000000000000000001",
    slippageLimitPercent: 0.3,
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
  const data = await r.json();
  return { ...data, latencyMs: Date.now() - start };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const amountBtc = args.amount;
  const amountRaw = Math.round(amountBtc * 1e8); // LBTC has 8 decimals

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Flash Loan Arb Dry-Run                      ║`);
  console.log(`║  Amount: ${amountBtc} LBTC | Min profit: ${args.minProfitPct}%  ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);

  // Step 1: Quote LBTC → cbBTC
  console.log("Step 1: LBTC → cbBTC quote...");
  const q1 = await odosQuote(LBTC, CBBTC, amountBtc, 8);
  if (!q1.pathId) {
    console.log("  ✗ Quote failed:", q1.detail || "unknown");
    return;
  }
  const cbbtcOut = parseInt(q1.outAmounts[0]) / 1e8;
  const swap1Rate = cbbtcOut / amountBtc;
  console.log(`  ✓ ${amountBtc} LBTC → ${cbbtcOut.toFixed(8)} cbBTC (rate: ${swap1Rate.toFixed(6)}) [${q1.latencyMs}ms]`);
  console.log(`    gas: $${(q1.gasEstimateValue || 0).toFixed(4)} | impact: ${(q1.priceImpact || 0).toFixed(4)}%`);

  // Step 2: Quote cbBTC → LBTC
  console.log("\nStep 2: cbBTC → LBTC quote...");
  const q2 = await odosQuote(CBBTC, LBTC, cbbtcOut, 8);
  if (!q2.pathId) {
    console.log("  ✗ Quote failed:", q2.detail || "unknown");
    return;
  }
  const lbtcBack = parseInt(q2.outAmounts[0]) / 1e8;
  const swap2Rate = lbtcBack / cbbtcOut;
  console.log(`  ✓ ${cbbtcOut.toFixed(8)} cbBTC → ${lbtcBack.toFixed(8)} LBTC (rate: ${swap2Rate.toFixed(6)}) [${q2.latencyMs}ms]`);
  console.log(`    gas: $${(q2.gasEstimateValue || 0).toFixed(4)} | impact: ${(q2.priceImpact || 0).toFixed(4)}%`);

  // Step 3: Calculate P&L
  const flashFee = amountBtc * FLASH_FEE_BPS / 10000;
  const totalOwed = amountBtc + flashFee;
  const grossProfit = lbtcBack - amountBtc;
  const netProfit = lbtcBack - totalOwed;
  const netProfitPct = (netProfit / amountBtc) * 100;
  const totalGasUsd = (q1.gasEstimateValue || 0) + (q2.gasEstimateValue || 0);

  // BTC price for USD conversion
  let btcUsd = 71500;
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    btcUsd = parseFloat(d.price) || btcUsd;
  } catch {}

  const netProfitUsd = netProfit * btcUsd;

  console.log("\n═══════════════════════════════════════════════");
  console.log("  FLASH LOAN ARB ANALYSIS");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Borrow:      ${amountBtc.toFixed(8)} LBTC`);
  console.log(`  Flash fee:   ${flashFee.toFixed(8)} LBTC (0.05%)`);
  console.log(`  Total owed:  ${totalOwed.toFixed(8)} LBTC`);
  console.log(`  Got back:    ${lbtcBack.toFixed(8)} LBTC`);
  console.log(`  Gross P&L:   ${grossProfit >= 0 ? "+" : ""}${grossProfit.toFixed(8)} LBTC (${((grossProfit/amountBtc)*100).toFixed(4)}%)`);
  console.log(`  Net P&L:     ${netProfit >= 0 ? "+" : ""}${netProfit.toFixed(8)} LBTC (${netProfitPct.toFixed(4)}%)`);
  console.log(`  Net USD:     $${netProfitUsd.toFixed(4)} (BTC=$${btcUsd.toLocaleString()})`);
  console.log(`  Gas cost:    $${totalGasUsd.toFixed(4)}`);
  console.log(`  Round-trip:  ${q1.latencyMs + q2.latencyMs}ms`);
  console.log("───────────────────────────────────────────────");

  const profitable = netProfitPct >= args.minProfitPct;
  if (profitable) {
    console.log(`  ✅ PROFITABLE — net ${netProfitPct.toFixed(3)}% ≥ ${args.minProfitPct}% threshold`);
  } else {
    console.log(`  ❌ NOT PROFITABLE — net ${netProfitPct.toFixed(3)}% < ${args.minProfitPct}% threshold`);
    const needed = args.minProfitPct - netProfitPct;
    console.log(`     Need ${needed.toFixed(3)}% more spread to break even.`);
  }
  console.log("═══════════════════════════════════════════════\n");
}

main().catch(err => { console.error(err); process.exit(1); });
