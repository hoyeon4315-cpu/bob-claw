#!/usr/bin/env node

/**
 * Triangular Spread Monitor — real-time alerting for Base BTC derivative arb.
 *
 * Continuously monitors LBTC/cbBTC/tBTC triangular spreads on Base via Odos
 * SOR API and alerts (console bell + JSONL log) when any route meets the
 * configured profit threshold.
 *
 * Usage:
 *   node src/cli/monitor-triangular-alerts.mjs                              # $1000, Aave 0.05%
 *   node src/cli/monitor-triangular-alerts.mjs --capital=300                # $300 capital
 *   node src/cli/monitor-triangular-alerts.mjs --capital=1000 --flash-fee=0 # Euler 0% flash
 *   node src/cli/monitor-triangular-alerts.mjs --min-profit=0.30            # custom min $
 *   node src/cli/monitor-triangular-alerts.mjs --interval=30                # 30s cycles
 *
 * Outputs:
 *   data/triangular-alerts.jsonl  — append-only alert log
 */

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { sendTelegramMessage } from "../notify/telegram.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");

const ODOS_API = "https://api.odos.xyz";
const BASE_CHAIN_ID = 8453;
const CALL_DELAY_MS = 2000;

const USDC = { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 };
const BTC_TOKENS = [
  { symbol: "LBTC",  address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8 },
  { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
  { symbol: "tBTC",  address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", decimals: 18 },
];
const BTC_SYMBOLS = BTC_TOKENS.map(t => t.symbol);

// ── CLI arg parsing ────────────────────────────────────────────────

function parseArgs(argv) {
  const kv = Object.fromEntries(
    argv.filter(a => a.startsWith("--") && a.includes("=")).map(a => {
      const [key, ...rest] = a.slice(2).split("=");
      return [key, rest.join("=")];
    })
  );
  const capital = parseFloat(kv["capital"] || "1000");
  const flashFeePct = kv["flash-fee"] !== undefined ? parseFloat(kv["flash-fee"]) : 0.05;
  const minProfit = parseFloat(kv["min-profit"] || "0.30");
  const interval = parseInt(kv["interval"] || "60", 10);
  return { capital, flashFeePct, minProfit, interval };
}

// ── Helpers ────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function round6(n) { return Math.round(n * 1e6) / 1e6; }
function round4(n) { return Math.round(n * 1e4) / 1e4; }

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtUsd(n) {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

function fmtPct(n) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}%`;
}

function flashLabel(pct) {
  if (pct === 0) return "0% (Euler/Balancer)";
  if (pct === 0.05) return "0.05% (Aave)";
  return `${pct}%`;
}

// ── Odos quote ─────────────────────────────────────────────────────

async function odosQuote(inputAddr, inputAmount, outputAddr) {
  const body = {
    chainId: BASE_CHAIN_ID,
    inputTokens: [{ tokenAddress: inputAddr, amount: String(inputAmount) }],
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
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, latencyMs };
  const data = await r.json();
  if (!data.outAmounts?.[0]) return { ok: false, error: "no output", latencyMs };
  return {
    ok: true,
    outAmount: data.outAmounts[0],
    gasUsd: data.gasEstimateValue ?? 0,
    impact: data.priceImpact ?? 0,
    latencyMs,
  };
}

// ── Single triangular route ────────────────────────────────────────

async function quoteTriangularRoute(aSymbol, bSymbol, capital, flashFeePct) {
  const tokenA = BTC_TOKENS.find(t => t.symbol === aSymbol);
  const tokenB = BTC_TOKENS.find(t => t.symbol === bSymbol);
  const label = `USDC→${aSymbol}→${bSymbol}→USDC`;
  const usdcRaw = String(Math.round(capital * 10 ** USDC.decimals));

  // Leg 1: USDC → A
  const q1 = await odosQuote(USDC.address, usdcRaw, tokenA.address);
  if (!q1.ok) return { label, ok: false, error: `leg1: ${q1.error}` };
  await sleep(CALL_DELAY_MS);

  // Leg 2: A → B
  const q2 = await odosQuote(tokenA.address, q1.outAmount, tokenB.address);
  if (!q2.ok) return { label, ok: false, error: `leg2: ${q2.error}` };
  await sleep(CALL_DELAY_MS);

  // Leg 3: B → USDC
  const q3 = await odosQuote(tokenB.address, q2.outAmount, USDC.address);
  if (!q3.ok) return { label, ok: false, error: `leg3: ${q3.error}` };

  const endUsdc = parseInt(q3.outAmount) / 10 ** USDC.decimals;
  const grossProfit = endUsdc - capital;
  const totalGas = (q1.gasUsd + q2.gasUsd + q3.gasUsd);
  const flashFeeUsd = capital * flashFeePct / 100;
  const netProfit = grossProfit - totalGas - flashFeeUsd;
  const spreadPct = (grossProfit / capital) * 100;
  const netPct = (netProfit / capital) * 100;
  const totalLatencyMs = q1.latencyMs + q2.latencyMs + q3.latencyMs;

  return {
    label,
    ok: true,
    startUsdc: capital,
    endUsdc: round6(endUsdc),
    grossProfit: round6(grossProfit),
    totalGas: round6(totalGas),
    flashFeeUsd: round6(flashFeeUsd),
    netProfit: round6(netProfit),
    spreadPct: round4(spreadPct),
    netPct: round4(netPct),
    totalLatencyMs,
  };
}

// ── Full cycle across all 6 permutations ───────────────────────────

async function runCycle(capital, flashFeePct) {
  const results = [];
  for (let i = 0; i < BTC_SYMBOLS.length; i++) {
    for (let j = 0; j < BTC_SYMBOLS.length; j++) {
      if (i === j) continue;
      const r = await quoteTriangularRoute(BTC_SYMBOLS[i], BTC_SYMBOLS[j], capital, flashFeePct);
      results.push(r);
      await sleep(CALL_DELAY_MS);
    }
  }
  return results;
}

// ── Terminal dashboard ─────────────────────────────────────────────

function renderDashboard(args, session, routes, cycleDurationMs) {
  const lines = [];
  const now = new Date();
  const running = fmtDuration(now - session.startedAt);
  const nextIn = Math.max(0, args.interval - Math.floor(cycleDurationMs / 1000));

  lines.push("╔════════════════════════════════════════════════════════════════╗");
  lines.push(`║  🔍 Triangular Spread Monitor — Base BTC Derivatives          ║`);
  lines.push(`║  Capital: $${args.capital.toLocaleString()} | Flash Fee: ${flashLabel(args.flashFeePct).padEnd(20)} ║`);
  lines.push(`║  Min Profit: ${fmtUsd(args.minProfit)} | Running: ${running.padEnd(8)} | Cycles: ${String(session.cycles).padEnd(4)}  ║`);
  lines.push(`║  Alerts: ${String(session.alertCount).padEnd(52)}║`);
  lines.push("╚════════════════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push("  Route                         Spread    Profit    Gas      Net       Status");
  lines.push("  ─────────────────────────────────────────────────────────────────────────────");

  for (const r of routes) {
    if (!r.ok) {
      lines.push(`  ${r.label.padEnd(30)}  ${("err: " + r.error).padEnd(50)}`);
      continue;
    }
    let status;
    if (r.netProfit >= args.minProfit) status = "✅ ALERT!";
    else if (r.netProfit >= args.minProfit * 0.5) status = "🟡 close";
    else status = "⚪ below";

    lines.push(
      `  ${r.label.padEnd(30)} ${fmtPct(r.spreadPct).padStart(8)}  ` +
      `${fmtUsd(r.grossProfit).padStart(8)}  ` +
      `${fmtUsd(r.totalGas).padStart(6)}  ` +
      `${fmtUsd(r.netProfit).padStart(8)}   ${status}`
    );
  }

  lines.push("");
  lines.push("  📊 Session Stats");
  lines.push("  ─────────────────────────────────────────────────────────────────────────────");
  if (session.bestEver) {
    const bestTime = session.bestEver.time.toISOString().slice(11, 16) + " UTC";
    lines.push(`  Best ever: ${fmtPct(session.bestEver.netPct)} (${fmtUsd(session.bestEver.netProfit)}) at ${bestTime} — ${session.bestEver.label}`);
  } else {
    lines.push("  Best ever: (none yet)");
  }

  const currentBest = routes.filter(r => r.ok).sort((a, b) => b.netProfit - a.netProfit)[0];
  if (currentBest) {
    lines.push(`  Current best: ${fmtPct(currentBest.netPct)} (${fmtUsd(currentBest.netProfit)})`);
  }

  if (session.alertCount > 0 && session.alertPcts.length > 0) {
    const avgPct = session.alertPcts.reduce((a, b) => a + b, 0) / session.alertPcts.length;
    lines.push(`  Alert threshold hits: ${session.alertCount} (avg: ${fmtPct(avgPct)})`);
  } else {
    lines.push("  Alert threshold hits: 0");
  }

  const cycleSec = (cycleDurationMs / 1000).toFixed(1);
  lines.push(`  Last cycle: ${cycleSec}s | Next: ${nextIn}s`);

  // Clear screen and print
  process.stdout.write("\x1B[2J\x1B[H");
  console.log(lines.join("\n"));
}

// ── Main loop ──────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new JsonlStore(DATA_DIR);

  const session = {
    startedAt: new Date(),
    cycles: 0,
    alertCount: 0,
    alertPcts: [],
    bestEver: null,
  };

  console.log(`Starting monitor: capital=$${args.capital} flash=${args.flashFeePct}% min=${fmtUsd(args.minProfit)} interval=${args.interval}s`);

  while (true) {
    const cycleStart = Date.now();
    let routes;
    try {
      routes = await runCycle(args.capital, args.flashFeePct);
    } catch (err) {
      console.error(`✗ Cycle error: ${err.message}`);
      await sleep(args.interval * 1000);
      continue;
    }
    session.cycles++;
    const cycleDurationMs = Date.now() - cycleStart;

    // Update session best-ever
    const okRoutes = routes.filter(r => r.ok);
    for (const r of okRoutes) {
      if (!session.bestEver || r.netProfit > session.bestEver.netProfit) {
        session.bestEver = { label: r.label, netProfit: r.netProfit, netPct: r.netPct, time: new Date() };
      }
    }

    // Check for alerts
    const alerts = okRoutes.filter(r => r.netProfit >= args.minProfit);
    for (const r of alerts) {
      session.alertCount++;
      session.alertPcts.push(r.netPct);
      // Terminal bell
      process.stdout.write("\x07");
      // Log to JSONL
      await store.append("triangular-alerts", {
        observedAt: new Date().toISOString(),
        cycle: session.cycles,
        capital: args.capital,
        flashFeePct: args.flashFeePct,
        route: r.label,
        spreadPct: r.spreadPct,
        grossProfit: r.grossProfit,
        totalGas: r.totalGas,
        flashFeeUsd: r.flashFeeUsd,
        netProfit: r.netProfit,
        netPct: r.netPct,
        totalLatencyMs: r.totalLatencyMs,
      });
      // Telegram alert (non-blocking)
      sendTelegramMessage({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        text: `🔔 BOB Claw Alert\n${r.label}\nNet: $${r.netProfit.toFixed(2)} (${(r.netPct).toFixed(3)}%)\nGas: $${r.totalGas.toFixed(3)}\nCapital: $${args.capital} | Flash: ${args.flashFeePct}%`,
      }).catch(() => {});
    }

    renderDashboard(args, session, routes, cycleDurationMs);

    // Wait for next cycle
    const elapsed = Date.now() - cycleStart;
    const waitMs = Math.max(0, args.interval * 1000 - elapsed);
    await sleep(waitMs);
  }
}

main().catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
