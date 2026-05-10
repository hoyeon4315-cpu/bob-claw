import { validateStrategyRecord } from "../../../strategy-record-schema.mjs";

export function createPendleYtClassPlugin(classKey = "pendle_yt") {
  return Object.freeze({
    classKey,
    classify(record = {}) {
      return {
        ...record,
        classKey: record.classKey || classKey,
        ytExpiry: record.ytExpiry || null,
      };
    },
    validateRecord(record = {}) {
      return validateStrategyRecord(record);
    },
    scoreFor(record = {}) {
      const impliedAprPct = Number(record.impliedAprPct || 0);
      const rewardHaircutPct = Number(record.reward_haircut_pct || 50);
      const effectiveApr = impliedAprPct * (1 - rewardHaircutPct / 100);
      return {
        score: effectiveApr,
        breakdown: {
          plugin: "pendle_yt",
          impliedAprPct,
          rewardHaircutPct,
          effectiveApr,
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
        ytExpiry: record.ytExpiry || null,
        impliedAprPct: record.impliedAprPct ?? null,
        autoExecute: false,
      };
    },
    buildExitIntent(record = {}) {
      return {
        intentType: "strategy_record_exit",
        strategyId: record.strategyId,
        chain: record.chain,
        protocol: record.protocol,
        poolKey: record.poolKey,
        redemptionType: "yt_redeem",
      };
    },
    buildHealthCheck(record = {}) {
      return {
        strategyId: record.strategyId,
        chain: record.chain,
        protocol: record.protocol,
        checks: ["position_reader", "reward_accrual", "pnl_accounting", "yt_expiry"],
      };
    },
    expectedFailureModes(record = {}) {
      const modes = [
        "policy_reject",
        "reader_failed",
        "source_stale",
        "yt_expired",
      ];
      if (record.rewardAccrual?.kind && record.rewardAccrual.kind !== "none") {
        modes.push("reward_exit_liquidity_failed");
      }
      return modes;
    },
  });
}
