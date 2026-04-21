#!/usr/bin/env node

/**
 * report-strategy-tick-slice.mjs
 *
 * Reads `logs/strategy-tick.jsonl` (latest entry per strategy) plus the
 * fast-track promotion evaluation, and writes a focused JSON slice the
 * dashboard renders without touching the full dashboard-status builder.
 *
 *   node src/cli/report-strategy-tick-slice.mjs \
 *     [--tick-log=logs/strategy-tick.jsonl] \
 *     [--audit=logs/signer-audit.jsonl] \
 *     [--out=dashboard/public/strategy-tick-status.json] \
 *     [--strategy=beefy-folding-vault] [--strategy=...] \
 *     [--quiet] [--json]
 *
 * Exit code 0 even if logs are empty — the slice still publishes the
 * fact that no tick has been observed yet, which is itself signal.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  evaluatePromotionEvidence,
  PROMOTION_THRESHOLDS,
  PROMOTION_THRESHOLDS_STRICT,
} from "../strategy/promotion-evidence.mjs";

const DEFAULT_STRATEGIES = ["beefy-folding-vault", "wrapped-btc-loop-base-moonwell"];

function parseArgs(argv) {
  const out = { json: false, quiet: false, strategies: [] };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--quiet") { out.quiet = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === "strategy") { out.strategies.push(m[2]); continue; }
    out[m[1]] = m[2];
  }
  return out;
}

function readJsonlSafe(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function latestTickPerStrategy(ticks) {
  // Each tick record carries `strategies: [...]`. Index by strategy.
  const byStrategy = new Map();
  for (const t of ticks) {
    for (const sid of t.strategies || []) {
      const cur = byStrategy.get(sid);
      if (!cur || new Date(t.tickAt) > new Date(cur.tickAt)) byStrategy.set(sid, t);
    }
  }
  return byStrategy;
}

function main() {
  const args = parseArgs(process.argv);
  const strategies = args.strategies.length > 0 ? args.strategies : DEFAULT_STRATEGIES;
  const tickPath = resolve(args["tick-log"] || "logs/strategy-tick.jsonl");
  const auditPath = resolve(args.audit || "logs/signer-audit.jsonl");
  const outPath = resolve(args.out || "dashboard/public/strategy-tick-status.json");

  const ticks = readJsonlSafe(tickPath);
  const audit = readJsonlSafe(auditPath);
  const latestByStrategy = latestTickPerStrategy(ticks);
  const nowMs = Date.now();

  const strategyRows = strategies.map((sid) => {
    const tick = latestByStrategy.get(sid) || null;
    const tickBlocker = tick?.blockers?.find((b) => b.strategyId === sid) || null;
    const tickSnapshot = tick?.snapshotSummary?.find((item) => item?.strategyId === sid) || null;
    const receipts = audit.filter((r) => r?.strategyId === sid);

    const promotionFastTrack = evaluatePromotionEvidence({
      strategyId: sid,
      receipts,
      nowMs,
    });
    const promotionStrict = evaluatePromotionEvidence({
      strategyId: sid,
      receipts,
      nowMs,
      lookbackDays: 14,
      thresholds: PROMOTION_THRESHOLDS_STRICT,
    });

    return {
      strategyId: sid,
      lastTickAt: tick?.tickAt || null,
      lastTickMode: tickBlocker?.mode || null,
      lastTickBlockers: tickBlocker?.blockers || [],
      lastTickCandidateCount: tick?.candidateCount ?? 0,
      lastTickAllowCount: tick?.dispatchSummary?.allowCount ?? 0,
      lastTickDenyCount: tick?.dispatchSummary?.denyCount ?? 0,
      capsConfigured: tickSnapshot?.capsConfigured ?? null,
      operatorAddress: tickSnapshot?.operatorAddress ?? null,
      gasFloatConfiguredChainCount: tickSnapshot?.gasFloatSummary?.configuredChainCount ?? 0,
      gasFloatObservedChainCount: tickSnapshot?.gasFloatSummary?.observedChainCount ?? 0,
      gasFloatMissingChains: (tickSnapshot?.gasFloatSummary?.chains || [])
        .filter((item) => item?.missingReason)
        .map((item) => ({
          chain: item.chain,
          reason: item.missingReason,
        })),
      receiptCountTotal: receipts.length,
      receiptCountSignerBacked: receipts.filter((r) => r?.source === "signer").length,
      promotion: {
        fastTrack: {
          eligible: promotionFastTrack.eligible,
          blockers: promotionFastTrack.blockers.map((b) => b.kind),
          signerBackedReceiptCount: promotionFastTrack.evidence?.signerBackedReceiptCount ?? 0,
          consecutiveSuccess: promotionFastTrack.evidence?.consecutiveSuccess ?? 0,
        },
        strict: {
          eligible: promotionStrict.eligible,
          blockers: promotionStrict.blockers.map((b) => b.kind),
        },
      },
    };
  });

  const slice = {
    schemaVersion: 1,
    generatedAt: new Date(nowMs).toISOString(),
    fastTrackThresholds: PROMOTION_THRESHOLDS,
    strictThresholds: PROMOTION_THRESHOLDS_STRICT,
    tickCountTotal: ticks.length,
    latestTickAt: ticks.length > 0
      ? ticks.map((t) => t.tickAt).sort().slice(-1)[0]
      : null,
    strategies: strategyRows,
    summary: {
      strategiesTracked: strategies.length,
      strategiesWithTick: strategyRows.filter((s) => s.lastTickAt).length,
      strategiesMissingCaps: strategyRows.filter((s) => s.capsConfigured === false).length,
      strategiesEligibleFastTrack: strategyRows.filter((s) => s.promotion.fastTrack.eligible).length,
      strategiesEligibleStrict: strategyRows.filter((s) => s.promotion.strict.eligible).length,
      totalSignerBackedReceipts: strategyRows.reduce((acc, s) => acc + s.receiptCountSignerBacked, 0),
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(slice, null, 2));

  if (!args.quiet) {
    if (args.json) {
      console.log(JSON.stringify({ outPath, slice }));
    } else {
      console.log(`strategy-tick slice written: ${outPath}`);
      console.log(`  ticks=${slice.tickCountTotal} strategies=${slice.summary.strategiesTracked}`);
      console.log(`  withTick=${slice.summary.strategiesWithTick} eligibleFastTrack=${slice.summary.strategiesEligibleFastTrack} eligibleStrict=${slice.summary.strategiesEligibleStrict}`);
      console.log(`  totalSignerBackedReceipts=${slice.summary.totalSignerBackedReceipts}`);
    }
  }
}

main();
