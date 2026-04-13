#!/usr/bin/env node

/**
 * Triangular Arb Trigger — execution pipeline for Base BTC derivative arb.
 *
 * Monitors triangular spreads via Odos SOR, assembles real calldata for
 * profitable routes, and (in dry-run mode) simulates the flash loan arb
 * via `cast call` against a Base fork.
 *
 * DEFAULT MODE IS DRY-RUN.  Private keys never touch this process.
 * Live execution is delegated to an external signer process.
 *
 * Usage:
 *   node src/cli/trigger-triangular-arb.mjs                                    # dry-run monitor
 *   node src/cli/trigger-triangular-arb.mjs --capital=1000 --min-profit=0.30   # custom params
 *   node src/cli/trigger-triangular-arb.mjs --once                             # single check
 *   node src/cli/trigger-triangular-arb.mjs --simulate                         # fork simulate (cast call)
 *
 * Outputs:
 *   data/triangular-trigger-log.jsonl  — append-only trigger log
 */

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { canaryCheck, recordTradeResult } from "../risk/canary-guard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");

const ODOS_API = "https://api.odos.xyz";
const BASE_CHAIN_ID = 8453;
const CALL_DELAY_MS = 2000;
const FLASH_FEE_PCT = 0.05; // Aave V3 flash loan fee

const USDC = { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 };
const BTC_TOKENS = [
  { symbol: "LBTC",  address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8 },
  { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
  { symbol: "tBTC",  address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", decimals: 18 },
];
const BTC_SYMBOLS = BTC_TOKENS.map(t => t.symbol);

// ── CLI arg parsing ────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = new Set(argv.filter(a => a.startsWith("--") && !a.includes("=")));
  const kv = Object.fromEntries(
    argv.filter(a => a.startsWith("--") && a.includes("=")).map(a => {
      const [key, ...rest] = a.slice(2).split("=");
      return [key, rest.join("=")];
    })
  );
  return {
    capital:    parseFloat(kv["capital"] || "1000"),
    flashFeePct: kv["flash-fee"] !== undefined ? parseFloat(kv["flash-fee"]) : FLASH_FEE_PCT,
    minProfit:  parseFloat(kv["min-profit"] || "0.30"),
    interval:   parseInt(kv["interval"] || "60", 10),
    contract:   kv["contract"] || process.env.FLASH_ARB_CONTRACT || null,
    rpcUrl:     kv["rpc-url"] || process.env.BASE_RPC_URL || "https://mainnet.base.org",
    once:       flags.has("--once"),
    simulate:   flags.has("--simulate"),
    live:       flags.has("--live"),
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function round6(n) { return Math.round(n * 1e6) / 1e6; }
function round4(n) { return Math.round(n * 1e4) / 1e4; }
function ts() { return new Date().toISOString().slice(11, 19); }

function fmtUsd(n) {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

function fmtPct(n) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}%`;
}

// ── Emergency stop check ───────────────────────────────────────────

async function isEmergencyStopped() {
  try {
    await access(config.emergencyStopFlagPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ── Odos quote (returns pathId for subsequent assemble) ────────────

async function odosQuote(inputAddr, inputAmount, outputAddr, userAddr) {
  const body = {
    chainId: BASE_CHAIN_ID,
    inputTokens: [{ tokenAddress: inputAddr, amount: String(inputAmount) }],
    outputTokens: [{ tokenAddress: outputAddr, proportion: 1 }],
    userAddr: userAddr || "0x0000000000000000000000000000000000000001",
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
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, latencyMs };
  const data = await r.json();
  if (!data.outAmounts?.[0]) return { ok: false, error: "no output", latencyMs };
  return {
    ok: true,
    pathId: data.pathId,
    outAmount: data.outAmounts[0],
    gasUsd: data.gasEstimateValue ?? 0,
    impact: data.priceImpact ?? 0,
    latencyMs,
  };
}

// ── Odos assemble — turns pathId into real calldata ────────────────

async function odosAssemble(pathId, userAddr) {
  const body = { userAddr, pathId };
  const start = Date.now();
  const r = await fetch(`${ODOS_API}/sor/assemble`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, latencyMs };
  const data = await r.json();
  if (!data.transaction?.data) return { ok: false, error: "no calldata in response", latencyMs };
  return {
    ok: true,
    to: data.transaction.to,
    data: data.transaction.data,
    value: data.transaction.value || "0",
    gasLimit: data.transaction.gas || data.transaction.gasLimit || null,
    latencyMs,
  };
}

// ── Fork simulation via cast call ──────────────────────────────────

function castCall(contractAddr, sig, callArgs, rpcUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      "call", contractAddr, sig, ...callArgs,
      "--rpc-url", rpcUrl,
    ];
    execFile("cast", args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// ── Single triangular route quote ──────────────────────────────────

async function quoteTriangularRoute(aSymbol, bSymbol, capital, flashFeePct, userAddr) {
  const tokenA = BTC_TOKENS.find(t => t.symbol === aSymbol);
  const tokenB = BTC_TOKENS.find(t => t.symbol === bSymbol);
  const label = `USDC→${aSymbol}→${bSymbol}→USDC`;
  const usdcRaw = String(Math.round(capital * 10 ** USDC.decimals));

  // Leg 1: USDC → A
  const q1 = await odosQuote(USDC.address, usdcRaw, tokenA.address, userAddr);
  if (!q1.ok) return { label, ok: false, error: `leg1: ${q1.error}` };
  await sleep(CALL_DELAY_MS);

  // Leg 2: A → B
  const q2 = await odosQuote(tokenA.address, q1.outAmount, tokenB.address, userAddr);
  if (!q2.ok) return { label, ok: false, error: `leg2: ${q2.error}` };
  await sleep(CALL_DELAY_MS);

  // Leg 3: B → USDC
  const q3 = await odosQuote(tokenB.address, q2.outAmount, USDC.address, userAddr);
  if (!q3.ok) return { label, ok: false, error: `leg3: ${q3.error}` };

  const endUsdc = parseInt(q3.outAmount) / 10 ** USDC.decimals;
  const grossProfit = endUsdc - capital;
  const totalGas = q1.gasUsd + q2.gasUsd + q3.gasUsd;
  const flashFeeUsd = capital * flashFeePct / 100;
  const netProfit = grossProfit - totalGas - flashFeeUsd;
  const spreadPct = (grossProfit / capital) * 100;
  const netPct = (netProfit / capital) * 100;
  const totalLatencyMs = q1.latencyMs + q2.latencyMs + q3.latencyMs;

  return {
    label, ok: true,
    aSymbol, bSymbol,
    tokenA, tokenB,
    startUsdc: capital,
    endUsdc: round6(endUsdc),
    grossProfit: round6(grossProfit),
    totalGas: round6(totalGas),
    flashFeeUsd: round6(flashFeeUsd),
    netProfit: round6(netProfit),
    spreadPct: round4(spreadPct),
    netPct: round4(netPct),
    totalLatencyMs,
    legs: {
      q1: { pathId: q1.pathId, outAmount: q1.outAmount, gasUsd: q1.gasUsd, latencyMs: q1.latencyMs },
      q2: { pathId: q2.pathId, outAmount: q2.outAmount, gasUsd: q2.gasUsd, latencyMs: q2.latencyMs },
      q3: { pathId: q3.pathId, outAmount: q3.outAmount, gasUsd: q3.gasUsd, latencyMs: q3.latencyMs },
    },
  };
}

// ── Assemble all 3 legs for a profitable route ─────────────────────

async function assembleRoute(route, contractAddr) {
  const userAddr = contractAddr || "0x0000000000000000000000000000000000000001";
  const assembled = {};

  for (const [legKey, legLabel] of [["q1", "Leg 1"], ["q2", "Leg 2"], ["q3", "Leg 3"]]) {
    const leg = route.legs[legKey];
    if (!leg.pathId) {
      return { ok: false, error: `${legLabel}: missing pathId` };
    }
    const a = await odosAssemble(leg.pathId, userAddr);
    if (!a.ok) {
      return { ok: false, error: `${legLabel}: assemble failed — ${a.error}` };
    }
    assembled[legKey] = a;
    console.log(`           ${legLabel}: ${route.label.split("→").slice(legKey === "q1" ? 0 : legKey === "q2" ? 1 : 2, legKey === "q1" ? 2 : legKey === "q2" ? 3 : 4).join("→")}  pathId=${leg.pathId.slice(0, 8)}…  calldata=${a.data.slice(0, 8)}…`);
    await sleep(CALL_DELAY_MS);
  }

  return { ok: true, assembled };
}

// ── Simulate via cast call on Base fork ────────────────────────────

async function simulateArb(route, assembled, contractAddr, rpcUrl) {
  if (!contractAddr) {
    return { ok: false, error: "no contract address (use --contract or FLASH_ARB_CONTRACT)" };
  }

  const usdcRaw = String(Math.round(route.startUsdc * 10 ** USDC.decimals));
  const sig = "executeTriangularArb(uint256,address,address,bytes,bytes,bytes)";
  const callArgs = [
    usdcRaw,
    route.tokenA.address,
    route.tokenB.address,
    assembled.q1.data,
    assembled.q2.data,
    assembled.q3.data,
  ];

  try {
    const result = await castCall(contractAddr, sig, callArgs, rpcUrl);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Full cycle: quote → filter → assemble → simulate → log ────────

async function runCycle(args, store, session) {
  const cycleStart = Date.now();
  const contractAddr = args.contract;
  const userAddr = contractAddr || "0x0000000000000000000000000000000000000001";

  console.log(`\n[${ts()}] Scanning 6 routes...`);

  // Phase 1: Quote all 6 triangular permutations
  const routes = [];
  for (let i = 0; i < BTC_SYMBOLS.length; i++) {
    for (let j = 0; j < BTC_SYMBOLS.length; j++) {
      if (i === j) continue;
      const r = await quoteTriangularRoute(BTC_SYMBOLS[i], BTC_SYMBOLS[j], args.capital, args.flashFeePct, userAddr);
      routes.push(r);
      await sleep(CALL_DELAY_MS);
    }
  }

  // Phase 2: Filter profitable routes
  const profitable = routes
    .filter(r => r.ok && r.netProfit >= args.minProfit)
    .sort((a, b) => b.netProfit - a.netProfit);

  // Log all routes summary
  for (const r of routes) {
    if (!r.ok) {
      console.log(`[${ts()}] ❌ ${r.label}: ${r.error}`);
      continue;
    }
    const flag = r.netProfit >= args.minProfit ? "✅" : r.netProfit > 0 ? "🟡" : "⚪";
    console.log(`[${ts()}] ${flag} ${r.label.padEnd(28)} Spread: ${fmtPct(r.spreadPct)} | Net: ${fmtUsd(r.netProfit)} | Gas: ${fmtUsd(r.totalGas)}`);
  }

  if (profitable.length === 0) {
    console.log(`[${ts()}] No routes above ${fmtUsd(args.minProfit)} threshold.`);
    await store.append("triangular-trigger-log", {
      observedAt: new Date().toISOString(),
      cycle: session.cycles,
      phase: "quote",
      capital: args.capital,
      routesScanned: routes.length,
      routesOk: routes.filter(r => r.ok).length,
      profitableCount: 0,
      bestNet: routes.filter(r => r.ok).sort((a, b) => b.netProfit - a.netProfit)[0]?.netProfit ?? null,
      action: "none",
    });
    return { cycleDurationMs: Date.now() - cycleStart };
  }

  // Phase 3: Assemble calldata for the best route
  const best = profitable[0];
  console.log(`\n[${ts()}] ✅ OPPORTUNITY: ${best.label}`);
  console.log(`           Spread: ${fmtPct(best.spreadPct)} | Net: ${fmtUsd(best.netProfit)} | Gas: ${fmtUsd(best.totalGas)}`);
  console.log(`\n[${ts()}] 📦 Assembling Odos calldata...`);

  const asm = await assembleRoute(best, contractAddr);

  if (!asm.ok) {
    console.log(`[${ts()}] ❌ Assemble failed: ${asm.error}`);
    await store.append("triangular-trigger-log", {
      observedAt: new Date().toISOString(),
      cycle: session.cycles,
      phase: "assemble",
      route: best.label,
      netProfit: best.netProfit,
      netPct: best.netPct,
      error: asm.error,
      action: "assemble_failed",
    });
    return { cycleDurationMs: Date.now() - cycleStart };
  }

  // Phase 4: Simulate or dry-run
  let simResult = null;
  if (args.simulate && contractAddr) {
    console.log(`\n[${ts()}] 🔬 Simulating via cast call...`);
    console.log(`           Contract: ${contractAddr}`);
    simResult = await simulateArb(best, asm.assembled, contractAddr, args.rpcUrl);
    if (simResult.ok) {
      console.log(`           ✅ Simulation succeeded: ${simResult.result}`);
    } else {
      console.log(`           ❌ Simulation failed: ${simResult.error}`);
    }
  } else {
    // Dry-run: just show what would be executed
    const usdcRaw = String(Math.round(best.startUsdc * 10 ** USDC.decimals));
    const gasEstimate = "450,000";
    console.log(`\n[${ts()}] 🔬 DRY RUN — would execute:`);
    console.log(`           Contract: ${contractAddr || "(not set — use --contract)"}`);
    console.log(`           Function: executeTriangularArb(${usdcRaw}, ${best.tokenA.address}, ${best.tokenB.address}, ${asm.assembled.q1.data.slice(0, 8)}…, ${asm.assembled.q2.data.slice(0, 8)}…, ${asm.assembled.q3.data.slice(0, 8)}…)`);
    console.log(`           Estimated gas: ${gasEstimate}`);
  }

  // Phase 5: Log
  const logRecord = {
    observedAt: new Date().toISOString(),
    cycle: session.cycles,
    phase: simResult ? "simulate" : "dry-run",
    capital: args.capital,
    route: best.label,
    aSymbol: best.aSymbol,
    bSymbol: best.bSymbol,
    spreadPct: best.spreadPct,
    grossProfit: best.grossProfit,
    totalGas: best.totalGas,
    flashFeeUsd: best.flashFeeUsd,
    netProfit: best.netProfit,
    netPct: best.netPct,
    totalLatencyMs: best.totalLatencyMs,
    assembled: {
      leg1: { to: asm.assembled.q1.to, dataLen: asm.assembled.q1.data.length, gasLimit: asm.assembled.q1.gasLimit },
      leg2: { to: asm.assembled.q2.to, dataLen: asm.assembled.q2.data.length, gasLimit: asm.assembled.q2.gasLimit },
      leg3: { to: asm.assembled.q3.to, dataLen: asm.assembled.q3.data.length, gasLimit: asm.assembled.q3.gasLimit },
    },
    simulation: simResult ? { ok: simResult.ok, error: simResult.error || null } : null,
    action: args.live ? "BLOCKED" : "dry-run",
  };

  await store.append("triangular-trigger-log", logRecord);
  console.log(`\n[${ts()}] 📝 Logged to data/triangular-trigger-log.jsonl`);

  // Live mode gate — always blocked unless architecture is explicitly reviewed
  if (args.live) {
    console.log(`\n[${ts()}] 🚫 LIVE MODE BLOCKED — liveTrading=BLOCKED per safety policy.`);
    console.log(`           Live execution requires explicit architecture review.`);
    console.log(`           The assembled calldata has been logged for external review.`);
  }

  // Record result in canary session log
  await recordTradeResult({
    profit: best.netProfit,
    route: best.label,
    txHash: null,
    dryRun: !args.live,
  });

  session.triggerCount++;
  return { cycleDurationMs: Date.now() - cycleStart };
}

// ── Main loop ──────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new JsonlStore(DATA_DIR);

  // Safety: check emergency stop before anything
  if (await isEmergencyStopped()) {
    console.error("🛑 Emergency stop is active. Exiting.");
    process.exitCode = 1;
    return;
  }

  const mode = args.live ? "BLOCKED" : args.simulate ? "simulate" : "dry-run";
  const canaryMode = args.live ? "canary" : "normal";

  // Canary guard pre-flight check
  {
    const guard = await canaryCheck({ mode: canaryMode, tradeProfit: 0, dryRun: !args.live });
    if (!guard.allowed) {
      console.error(`🛑 Canary guard blocked startup: ${guard.reason} (daily P&L: $${guard.dailyPnl.toFixed(2)}, consecutive fails: ${guard.consecFails})`);
      process.exitCode = 1;
      return;
    }
  }

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log(`║  🎯 Triangular Arb Trigger — ${mode.toUpperCase().padEnd(10)}                    ║`);
  console.log(`║  Capital: $${String(args.capital.toLocaleString()).padEnd(7)} | Min Profit: ${fmtUsd(args.minProfit)} | Mode: ${mode.padEnd(10)} ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");

  if (args.contract) {
    console.log(`  Contract: ${args.contract}`);
  } else {
    console.log("  Contract: (not set — use --contract=0x… or FLASH_ARB_CONTRACT env)");
  }
  if (args.simulate) {
    console.log(`  RPC: ${args.rpcUrl}`);
  }
  console.log("");

  const session = { startedAt: new Date(), cycles: 0, triggerCount: 0 };

  while (true) {
    // Check emergency stop each cycle
    if (await isEmergencyStopped()) {
      console.error(`\n[${ts()}] 🛑 Emergency stop detected. Halting.`);
      break;
    }

    session.cycles++;

    // Per-cycle canary guard check (tradeProfit=0 = pre-check, profit enforced on-chain)
    {
      const guard = await canaryCheck({ mode: canaryMode, tradeProfit: 0, dryRun: !args.live });
      if (!guard.allowed) {
        console.error(`\n[${ts()}] 🛑 Canary guard halted: ${guard.reason} (daily P&L: $${guard.dailyPnl.toFixed(2)}, consecutive fails: ${guard.consecFails})`);
        break;
      }
    }

    try {
      const { cycleDurationMs } = await runCycle(args, store, session);
      if (args.once) break;

      const waitMs = Math.max(0, args.interval * 1000 - cycleDurationMs);
      console.log(`\n[${ts()}] Next scan in ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
    } catch (err) {
      console.error(`[${ts()}] ✗ Cycle error: ${err.message}`);
      await store.append("triangular-trigger-log", {
        observedAt: new Date().toISOString(),
        cycle: session.cycles,
        phase: "error",
        error: err.message,
      });
      if (args.once) break;
      await sleep(args.interval * 1000);
    }
  }

  console.log(`\nSession complete — ${session.cycles} cycles, ${session.triggerCount} triggers.`);
}

main().catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
