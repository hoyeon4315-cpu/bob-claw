import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function arrayAt(payload, keys = []) {
  for (const key of keys) {
    const value = key.split(".").reduce((cursor, part) => cursor?.[part], payload);
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function buildJsonStrategySourcePlugin({
  source,
  path,
  itemPaths = ["records", "items", "candidates", "topCandidates", "queue.items"],
  mapRecord = (record) => record,
} = {}) {
  return {
    source,
    async loadRecords() {
      const payload = await readJsonIfExists(path);
      if (!payload) return [];
      return arrayAt(payload, itemPaths).map((record) => mapRecord(record)).filter(Boolean);
    },
  };
}

function hasExplicitRewardToken(record = {}) {
  if (record.rewardToken) return true;
  if (Array.isArray(record.rewardTokens) && record.rewardTokens.length > 0) return true;
  if (record.rewardAccrual?.kind === "reward_token") return true;
  return false;
}

function deriveBacktestQuality(record = {}) {
  if (record.backtest_quality || record.backtestQuality) return record.backtest_quality || record.backtestQuality;
  if (record.autoEntry?.status === "ready" && record.autoEntry?.autoExecute === true && record.validationMode === "tiny_live_canary_only") {
    return "operator_override";
  }
  if (record.overfitRisk === "minimal" && Array.isArray(record.overfitFlags) && record.overfitFlags.length === 0) {
    return "single_period";
  }
  return "paper_only";
}

function deriveIlRiskClass(record = {}) {
  if (record.il_risk_class || record.ilRiskClass) return record.il_risk_class || record.ilRiskClass;
  if (record.executionSurface === "stableCarry" || record.family === "stable_treasury_carry") return "low";
  if (Array.isArray(record.assetFamilies) && record.assetFamilies.includes("stablecoin")) return "low";
  return "medium";
}

export function defaultStrategySourcePlugins({ dataDir } = {}) {
  if (!dataDir) return [];
  return [
    buildJsonStrategySourcePlugin({
      source: "manual",
      path: join(dataDir, "manual-strategy-records.json"),
    }),
    buildJsonStrategySourcePlugin({
      source: "merkl",
      path: join(dataDir, "merkl-canary-queue.json"),
      itemPaths: ["records", "items", "candidates", "queue", "topCandidates"],
      mapRecord(record = {}) {
        if (!record.strategyId && !record.mappedStrategyId && !record.opportunityId) return null;
        const rewardTokenBacked = hasExplicitRewardToken(record);
        return {
          strategyId: record.strategyId || record.mappedStrategyId || `merkl:${record.opportunityId}`,
          source: "merkl",
          classKey: record.classKey || "yield",
          family: record.family || record.category || "campaign",
          chain: record.chain,
          protocol: record.protocol || record.protocolId || "unknown",
          poolKey: record.poolKey || record.opportunityId || record.name || "unknown",
          measured_apr_pct: record.measured_apr_pct ?? record.aprPct ?? record.nativeAprPct ?? 0,
          reward_haircut_pct: record.reward_haircut_pct ?? record.rewardHaircutPct ?? (rewardTokenBacked ? 50 : 0),
          entry_cost_usd_per_dollar: record.entry_cost_usd_per_dollar ?? 0,
          exit_cost_usd_per_dollar: record.exit_cost_usd_per_dollar ?? 0,
          expected_hold_days: record.expected_hold_days ?? record.expectedHoldDays ?? 7,
          il_risk_class: deriveIlRiskClass(record),
          audit_status: record.audit_status || record.auditStatus || "review",
          protocol_age_days: record.protocol_age_days ?? record.protocolAgeDays ?? 0,
          receipts_positive_count: record.receipts_positive_count ?? record.receiptsPositiveCount ?? 0,
          receipts_total_count: record.receipts_total_count ?? record.receiptsTotalCount ?? 0,
          backtest_quality: deriveBacktestQuality(record),
          positionReader: record.positionReader || { kind: "merkl", status: "declared" },
          rewardAccrual: record.rewardAccrual || { kind: rewardTokenBacked ? "reward_token" : "none" },
          pnlAccounting: record.pnlAccounting || { unit: "BTC", status: "declared" },
        };
      },
    }),
    buildJsonStrategySourcePlugin({
      source: "defillama",
      path: join(dataDir, "defillama-strategy-records.json"),
    }),
    buildJsonStrategySourcePlugin({
      source: "pendle_api",
      path: join(dataDir, "pendle-strategy-records.json"),
    }),
  ];
}
