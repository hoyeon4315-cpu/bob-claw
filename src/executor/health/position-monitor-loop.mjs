// Position monitor daemon scaffold (5-min loop).
//
// Wires Phase 1 portfolio snapshot → Phase 4.2 position-action-engine.
// Emits planned actions to data/health/position-actions-latest.json + audit
// append to logs/position-monitor-audit.jsonl.
//
// AGENTS.md compliance:
//   - LLM not used.
//   - Does NOT issue rebalance intents (engine type-restricted; rebalancer owns).
//   - Does NOT toggle kill-switch / dev-lock.
//
// Run modes:
//   --once        single pass then exit
//   --interval=N  loop every N seconds (default 300)
//   --dry-run     log actions only, no audit append

import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import { planActions } from "./position-action-engine.mjs";

function ensureDir(p) {
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
}

export async function runOnce({
  loadSnapshot,
  loadPolicies,
  outPath = "data/health/position-actions-latest.json",
  auditPath = "logs/position-monitor-audit.jsonl",
  dryRun = false,
  now = new Date(),
} = {}) {
  if (typeof loadSnapshot !== "function") throw new TypeError("loadSnapshot required");
  if (typeof loadPolicies !== "function") throw new TypeError("loadPolicies required");
  const snapshot = await loadSnapshot();
  const policies = await loadPolicies();
  const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
  const actions = planActions({ positions, policiesByStrategy: policies, now });
  const result = {
    generatedAt: new Date(now).toISOString(),
    positionsConsidered: positions.length,
    actions,
  };
  if (!dryRun) {
    ensureDir(outPath);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    ensureDir(auditPath);
    appendFileSync(auditPath, JSON.stringify({ ts: result.generatedAt, count: actions.length, dryRun }) + "\n");
  }
  return result;
}

function parseArgs(argv) {
  const flags = { once: false, dryRun: false, intervalSec: 300 };
  for (const a of argv) {
    if (a === "--once") flags.once = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a.startsWith("--interval=")) flags.intervalSec = Number(a.slice("--interval=".length)) || 300;
  }
  return flags;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const loadSnapshot = deps.loadSnapshot || (async () => ({ positions: [] }));
  const loadPolicies = deps.loadPolicies || (async () => ({}));
  const tick = () => runOnce({ loadSnapshot, loadPolicies, dryRun: args.dryRun });
  const r = await tick();
  if (args.once) return r;
  // Lightweight loop (no live daemon spawn here; operator launches via PM).
  setInterval(tick, args.intervalSec * 1000).unref();
  return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
