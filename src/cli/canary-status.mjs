#!/usr/bin/env node

/**
 * Canary Status — prints current canary guard state.
 *
 * Usage:
 *   node src/cli/canary-status.mjs
 */

import { getCanaryStatus } from "../risk/canary-guard.mjs";

function fmtUsd(n) {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

async function main() {
  const s = await getCanaryStatus();

  console.log("");
  console.log("🕯️  Canary Status");
  console.log(`Mode: ${s.mode} ($${s.dailyLimit}/day limit)`);
  console.log(`Today P&L: ${fmtUsd(s.dailyPnl)} (${s.tradesTotal} trades)`);
  console.log(`Consecutive fails: ${s.consecFails}`);
  console.log(`Emergency stop: ${s.stopped ? "🛑 ON" : "OFF"}`);
  console.log("");
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
