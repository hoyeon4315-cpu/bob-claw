export const STRATEGY_RECORD_SCHEMA_VERSION = 3;

export const BACKTEST_QUALITY_VALUES = Object.freeze([
  "wf_cv_3_regime",
  "wf_cv_1_regime",
  "single_period",
  "paper_only",
  "operator_override",
]);

export const BACKTEST_QUALITY_OVERFIT_PENALTY = Object.freeze({
  wf_cv_3_regime: 1,
  wf_cv_1_regime: 0.82,
  single_period: 0.55,
  paper_only: 0.32,
  operator_override: 0.7,
});

const REQUIRED_FIELDS = Object.freeze([
  "strategyId",
  "source",
  "classKey",
  "family",
  "chain",
  "protocol",
  "poolKey",
  "measured_apr_pct",
  "reward_haircut_pct",
  "entry_cost_usd_per_dollar",
  "exit_cost_usd_per_dollar",
  "expected_hold_days",
  "il_risk_class",
  "audit_status",
  "protocol_age_days",
  "receipts_positive_count",
  "receipts_total_count",
  "backtest_quality",
  "positionReader",
  "rewardAccrual",
  "pnlAccounting",
]);

const NUMERIC_FIELDS = Object.freeze([
  "measured_apr_pct",
  "reward_haircut_pct",
  "entry_cost_usd_per_dollar",
  "exit_cost_usd_per_dollar",
  "expected_hold_days",
  "protocol_age_days",
  "receipts_positive_count",
  "receipts_total_count",
]);

function isMissing(value) {
  return value === null || value === undefined || value === "";
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function migrateStrategyRecord(record = {}) {
  const migrated = {
    ...record,
    schemaVersion: STRATEGY_RECORD_SCHEMA_VERSION,
  };
  if (!migrated.backtest_quality) migrated.backtest_quality = "paper_only";
  return migrated;
}

export function validateStrategyRecord(record = {}) {
  const migrated = migrateStrategyRecord(record);
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (isMissing(migrated[field])) errors.push(`missing_${field}`);
  }

  for (const field of NUMERIC_FIELDS) {
    const numeric = finiteNumber(migrated[field]);
    if (numeric === null) {
      errors.push(`invalid_number_${field}`);
      continue;
    }
    if (field !== "measured_apr_pct" && numeric < 0) errors.push(`negative_${field}`);
  }

  if (!BACKTEST_QUALITY_VALUES.includes(migrated.backtest_quality)) {
    errors.push("invalid_backtest_quality");
  }

  const positive = finiteNumber(migrated.receipts_positive_count);
  const total = finiteNumber(migrated.receipts_total_count);
  if (positive !== null && total !== null && positive > total) errors.push("receipts_positive_exceeds_total");

  return {
    ok: errors.length === 0,
    errors,
    record: migrated,
  };
}

export function normalizeStrategyRecord(record = {}) {
  const migrated = migrateStrategyRecord(record);
  for (const field of NUMERIC_FIELDS) {
    migrated[field] = finiteNumber(migrated[field]);
  }
  return migrated;
}

export function strategyRecordDedupeKey(record = {}) {
  return [
    record.chain || "unknown",
    record.protocol || "unknown",
    record.poolKey || "unknown",
    record.classKey || "unknown",
  ].join(":");
}

export function overfitPenaltyForBacktestQuality(backtestQuality = "paper_only") {
  return BACKTEST_QUALITY_OVERFIT_PENALTY[backtestQuality] ?? BACKTEST_QUALITY_OVERFIT_PENALTY.paper_only;
}
