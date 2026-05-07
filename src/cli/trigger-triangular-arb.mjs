#!/usr/bin/env node

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { canaryCheck, recordTradeResult } from "../risk/canary-guard.mjs";
import { odosSafeSourceWhitelist } from "../dex/odos.mjs";
import {
  getTriangleProfile,
  triangleDatasetNames,
  trianglePermutations,
} from "../flash/triangle-profiles.mjs";

import { sendTelegramMessage } from "../notify/telegram.mjs";
import { readFileSync, existsSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = config.dataDir || join(ROOT, "data");
const ODOS_API = "https://api.odos.xyz";
const CALL_DELAY_MS = 2000;
const FLASH_FEE_PCT = 0.05;

function loadDeployedContract() {
  const cfgPath = join(ROOT, "data", "deployed-contract.json");
  if (!existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    return cfg.contractAddress || null;
  } catch { return null; }
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((item) => item.startsWith("--") && !item.includes("=")));
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );

  return {
    capital: parseFloat(options.capital || "1000"),
    flashFeePct: options["flash-fee"] !== undefined ? parseFloat(options["flash-fee"]) : FLASH_FEE_PCT,
    minProfit: parseFloat(options["min-profit"] || "0.30"),
    interval: parseInt(options.interval || "60", 10),
    contract: options.contract || process.env.FLASH_ARB_CONTRACT || loadDeployedContract(),
    rpcUrl: options["rpc-url"] || process.env.BASE_RPC_URL || "https://mainnet.base.org",
    once: flags.has("--once"),
    simulate: flags.has("--simulate"),
    live: flags.has("--live"),
    profile: options.profile,
  };
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

function ts() {
  return new Date().toISOString().slice(11, 19);
}

function fmtUsd(number) {
  return number < 0 ? `-$${Math.abs(number).toFixed(2)}` : `$${number.toFixed(2)}`;
}

function fmtPct(number) {
  const sign = number >= 0 ? "+" : "";
  return `${sign}${number.toFixed(3)}%`;
}

async function isEmergencyStopped() {
  try {
    await access(config.emergencyStopFlagPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function odosQuote(chainId, inputAddr, inputAmount, outputAddr, userAddr) {
  const body = {
    chainId,
    inputTokens: [{ tokenAddress: inputAddr, amount: String(inputAmount) }],
    outputTokens: [{ tokenAddress: outputAddr, proportion: 1 }],
    userAddr: userAddr || "0x0000000000000000000000000000000000000001",
    slippageLimitPercent: 0.5,
    disableRFQs: true,
    compact: true,
  };
  const sourceWhitelist = odosSafeSourceWhitelist("base");
  if (sourceWhitelist) body.sourceWhitelist = sourceWhitelist;
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
    pathId: data.pathId,
    outAmount: data.outAmounts[0],
    gasUsd: data.gasEstimateValue ?? 0,
    impact: data.priceImpact ?? 0,
    latencyMs,
  };
}

async function odosAssemble(pathId, userAddr) {
  const start = Date.now();
  const response = await fetch(`${ODOS_API}/sor/assemble`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userAddr, pathId }),
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try { const b = await response.json(); detail += ` - ${b.detail || b.message || JSON.stringify(b).slice(0, 120)}`; } catch (_) {}
    return { ok: false, error: detail, latencyMs };
  }
  const data = await response.json();
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

const CAST_BIN = join(process.env.HOME || "", ".foundry", "bin", "cast");

function castCall(contractAddr, signature, callArgs, rpcUrl) {
  return new Promise((resolve, reject) => {
    execFile(CAST_BIN, ["call", contractAddr, signature, ...callArgs, "--rpc-url", rpcUrl, "--from", "0x96262be63aa687563789225c2fe898c27a3b0ae4"], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout.trim());
    });
  });
}

async function quoteTriangularRoute(profile, tokenA, tokenB, capital, flashFeePct, userAddr) {
  const stable = profile.stableToken;
  const label = `${stable.symbol}→${tokenA.symbol}→${tokenB.symbol}→${stable.symbol}`;
  const stableRaw = String(Math.round(capital * 10 ** stable.decimals));

  const quote1 = await odosQuote(profile.chainId, stable.address, stableRaw, tokenA.address, userAddr);
  if (!quote1.ok) return { label, ok: false, error: `leg1: ${quote1.error}` };
  await sleep(CALL_DELAY_MS);

  const quote2 = await odosQuote(profile.chainId, tokenA.address, quote1.outAmount, tokenB.address, userAddr);
  if (!quote2.ok) return { label, ok: false, error: `leg2: ${quote2.error}` };
  await sleep(CALL_DELAY_MS);

  const quote3 = await odosQuote(profile.chainId, tokenB.address, quote2.outAmount, stable.address, userAddr);
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
    aSymbol: tokenA.symbol,
    bSymbol: tokenB.symbol,
    tokenA,
    tokenB,
    startUsdc: capital,
    endUsdc: round6(endUsdc),
    grossProfit: round6(grossProfit),
    totalGas: round6(totalGas),
    flashFeeUsd: round6(flashFeeUsd),
    netProfit: round6(netProfit),
    spreadPct: round4(spreadPct),
    netPct: round4(netPct),
    totalLatencyMs: quote1.latencyMs + quote2.latencyMs + quote3.latencyMs,
    legs: {
      q1: { pathId: quote1.pathId, outAmount: quote1.outAmount, gasUsd: quote1.gasUsd, latencyMs: quote1.latencyMs },
      q2: { pathId: quote2.pathId, outAmount: quote2.outAmount, gasUsd: quote2.gasUsd, latencyMs: quote2.latencyMs },
      q3: { pathId: quote3.pathId, outAmount: quote3.outAmount, gasUsd: quote3.gasUsd, latencyMs: quote3.latencyMs },
    },
  };
}

async function assembleRoute(route, contractAddr) {
  const userAddr = contractAddr || "0x0000000000000000000000000000000000000001";
  const assembled = {};

  for (const [legKey, legLabel] of [
    ["q1", "Leg 1"],
    ["q2", "Leg 2"],
    ["q3", "Leg 3"],
  ]) {
    const leg = route.legs[legKey];
    if (!leg.pathId) return { ok: false, error: `${legLabel}: missing pathId` };
    const assembledLeg = await odosAssemble(leg.pathId, userAddr);
    if (!assembledLeg.ok) return { ok: false, error: `${legLabel}: assemble failed — ${assembledLeg.error}` };
    assembled[legKey] = assembledLeg;
    await sleep(CALL_DELAY_MS);
  }

  return { ok: true, assembled };
}

async function simulateArb(profile, route, assembled, contractAddr, rpcUrl) {
  if (!profile.supportsContractSimulation) {
    return { ok: false, error: `${profile.label} is analysis-only until ETH/mixed flash contracts exist` };
  }
  if (!contractAddr) {
    return { ok: false, error: "no contract address (use --contract or FLASH_ARB_CONTRACT)" };
  }

  const stable = profile.stableToken;
  const stableRaw = String(Math.round(route.startUsdc * 10 ** stable.decimals));
  const signature = "executeTriangularArb(uint256,address,address,bytes,bytes,bytes)";
  const callArgs = [stableRaw, route.tokenA.address, route.tokenB.address, assembled.q1.data, assembled.q2.data, assembled.q3.data];

  try {
    const result = await castCall(contractAddr, signature, callArgs, rpcUrl);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function runCycle(args, profile, datasetNames, store, session) {
  const cycleStart = Date.now();
  const contractAddr = args.contract;
  const userAddr = contractAddr || "0x0000000000000000000000000000000000000001";

  console.log(`\n[${ts()}] Scanning ${trianglePermutations(profile.id).length} routes for ${profile.label}...`);

  const routes = [];
  for (const [tokenA, tokenB] of trianglePermutations(profile.id)) {
    routes.push(await quoteTriangularRoute(profile, tokenA, tokenB, args.capital, args.flashFeePct, userAddr));
    await sleep(CALL_DELAY_MS);
  }

  const profitable = routes.filter((route) => route.ok && route.netProfit >= args.minProfit).sort((left, right) => right.netProfit - left.netProfit);

  for (const route of routes) {
    if (!route.ok) {
      console.log(`[${ts()}] ❌ ${route.label}: ${route.error}`);
      continue;
    }
    const flag = route.netProfit >= args.minProfit ? "✅" : route.netProfit > 0 ? "🟡" : "⚪";
    console.log(`[${ts()}] ${flag} ${route.label.padEnd(28)} Spread: ${fmtPct(route.spreadPct)} | Net: ${fmtUsd(route.netProfit)} | Gas: ${fmtUsd(route.totalGas)}`);
  }

  if (!profitable.length) {
    console.log(`[${ts()}] No routes above ${fmtUsd(args.minProfit)} threshold.`);
    await store.append(datasetNames.triggerLogName, {
      observedAt: new Date().toISOString(),
      profileId: profile.id,
      profileLabel: profile.label,
      cycle: session.cycles,
      phase: "quote",
      capital: args.capital,
      routesScanned: routes.length,
      routesOk: routes.filter((route) => route.ok).length,
      profitableCount: 0,
      bestNet: routes.filter((route) => route.ok).sort((left, right) => right.netProfit - left.netProfit)[0]?.netProfit ?? null,
      action: "none",
    });
    return { cycleDurationMs: Date.now() - cycleStart };
  }

  const best = profitable[0];
  console.log(`\n[${ts()}] ✅ OPPORTUNITY: ${best.label}`);
  console.log(`           Spread: ${fmtPct(best.spreadPct)} | Net: ${fmtUsd(best.netProfit)} | Gas: ${fmtUsd(best.totalGas)}`);

  // Re-quote the best route with fresh pathIds (old ones expire after ~60s)
  console.log(`\n[${ts()}] 🔄 Re-quoting ${best.label} for fresh pathIds...`);
  const freshRoute = await quoteTriangularRoute(profile, best.tokenA, best.tokenB, args.capital, args.flashFeePct, contractAddr);
  if (!freshRoute.ok || freshRoute.netProfit < args.minProfit) {
    console.log(`[${ts()}] ❌ Re-quote no longer profitable: ${freshRoute.ok ? fmtUsd(freshRoute.netProfit) : freshRoute.error}`);
    await store.append(datasetNames.triggerLogName, {
      observedAt: new Date().toISOString(),
      profileId: profile.id,
      profileLabel: profile.label,
      cycle: session.cycles,
      phase: "requote_failed",
      route: best.label,
      netProfit: freshRoute.ok ? freshRoute.netProfit : null,
      action: "requote_unprofitable",
    });
    return { cycleDurationMs: Date.now() - cycleStart };
  }
  console.log(`[${ts()}] ✅ Fresh quote: Net ${fmtUsd(freshRoute.netProfit)}`);

  console.log(`\n[${ts()}] 📦 Assembling Odos calldata...`);
  const assembly = await assembleRoute(freshRoute, contractAddr);
  if (!assembly.ok) {
    console.log(`[${ts()}] ❌ Assemble failed: ${assembly.error}`);
    await store.append(datasetNames.triggerLogName, {
      observedAt: new Date().toISOString(),
      profileId: profile.id,
      profileLabel: profile.label,
      cycle: session.cycles,
      phase: "assemble",
      route: best.label,
      netProfit: best.netProfit,
      netPct: best.netPct,
      error: assembly.error,
      action: "assemble_failed",
    });
    return { cycleDurationMs: Date.now() - cycleStart };
  }

  let simulation = null;
  let txResult = null;
  if (args.simulate) {
    console.log(`\n[${ts()}] 🔬 Simulating via cast call...`);
    if (args.contract) console.log(`           Contract: ${args.contract}`);
    simulation = await simulateArb(profile, best, assembly.assembled, args.contract, args.rpcUrl);
    if (simulation.ok) console.log(`           ✅ Simulation succeeded: ${simulation.result}`);
    else console.log(`           ❌ Simulation failed: ${simulation.error}`);
  } else {
    const stable = profile.stableToken;
    const stableRaw = String(Math.round(best.startUsdc * 10 ** stable.decimals));
    console.log(`\n[${ts()}] 🔬 DRY RUN — would execute:`);
    console.log(`           Contract: ${args.contract || "(not set — use --contract)"}`);
    console.log(
      `           Function: executeTriangularArb(${stableRaw}, ${best.tokenA.address}, ${best.tokenB.address}, ` +
        `${assembly.assembled.q1.data.slice(0, 8)}…, ${assembly.assembled.q2.data.slice(0, 8)}…, ${assembly.assembled.q3.data.slice(0, 8)}…)`,
    );
    console.log("           Estimated gas: 450,000");
  }

  await store.append(datasetNames.triggerLogName, {
    observedAt: new Date().toISOString(),
    profileId: profile.id,
    profileLabel: profile.label,
    cycle: session.cycles,
    phase: simulation ? "simulate" : "dry-run",
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
      leg1: { to: assembly.assembled.q1.to, dataLen: assembly.assembled.q1.data.length, gasLimit: assembly.assembled.q1.gasLimit },
      leg2: { to: assembly.assembled.q2.to, dataLen: assembly.assembled.q2.data.length, gasLimit: assembly.assembled.q2.gasLimit },
      leg3: { to: assembly.assembled.q3.to, dataLen: assembly.assembled.q3.data.length, gasLimit: assembly.assembled.q3.gasLimit },
    },
    simulation: simulation ? { ok: simulation.ok, error: simulation.error || null } : null,
    action: args.live ? "live-canary" : "dry-run",
  });
  console.log(`\n[${ts()}] 📝 Logged to data/${datasetNames.triggerLogName}.jsonl`);

  // Send Telegram alert for opportunities
  try {
    const envPath = join(ROOT, ".env");
    let botToken, chatId;
    if (existsSync(envPath)) {
      const envText = readFileSync(envPath, "utf8");
      botToken = envText.match(/TELEGRAM_BOT_TOKEN=(.+)/)?.[1]?.trim();
      chatId = envText.match(/TELEGRAM_CHAT_ID=(.+)/)?.[1]?.trim();
    }
    if (botToken && chatId) {
      const emoji = simulation?.ok ? "✅" : "🎯";
      const text = [
        `${emoji} *Arb Opportunity Found*`,
        `Route: \`${best.label}\``,
        `Spread: +${best.spreadPct.toFixed(3)}% | Net: $${best.netProfit.toFixed(2)}`,
        `Gas: $${best.totalGas.toFixed(3)} | Capital: $${args.capital}`,
        simulation ? `Sim: ${simulation.ok ? "✅ PASS" : "❌ " + (simulation.error || "").slice(0, 60)}` : "Mode: dry-run",
      ].join("\n");
      await sendTelegramMessage({ botToken, chatId, text, category: "triangular_opportunity" });
    }
  } catch (_) { /* don't block on telegram failure */ }

  if (args.live) {
    throw new Error("trigger:arb live mode is disabled; emit a signer-daemon policy intent instead");
  }

  // Record result (skip if live mode already recorded above)
  if (!args.live) {
    await recordTradeResult({
      profit: best.netProfit,
      route: best.label,
      txHash: null,
      dryRun: true,
    });
  }

  session.triggerCount += 1;
  return { cycleDurationMs: Date.now() - cycleStart };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getTriangleProfile(args.profile);
  const datasetNames = triangleDatasetNames(profile.id);
  const store = new JsonlStore(DATA_DIR);

  if ((args.simulate || args.live) && !profile.supportsContractSimulation) {
    console.error(`🚫 ${profile.label} only supports analysis/dry-run today; mixed ETH flash simulation/live is not wired.`);
    process.exitCode = 1;
    return;
  }

  if (await isEmergencyStopped()) {
    console.error("🛑 Emergency stop is active. Exiting.");
    process.exitCode = 1;
    return;
  }

  const mode = args.live ? "LIVE-CANARY" : args.simulate ? "simulate" : "dry-run";
  const canaryMode = args.live ? "canary" : "normal";
  const guard = await canaryCheck({ mode: canaryMode, tradeProfit: 0, dryRun: !args.live });
  if (!guard.allowed) {
    console.error(`🛑 Canary guard blocked startup: ${guard.reason} (daily P&L: $${guard.dailyPnl.toFixed(2)}, consecutive fails: ${guard.consecFails})`);
    process.exitCode = 1;
    return;
  }

  console.log("╔════════════════════════════════════════════════════════════════════╗");
  console.log(`║  🎯 Triangular Arb Trigger — ${mode.toUpperCase().padEnd(10)} ${profile.label.padEnd(23)}║`);
  console.log(`║  Capital: $${String(args.capital.toLocaleString()).padEnd(7)} | Min Profit: ${fmtUsd(args.minProfit)} | Mode: ${mode.padEnd(10)} ║`);
  console.log("╚════════════════════════════════════════════════════════════════════╝");
  console.log(`  Profile: ${profile.id}`);
  if (args.contract) console.log(`  Contract: ${args.contract}`);
  else console.log("  Contract: (not set — use --contract=0x… or FLASH_ARB_CONTRACT env)");
  if (args.simulate) console.log(`  RPC: ${args.rpcUrl}`);
  console.log("");

  const session = { startedAt: new Date(), cycles: 0, triggerCount: 0 };

  while (true) {
    if (await isEmergencyStopped()) {
      console.error(`\n[${ts()}] 🛑 Emergency stop detected. Halting.`);
      break;
    }

    session.cycles += 1;
    const cycleGuard = await canaryCheck({ mode: canaryMode, tradeProfit: 0, dryRun: !args.live });
    if (!cycleGuard.allowed) {
      console.error(`\n[${ts()}] 🛑 Canary guard halted: ${cycleGuard.reason} (daily P&L: $${cycleGuard.dailyPnl.toFixed(2)}, consecutive fails: ${cycleGuard.consecFails})`);
      break;
    }

    try {
      const { cycleDurationMs } = await runCycle(args, profile, datasetNames, store, session);
      if (args.once) break;
      const waitMs = Math.max(0, args.interval * 1000 - cycleDurationMs);
      console.log(`\n[${ts()}] Next scan in ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
    } catch (error) {
      console.error(`[${ts()}] ✗ Cycle error: ${error.message}`);
      await store.append(datasetNames.triggerLogName, {
        observedAt: new Date().toISOString(),
        profileId: profile.id,
        profileLabel: profile.label,
        cycle: session.cycles,
        phase: "error",
        error: error.message,
      });
      if (args.once) break;
      await sleep(args.interval * 1000);
    }
  }

  console.log(`\nSession complete — ${session.cycles} cycles, ${session.triggerCount} triggers.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
