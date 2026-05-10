import { validateStrategyRecord } from "./strategy-record-schema.mjs";

export function createDefaultStrategyClassPlugin(classKey = "yield") {
  return Object.freeze({
    classKey,
    classify(record = {}) {
      return { ...record, classKey: record.classKey || classKey };
    },
    validateRecord(record = {}) {
      return validateStrategyRecord(record);
    },
    scoreFor(record = {}) {
      return {
        score: Number(record.measured_apr_pct || 0),
        breakdown: {
          plugin: "default",
          measuredAprPct: Number(record.measured_apr_pct || 0),
        },
      };
    },
    buildEntryIntent(record = {}, context = {}) {
      return {
        intentType: "strategy_record_entry",
        strategyId: record.strategyId,
        chain: record.chain,
        protocol: record.protocol,
        poolKey: record.poolKey,
        requestedUsd: context.requestedUsd ?? null,
      };
    },
    buildExitIntent(record = {}) {
      return {
        intentType: "strategy_record_exit",
        strategyId: record.strategyId,
        chain: record.chain,
        protocol: record.protocol,
        poolKey: record.poolKey,
      };
    },
    buildHealthCheck(record = {}) {
      return {
        strategyId: record.strategyId,
        chain: record.chain,
        protocol: record.protocol,
        checks: ["position_reader", "reward_accrual", "pnl_accounting"],
      };
    },
    expectedFailureModes(record = {}) {
      const modes = ["policy_reject", "reader_failed", "source_stale"];
      if (record.rewardAccrual?.kind && record.rewardAccrual.kind !== "none") {
        modes.push("reward_exit_liquidity_failed");
      }
      return modes;
    },
  });
}

export function validateStrategyClassPlugin(plugin = {}) {
  const required = [
    "classify",
    "validateRecord",
    "scoreFor",
    "buildEntryIntent",
    "buildExitIntent",
    "buildHealthCheck",
    "expectedFailureModes",
  ];
  const missing = required.filter((name) => typeof plugin[name] !== "function");
  return {
    ok: missing.length === 0 && Boolean(plugin.classKey),
    missing,
  };
}
