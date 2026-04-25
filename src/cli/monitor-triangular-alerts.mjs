#!/usr/bin/env node

import { resolve, dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { sendTelegramMessage } from "../notify/telegram.mjs";
import {
  getTriangleProfile,
  triangleDatasetNames,
  trianglePermutations,
} from "../flash/triangle-profiles.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const separatorIndex = text.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = text.slice(0, separatorIndex).trim();
    const value = text.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const DATA_DIR = config.dataDir || join(ROOT, "data");
const ODOS_API = "https://api.odos.xyz";
const CALL_DELAY_MS = 2000;

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  const capital = parseFloat(options.capital || "1000");
  const flashFeePct = options["flash-fee"] !== undefined ? parseFloat(options["flash-fee"]) : 0.05;
  const minProfit = parseFloat(options["min-profit"] || "0.30");
  const interval = parseInt(options.interval || "60", 10);
  return { capital, flashFeePct, minProfit, interval, profile: options.profile };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function round6(number) {
  return Math.round(number * 1e6) / 1e6;
}

function round4(number) {
  return Math.round(number * 1e4) / 1e4;
}

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function fmtUsd(number) {
  return number < 0 ? `-$${Math.abs(number).toFixed(2)}` : `$${number.toFixed(2)}`;
}

function fmtPct(number) {
  const sign = number >= 0 ? "+" : "";
  return `${sign}${number.toFixed(3)}%`;
}

function flashLabel(percent) {
  if (percent === 0) return "0% (Euler/Balancer)";
  if (percent === 0.05) return "0.05% (Aave)";
  return `${percent}%`;
}

async function odosQuote(chainId, inputAddr, inputAmount, outputAddr) {
  const body = {
    chainId,
    inputTokens: [{ tokenAddress: inputAddr, amount: String(inputAmount) }],
    outputTokens: [{ tokenAddress: outputAddr, proportion: 1 }],
    userAddr: "0x0000000000000000000000000000000000000001",
    slippageLimitPercent: 0.5,
    disableRFQs: true,
    compact: true,
  };
  const start = Date.now();
  const response = await fetch(`${ODOS_API}/sor/quote/v3`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;
  if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, latencyMs };
  const data = await response.json();
  if (!data.outAmounts?.[0]) return { ok: false, error: "no output", latencyMs };
  return {
    ok: true,
    outAmount: data.outAmounts[0],
    gasUsd: data.gasEstimateValue ?? 0,
    latencyMs,
  };
}

async function quoteTriangularRoute(profile, tokenA, tokenB, capital, flashFeePct) {
  const stable = profile.stableToken;
  const label = `${stable.symbol}→${tokenA.symbol}→${tokenB.symbol}→${stable.symbol}`;
  const stableRaw = String(Math.round(capital * 10 ** stable.decimals));

  const quote1 = await odosQuote(profile.chainId, stable.address, stableRaw, tokenA.address);
  if (!quote1.ok) return { label, ok: false, error: `leg1: ${quote1.error}` };
  await sleep(CALL_DELAY_MS);

  const quote2 = await odosQuote(profile.chainId, tokenA.address, quote1.outAmount, tokenB.address);
  if (!quote2.ok) return { label, ok: false, error: `leg2: ${quote2.error}` };
  await sleep(CALL_DELAY_MS);

  const quote3 = await odosQuote(profile.chainId, tokenB.address, quote2.outAmount, stable.address);
  if (!quote3.ok) return { label, ok: false, error: `leg3: ${quote3.error}` };

  const endUsdc = parseInt(quote3.outAmount, 10) / 10 ** stable.decimals;
  const grossProfit = endUsdc - capital;
  const totalGas = quote1.gasUsd + quote2.gasUsd + quote3.gasUsd;
  const flashFeeUsd = (capital * flashFeePct) / 100;
  const netProfit = grossProfit - totalGas - flashFeeUsd;
  const spreadPct = (grossProfit / capital) * 100;
  const netPct = (netProfit / capital) * 100;

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
    totalLatencyMs: quote1.latencyMs + quote2.latencyMs + quote3.latencyMs,
  };
}

async function runCycle(profile, capital, flashFeePct) {
  const results = [];
  for (const [tokenA, tokenB] of trianglePermutations(profile.id)) {
    results.push(await quoteTriangularRoute(profile, tokenA, tokenB, capital, flashFeePct));
    await sleep(CALL_DELAY_MS);
  }
  return results;
}

function renderDashboard(args, profile, session, routes, cycleDurationMs) {
  const lines = [];
  const now = new Date();
  const running = fmtDuration(now - session.startedAt);
  const nextIn = Math.max(0, args.interval - Math.floor(cycleDurationMs / 1000));

  lines.push("╔════════════════════════════════════════════════════════════════╗");
  lines.push(`║  🔍 Triangular Spread Monitor — ${profile.label.padEnd(23)}║`);
  lines.push(`║  Capital: $${args.capital.toLocaleString()} | Flash Fee: ${flashLabel(args.flashFeePct).padEnd(20)} ║`);
  lines.push(`║  Min Profit: ${fmtUsd(args.minProfit)} | Running: ${running.padEnd(8)} | Cycles: ${String(session.cycles).padEnd(4)}  ║`);
  lines.push(`║  Alerts: ${String(session.alertCount).padEnd(52)}║`);
  lines.push("╚════════════════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push("  Route                         Spread    Profit    Gas      Net       Status");
  lines.push("  ─────────────────────────────────────────────────────────────────────────────");

  for (const route of routes) {
    if (!route.ok) {
      lines.push(`  ${route.label.padEnd(30)}  ${(`err: ${route.error}`).padEnd(50)}`);
      continue;
    }
    const status = route.netProfit >= args.minProfit ? "✅ ALERT!" : route.netProfit >= args.minProfit * 0.5 ? "🟡 close" : "⚪ below";
    lines.push(
      `  ${route.label.padEnd(30)} ${fmtPct(route.spreadPct).padStart(8)}  ${fmtUsd(route.grossProfit).padStart(8)}  ` +
        `${fmtUsd(route.totalGas).padStart(6)}  ${fmtUsd(route.netProfit).padStart(8)}   ${status}`,
    );
  }

  lines.push("");
  lines.push("  📊 Session Stats");
  lines.push("  ─────────────────────────────────────────────────────────────────────────────");
  if (session.bestEver) {
    const bestTime = `${session.bestEver.time.toISOString().slice(11, 16)} UTC`;
    lines.push(`  Best ever: ${fmtPct(session.bestEver.netPct)} (${fmtUsd(session.bestEver.netProfit)}) at ${bestTime} — ${session.bestEver.label}`);
  } else {
    lines.push("  Best ever: (none yet)");
  }

  const currentBest = [...routes].filter((route) => route.ok).sort((left, right) => right.netProfit - left.netProfit)[0];
  if (currentBest) lines.push(`  Current best: ${fmtPct(currentBest.netPct)} (${fmtUsd(currentBest.netProfit)})`);

  if (session.alertCount > 0 && session.alertPcts.length > 0) {
    const avgPct = session.alertPcts.reduce((sum, value) => sum + value, 0) / session.alertPcts.length;
    lines.push(`  Alert threshold hits: ${session.alertCount} (avg: ${fmtPct(avgPct)})`);
  } else {
    lines.push("  Alert threshold hits: 0");
  }

  lines.push(`  Last cycle: ${(cycleDurationMs / 1000).toFixed(1)}s | Next: ${nextIn}s`);
  process.stdout.write("\x1B[2J\x1B[H");
  console.log(lines.join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getTriangleProfile(args.profile);
  const datasetNames = triangleDatasetNames(profile.id);
  const store = new JsonlStore(DATA_DIR);

  const session = {
    startedAt: new Date(),
    cycles: 0,
    alertCount: 0,
    alertPcts: [],
    bestEver: null,
  };

  console.log(
    `Starting monitor: profile=${profile.id} capital=$${args.capital} flash=${args.flashFeePct}% min=${fmtUsd(args.minProfit)} interval=${args.interval}s`,
  );

  while (true) {
    const cycleStart = Date.now();
    let routes;
    try {
      routes = await runCycle(profile, args.capital, args.flashFeePct);
    } catch (error) {
      console.error(`✗ Cycle error: ${error.message}`);
      await sleep(args.interval * 1000);
      continue;
    }
    session.cycles += 1;
    const cycleDurationMs = Date.now() - cycleStart;

    for (const route of routes.filter((item) => item.ok)) {
      if (!session.bestEver || route.netProfit > session.bestEver.netProfit) {
        session.bestEver = { label: route.label, netProfit: route.netProfit, netPct: route.netPct, time: new Date() };
      }
    }

    const alerts = routes.filter((route) => route.ok && route.netProfit >= args.minProfit);
    for (const route of alerts) {
      session.alertCount += 1;
      session.alertPcts.push(route.netPct);
      process.stdout.write("\x07");
      await store.append(datasetNames.alertLogName, {
        observedAt: new Date().toISOString(),
        profileId: profile.id,
        profileLabel: profile.label,
        cycle: session.cycles,
        capital: args.capital,
        flashFeePct: args.flashFeePct,
        route: route.label,
        spreadPct: route.spreadPct,
        grossProfit: route.grossProfit,
        totalGas: route.totalGas,
        flashFeeUsd: route.flashFeeUsd,
        netProfit: route.netProfit,
        netPct: route.netPct,
        totalLatencyMs: route.totalLatencyMs,
      });
      sendTelegramMessage({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        text:
          `🔔 BOB Claw Alert (${profile.label})\n${route.label}\nNet: $${route.netProfit.toFixed(2)} (${route.netPct.toFixed(3)}%)\n` +
          `Gas: $${route.totalGas.toFixed(3)}\nCapital: $${args.capital} | Flash: ${args.flashFeePct}%`,
      }).catch((error) => {
        console.error(
          `Telegram alert failed for ${profile.label} ${route.label} capital=${args.capital} flash=${args.flashFeePct}%: ${error.message}`,
        );
      });
    }

    renderDashboard(args, profile, session, routes, cycleDurationMs);
    const waitMs = Math.max(0, args.interval * 1000 - (Date.now() - cycleStart));
    await sleep(waitMs);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
