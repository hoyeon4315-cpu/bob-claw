#!/usr/bin/env node

/**
 * Flash Loan Arb Dry-Run — simulates flash loan arb across Base BTC derivatives.
 *
 * Supports all pairwise routes: LBTC, cbBTC, tBTC
 * Also supports USDC-denominated triangular routes (USDC → A → B → USDC)
 *
 * Usage:
 *   node src/cli/flash-arb-dryrun.mjs                              # scan all pairs
 *   node src/cli/flash-arb-dryrun.mjs --pair=LBTC-cbBTC            # specific pair
 *   node src/cli/flash-arb-dryrun.mjs --triangular --usdc=250      # USDC triangular
 *   node src/cli/flash-arb-dryrun.mjs --amount=0.005 --min-profit=0.10
 */

const ODOS_API = "https://api.odos.xyz";
const BASE_CHAIN = 8453;
const FLASH_FEE_BPS = 5; // Aave V3 = 0.05%
const CALL_DELAY_MS = 2000;

const TOKENS = {
  LBTC:  { address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8 },
  cbBTC: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
  tBTC:  { address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", decimals: 18 },
  USDC:  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
};
const BTC_SYMBOLS = ["LBTC", "cbBTC", "tBTC"];

function parseArgs(argv) {
  const flags = new Set(argv.filter(a => a.startsWith("--") && !a.includes("=")));
  const kv = Object.fromEntries(
    argv.filter(a => a.includes("=")).map(a => { const [k, ...v] = a.split("="); return [k, v.join("=")]; })
  );
  return {
    amount: parseFloat(kv["--amount"] || "0.005"),
    minProfitPct: parseFloat(kv["--min-profit"] || "0.10"),
    pair: kv["--pair"] || null,
    triangular: flags.has("--triangular"),
    usdc: parseFloat(kv["--usdc"] || "250"),
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function odosQuote(fromToken, toToken, amountRaw) {
  const body = {
    chainId: BASE_CHAIN,
    inputTokens: [{ tokenAddress: fromToken, amount: String(amountRaw) }],
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

async function getBtcPrice() {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return parseFloat(d.price) || 71500;
  } catch { return 71500; }
}

async function runPairArb(fromSymbol, toSymbol, amountBtc, minProfitPct, btcUsd) {
  const from = TOKENS[fromSymbol];
  const to = TOKENS[toSymbol];
  const amountRaw = BigInt(Math.round(amountBtc * 10 ** from.decimals));

  console.log(`\n── ${fromSymbol} → ${toSymbol} → ${fromSymbol} ──`);

  // Leg 1: from → to
  const q1 = await odosQuote(from.address, to.address, amountRaw.toString());
  if (!q1.pathId) { console.log(`  ✗ Leg 1 failed: ${q1.detail || "unknown"}`); return null; }
  const midRaw = q1.outAmounts[0];
  const midAmount = Number(BigInt(midRaw)) / 10 ** to.decimals;
  console.log(`  ${amountBtc} ${fromSymbol} → ${midAmount.toFixed(8)} ${toSymbol} [${q1.latencyMs}ms] gas=$${(q1.gasEstimateValue||0).toFixed(4)}`);
  await sleep(CALL_DELAY_MS);

  // Leg 2: to → from
  const q2 = await odosQuote(to.address, from.address, midRaw);
  if (!q2.pathId) { console.log(`  ✗ Leg 2 failed: ${q2.detail || "unknown"}`); return null; }
  const backAmount = Number(BigInt(q2.outAmounts[0])) / 10 ** from.decimals;
  console.log(`  ${midAmount.toFixed(8)} ${toSymbol} → ${backAmount.toFixed(8)} ${fromSymbol} [${q2.latencyMs}ms] gas=$${(q2.gasEstimateValue||0).toFixed(4)}`);

  const flashFee = amountBtc * FLASH_FEE_BPS / 10000;
  const grossProfit = backAmount - amountBtc;
  const netProfit = backAmount - amountBtc - flashFee;
  const netProfitPct = (netProfit / amountBtc) * 100;
  const totalGasUsd = (q1.gasEstimateValue || 0) + (q2.gasEstimateValue || 0);
  const netUsd = netProfit * btcUsd;

  const flag = netProfitPct >= minProfitPct ? "✅" : netProfit > 0 ? "🟡" : "❌";
  console.log(`  ${flag} Net: ${netProfit >= 0 ? "+" : ""}${netProfitPct.toFixed(4)}% ($${netUsd.toFixed(4)}) | flash fee: ${(flashFee*btcUsd).toFixed(4)} | gas: $${totalGasUsd.toFixed(4)}`);

  return { pair: `${fromSymbol}-${toSymbol}`, netProfitPct, netUsd, totalGasUsd, profitable: netProfit > 0, meetsThreshold: netProfitPct >= minProfitPct };
}

async function runTriangularArb(fromSymbol, toSymbol, usdcAmount, minProfitPct) {
  const usdc = TOKENS.USDC;
  const tokenA = TOKENS[fromSymbol];
  const tokenB = TOKENS[toSymbol];
  const label = `USDC→${fromSymbol}→${toSymbol}→USDC`;
  const usdcRaw = String(Math.round(usdcAmount * 10 ** usdc.decimals));

  // Leg 1: USDC → A
  const q1 = await odosQuote(usdc.address, tokenA.address, usdcRaw);
  if (!q1.pathId) { console.log(`  ✗ ${label} leg1 failed`); return null; }
  await sleep(CALL_DELAY_MS);

  // Leg 2: A → B
  const q2 = await odosQuote(tokenA.address, tokenB.address, q1.outAmounts[0]);
  if (!q2.pathId) { console.log(`  ✗ ${label} leg2 failed`); return null; }
  await sleep(CALL_DELAY_MS);

  // Leg 3: B → USDC
  const q3 = await odosQuote(tokenB.address, usdc.address, q2.outAmounts[0]);
  if (!q3.pathId) { console.log(`  ✗ ${label} leg3 failed`); return null; }

  const endUsdc = parseInt(q3.outAmounts[0]) / 10 ** usdc.decimals;
  const totalGas = (q1.gasEstimateValue||0) + (q2.gasEstimateValue||0) + (q3.gasEstimateValue||0);
  const grossProfit = endUsdc - usdcAmount;
  const netProfit = grossProfit - totalGas;
  const flashFee = usdcAmount * FLASH_FEE_BPS / 10000;
  const netAfterFlash = netProfit - flashFee;
  const netPct = (netProfit / usdcAmount) * 100;
  const netAfterFlashPct = (netAfterFlash / usdcAmount) * 100;
  const latency = q1.latencyMs + q2.latencyMs + q3.latencyMs;

  const flag = netAfterFlashPct >= minProfitPct ? "✅" : netAfterFlash > 0 ? "🟡" : netProfit > 0 ? "⚪" : "❌";
  console.log(`  ${flag} ${label.padEnd(28)} net=${netPct >= 0 ? "+" : ""}${netPct.toFixed(4)}%  flash=${netAfterFlashPct >= 0 ? "+" : ""}${netAfterFlashPct.toFixed(4)}%  $${netAfterFlash.toFixed(4)}  gas=$${totalGas.toFixed(4)}  [${latency}ms]`);

  return { label, netPct, netAfterFlashPct, netAfterFlashUsd: netAfterFlash, totalGas, latency, profitable: netProfit > 0, profitableAfterFlash: netAfterFlash > 0, meetsThreshold: netAfterFlashPct >= minProfitPct };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const btcUsd = await getBtcPrice();

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  Flash Loan Arb Dry-Run — All Pairs                  ║`);
  console.log(`║  BTC: $${btcUsd.toLocaleString()} | Min profit: ${args.minProfitPct}% | Flash fee: 0.05%  ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);

  const results = [];

  if (args.triangular || !args.pair) {
    // Triangular USDC routes
    console.log(`\n═══ Triangular Routes ($${args.usdc} USDC) ═══`);
    for (let i = 0; i < BTC_SYMBOLS.length; i++) {
      for (let j = 0; j < BTC_SYMBOLS.length; j++) {
        if (i === j) continue;
        const r = await runTriangularArb(BTC_SYMBOLS[i], BTC_SYMBOLS[j], args.usdc, args.minProfitPct);
        if (r) results.push(r);
        await sleep(CALL_DELAY_MS);
      }
    }
  }

  if (!args.triangular) {
    // Direct BTC↔BTC pair routes
    console.log(`\n═══ Direct Pair Routes (${args.amount} BTC) ═══`);
    const pairs = args.pair
      ? [args.pair.split("-")]
      : BTC_SYMBOLS.flatMap((a, i) => BTC_SYMBOLS.slice(i + 1).map(b => [a, b]));

    for (const [a, b] of pairs) {
      const r1 = await runPairArb(a, b, args.amount, args.minProfitPct, btcUsd);
      if (r1) results.push(r1);
      await sleep(CALL_DELAY_MS);
      const r2 = await runPairArb(b, a, args.amount, args.minProfitPct, btcUsd);
      if (r2) results.push(r2);
      await sleep(CALL_DELAY_MS);
    }
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  const profitable = results.filter(r => r.profitable || r.profitableAfterFlash);
  const meets = results.filter(r => r.meetsThreshold);
  console.log(`  Tested: ${results.length} routes`);
  console.log(`  Profitable (after flash): ${profitable.length}`);
  console.log(`  Meets ${args.minProfitPct}% threshold: ${meets.length}`);
  if (profitable.length) {
    const best = profitable.sort((a, b) => (b.netAfterFlashPct ?? b.netProfitPct) - (a.netAfterFlashPct ?? a.netProfitPct))[0];
    console.log(`  Best: ${best.label || best.pair} at ${(best.netAfterFlashPct ?? best.netProfitPct).toFixed(4)}%`);
  }
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(err => { console.error(err); process.exit(1); });
