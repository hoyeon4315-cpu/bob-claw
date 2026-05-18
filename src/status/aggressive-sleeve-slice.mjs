/**
 * Aggressive Velocity Sleeve — Dashboard Status Slice (Phase 6)
 *
 * Read-only view for the public dashboard and operator reports.
 * Consumes the artifacts written by the sleeve accounting + writer.
 *
 * Pattern follows buildYieldShadowBook / receipt reconciliation slices (loose coupling).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = "data/aggressive-yield";

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function buildAggressiveSleeveStatus({ now = new Date().toISOString() } = {}) {
  const ledgerPath = join(DATA_DIR, "ledger.jsonl");
  const trackerPath = join(DATA_DIR, "asset-tracker-state.json");
  const performancePath = join(DATA_DIR, "performance.json");

  const tracker = safeReadJson(trackerPath);
  const performance = safeReadJson(performancePath);

  // Simple ledger tail count (lightweight, no full parse for dashboard)
  let ledgerEventCount = 0;
  try {
    const raw = readFileSync(ledgerPath, "utf8");
    ledgerEventCount = raw.trim().split("\n").filter(Boolean).length;
  } catch {}

  const sleeve = tracker?.sleeve || "aggressive-velocity-v1";

  return {
    sleeve,
    generatedAt: now,
    navBtc: tracker?.totals?.navBtc ?? 0,
    navUsd: tracker?.totals?.navUsd ?? 0,
    positionCount: (tracker?.positions || []).length,
    ledgerEventCount,
    performance: performance
      ? {
          realizedBtc: performance.realizedBtc ?? 0,
          paybackContributionBtc: performance.paybackContributionBtc ?? 0,
        }
      : null,
    meta: {
      source: "data/aggressive-yield/* (read-only)",
      phase: "6",
    },
  };
}
