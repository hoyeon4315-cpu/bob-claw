import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function computeP90(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.9) - 1;
  const clampedIndex = Math.max(0, Math.min(index, sorted.length - 1));
  return sorted[clampedIndex];
}

function readGasHistory(chain, dataDir = "data") {
  const filePath = join(dataDir, `gas-history-${chain}.jsonl`);
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return [];

  const lines = raw.split("\n");
  const entries = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isFiniteNumber(parsed.gasPriceGwei) && parsed.observedAt) {
        entries.push(parsed);
      }
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function filterLast7Days(entries, now) {
  const cutoffMs = new Date(now).getTime() - 7 * 24 * 60 * 60 * 1000;
  return entries.filter((e) => new Date(e.observedAt).getTime() >= cutoffMs);
}

export function featureEnabled(profile = {}) {
  if (profile?.gasPriceCeiling === false) return false;
  return true;
}

export function evaluateGasPriceCeiling({
  intent = {},
  now = new Date().toISOString(),
  profile = {},
  dataDir = "data",
} = {}) {
  const blockers = [];
  const chain = intent.chain || "unknown";
  const currentGasPriceGwei = intent.gasPriceGwei ?? intent.metadata?.gasPriceGwei ?? null;

  if (!featureEnabled(profile)) {
    return {
      policy: "gas_price_ceiling",
      observedAt: now,
      decision: "ALLOW",
      blockers: [],
      metrics: {
        chain,
        currentGasPriceGwei,
        p90GasPriceGwei: null,
        historyEntriesCount: 0,
        enabled: false,
      },
    }
  }

  const historyEntries = readGasHistory(chain, dataDir);
  const hasHistory = historyEntries !== null;
  const recentEntries = hasHistory ? filterLast7Days(historyEntries, now) : [];
  const p90GasPriceGwei = computeP90(recentEntries.map((e) => e.gasPriceGwei));

  if (hasHistory && isFiniteNumber(currentGasPriceGwei) && isFiniteNumber(p90GasPriceGwei)) {
    if (currentGasPriceGwei > p90GasPriceGwei) {
      blockers.push("gas_price_above_ceiling");
    }
  }

  return {
    policy: "gas_price_ceiling",
    observedAt: now,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers,
    metrics: {
      chain,
      currentGasPriceGwei,
      p90GasPriceGwei,
      historyEntriesCount: recentEntries.length,
      enabled: true,
    },
  }
}
