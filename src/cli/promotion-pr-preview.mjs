#!/usr/bin/env node
// T18 helper: preview which strategies are eligible for an
// autoExecute=true cap-flip based on signer-audit.jsonl evidence.
//
// Prints a deterministic JSON report. Does not edit configs, does not
// open PRs. The operator copies the suggestedDiff and commits it
// manually — caps are code per AGENTS.md.
//
// Usage:
//   node src/cli/promotion-pr-preview.mjs                       # full repo
//   node src/cli/promotion-pr-preview.mjs --strategy=<id>       # single strategy
//   node src/cli/promotion-pr-preview.mjs --lookback-days=21
//   node src/cli/promotion-pr-preview.mjs --audit=<path>

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  evaluatePromotionEvidence,
  summarizePromotionEvidence,
  PROMOTION_THRESHOLDS,
} from "../strategy/promotion-evidence.mjs";
import { STRATEGY_CAPS } from "../config/strategy-caps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_AUDIT = resolve(ROOT, "logs/signer-audit.jsonl");

function parseArgs(argv) {
  const out = { lookbackDays: PROMOTION_THRESHOLDS.defaultLookbackDays };
  for (const a of argv) {
    if (a.startsWith("--strategy=")) out.strategy = a.split("=")[1];
    else if (a.startsWith("--lookback-days=")) out.lookbackDays = Number(a.split("=")[1]);
    else if (a.startsWith("--audit=")) out.audit = a.split("=")[1];
    else if (a.startsWith("--write=")) out.write = a.split("=")[1];
    else if (a === "--quiet") out.quiet = true;
  }
  return out;
}

export function loadAuditReceipts(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let row;
    try { row = JSON.parse(raw); } catch { continue; }
    if (!row || !row.strategyId) continue;
    // Only consider terminal lifecycle rows — broadcast or realized.
    const stage = row.lifecycle?.stage;
    if (stage !== "broadcasted" && stage !== "realized" && stage !== "failed") continue;
    const tsMs = Date.parse(row.timestamp);
    if (!Number.isFinite(tsMs)) continue;
    out.push({
      strategyId: row.strategyId,
      tsMs,
      source: row.intent?.mode === "live" || row.broadcast ? "signer" : "shadow",
      txHash: row.broadcast?.txHash || row.lifecycle?.txHash || null,
      outcome: row.error
        ? "failure"
        : (stage === "failed" ? "failure" : "success"),
      realizedProfitSats: Number(row.realized?.profitSats || 0),
      roundTripCostSats: Number(row.realized?.roundTripCostSats || 0),
    });
  }
  return out;
}

export function buildPromotionReport({ receipts, nowMs, strategyIds, lookbackDays }) {
  const reports = strategyIds.map((id) =>
    evaluatePromotionEvidence({
      strategyId: id,
      receipts,
      nowMs,
      lookbackDays,
    })
  );
  return {
    generatedAt: new Date(nowMs).toISOString(),
    lookbackDays,
    thresholds: PROMOTION_THRESHOLDS,
    summary: summarizePromotionEvidence(reports),
    reports,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = args.audit ? resolve(args.audit) : DEFAULT_AUDIT;
  const receipts = loadAuditReceipts(audit);
  const knownIds = Object.keys(STRATEGY_CAPS);
  const knownAutoFalse = knownIds.filter((id) => STRATEGY_CAPS[id].autoExecute === false);
  const ids = args.strategy
    ? [args.strategy]
    : knownAutoFalse;
  const report = buildPromotionReport({
    receipts,
    nowMs: Date.now(),
    strategyIds: ids,
    lookbackDays: args.lookbackDays,
  });
  if (args.write) {
    const target = resolve(args.write);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + "\n");
  }
  if (!args.quiet) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
