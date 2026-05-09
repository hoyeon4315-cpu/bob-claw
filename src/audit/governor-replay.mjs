import { evaluateEvMarginFloor } from "../risk/ev-margin-floor.mjs";

const DEFAULT_SCOPED_STAGES = Object.freeze(["refill", "discovery_probe", "idle_consolidation_planned"]);

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function observedAt(record = {}) {
  return record.timestamp || record.observedAt || null;
}

function recentRecords(records = [], now, lookbackDays) {
  const nowMs = new Date(now).getTime();
  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  return records.filter((record) => {
    const ts = new Date(observedAt(record) || 0).getTime();
    return Number.isFinite(ts) && ts >= nowMs - lookbackMs;
  });
}

function lifecycleStage(record = {}) {
  return record.lifecycleStage || record.lifecycle?.stage || record.intent?.lifecycleStage || "unknown";
}

function gasEstimateUsd(record = {}) {
  return finite(record.intent?.gasEstimateUsd ?? record.gasEstimateUsd ?? record.metadata?.gasEstimateUsd);
}

function actualGasUsd(record = {}) {
  return finite(record.realized?.actualKnownCostUsd ?? record.execution?.actualKnownCostUsd) ?? 0;
}

function markdownTable(rows = []) {
  const lines = [
    "| strategyId | chain | lifecycleStage | wouldRejectCount | avoidableGasUsd | reasons |",
    "| --- | --- | --- | ---: | ---: | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.strategyId} | ${row.chain} | ${row.lifecycleStage} | ${row.wouldRejectCount} | ${row.avoidableGasUsd} | ${row.reasons.join(",")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function buildGovernorReplay({
  auditRecords = [],
  now = new Date().toISOString(),
  lookbackDays = 30,
  evMarginPolicy = undefined,
  dailyGasBudget = {
    enabled: true,
    scopedLifecycleStages: DEFAULT_SCOPED_STAGES,
    maxDailyGasUsd: null,
  },
} = {}) {
  const records = recentRecords(auditRecords, now, lookbackDays).filter((record) => record.broadcast?.txHash);
  const scopedStages = new Set(dailyGasBudget?.scopedLifecycleStages || DEFAULT_SCOPED_STAGES);
  const maxDailyGasUsd = Number(dailyGasBudget?.maxDailyGasUsd);
  const scopedDailyGasUsd = records
    .filter((record) => scopedStages.has(lifecycleStage(record)))
    .map(actualGasUsd)
    .reduce((sum, value) => sum + value, 0);
  const rows = [];
  for (const record of records) {
    const intent = {
      ...(record.intent || {}),
      strategyId: record.strategyId || record.intent?.strategyId,
      chain: record.chain || record.intent?.chain,
      lifecycleStage: lifecycleStage(record),
    };
    const ev = evaluateEvMarginFloor({
      expectedNetPnlUsd: intent.expectedNetUsd ?? intent.expectedNetPnlUsd,
      gasEstimateUsd: gasEstimateUsd(record),
      chain: intent.chain,
      route: intent.intentType,
      policy: evMarginPolicy,
    });
    const projectedDailyGasUsd = scopedDailyGasUsd + (gasEstimateUsd(record) ?? 0);
    const gasBudgetReject =
      dailyGasBudget?.enabled !== false &&
      scopedStages.has(lifecycleStage(record)) &&
      Number.isFinite(maxDailyGasUsd) &&
      projectedDailyGasUsd > maxDailyGasUsd;
    const reasons = [
      ...(ev.allow ? [] : [ev.reason]),
      ...(gasBudgetReject ? ["daily_gas_budget_exceeded"] : []),
    ].filter(Boolean);
    if (reasons.length === 0) continue;
    rows.push({
      strategyId: intent.strategyId || "unknown",
      chain: intent.chain || "unknown",
      lifecycleStage: lifecycleStage(record),
      reasons,
      avoidableGasUsd: actualGasUsd(record),
    });
  }

  const distribution = new Map();
  for (const row of rows) {
    const key = `${row.strategyId}|${row.chain}|${row.lifecycleStage}`;
    const current = distribution.get(key) || {
      strategyId: row.strategyId,
      chain: row.chain,
      lifecycleStage: row.lifecycleStage,
      wouldRejectCount: 0,
      avoidableGasUsd: 0,
      reasons: new Set(),
    };
    current.wouldRejectCount += 1;
    current.avoidableGasUsd += row.avoidableGasUsd;
    row.reasons.forEach((reason) => current.reasons.add(reason));
    distribution.set(key, current);
  }

  const affected = [...distribution.values()]
    .map((row) => ({
      ...row,
      avoidableGasUsd: Number(row.avoidableGasUsd.toFixed(6)),
      reasons: [...row.reasons].sort(),
    }))
    .sort((left, right) => right.avoidableGasUsd - left.avoidableGasUsd);

  const summary = {
    broadcastCount: records.length,
    wouldRejectCount: rows.length,
    avoidableGasUsd: Number(rows.reduce((sum, row) => sum + row.avoidableGasUsd, 0).toFixed(6)),
    affectedGroupCount: affected.length,
  };

  return {
    schemaVersion: 1,
    generatedAt: now,
    lookbackDays,
    summary,
    affected,
    markdown: markdownTable(affected),
  };
}
