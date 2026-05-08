const AUDIT_DRY_RUN_STAGES = new Set([
  "dry_run_recorded",
  "shadow_recorded",
  "simulated",
  "signed",
  "broadcasted",
  "confirmed",
]);

function observedAt(record = {}) {
  if (!record) return null;
  return record.timestamp || record.observedAt || record.lifecycle?.observedAt || null;
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function lifecycleStage(record = {}) {
  return record.lifecycle?.stage || record.stage || record.status || null;
}

function txHash(record = {}) {
  return record.broadcast?.txHash || record.lifecycle?.txHash || null;
}

function latestRecord(records = []) {
  return [...records]
    .filter((record) => timestampMs(observedAt(record)) !== null)
    .sort((left, right) => timestampMs(right.observedAt || right.timestamp || right.lifecycle?.observedAt) - timestampMs(left.observedAt || left.timestamp || left.lifecycle?.observedAt))[0] || null;
}

function existingReceiptCount(existingSummary = {}, dryRunReceipts = []) {
  if (Number.isFinite(existingSummary.dryRunReceiptCount)) return existingSummary.dryRunReceiptCount;
  if (Number.isFinite(existingSummary.runCount)) return existingSummary.runCount;
  return dryRunReceipts.length;
}

function existingLatestObservedAt(existingSummary = {}, dryRunReceipts = []) {
  if (existingSummary.latestDryRunObservedAt) return existingSummary.latestDryRunObservedAt;
  if (existingSummary.latestObservedAt) return existingSummary.latestObservedAt;
  const latest = latestRecord(dryRunReceipts);
  return observedAt(latest);
}

function existingFallbackSummary({ existingSummary = {}, dryRunReceipts = [] } = {}) {
  const dryRunReceiptCount = existingReceiptCount(existingSummary, dryRunReceipts);
  const latestDryRunObservedAt = existingLatestObservedAt(existingSummary, dryRunReceipts);
  return {
    ...existingSummary,
    runCount: existingSummary.runCount ?? dryRunReceiptCount,
    dryRunReceiptCount,
    latestDryRunObservedAt,
    source: existingSummary.source || "fixture_records",
    dryRunReceiptRecorded: existingSummary.dryRunReceiptRecorded === true || dryRunReceiptCount > 0,
  };
}

export function buildSliceDryRunSummary({
  strategyId,
  signerAuditRecords = [],
  dryRunReceipts = [],
  existingSummary = {},
} = {}) {
  const matched = (signerAuditRecords || []).filter((record) => record?.strategyId === strategyId);
  const dryRunRecords = matched.filter((record) => AUDIT_DRY_RUN_STAGES.has(lifecycleStage(record)));
  if (dryRunRecords.length === 0) {
    return existingFallbackSummary({ existingSummary, dryRunReceipts });
  }

  const signerBacked = dryRunRecords.filter((record) => txHash(record));
  const latest = latestRecord(dryRunRecords);
  const latestDryRunObservedAt = observedAt(latest);
  return {
    ...existingSummary,
    runCount: dryRunRecords.length,
    dryRunReceiptCount: dryRunRecords.length,
    passedCount: existingSummary.passedCount ?? 0,
    autoUnwindPassCount: existingSummary.autoUnwindPassCount ?? 0,
    signerBackedRunCount: signerBacked.length,
    latestObservedAt: latestDryRunObservedAt,
    latestDryRunObservedAt,
    latestRun: latest
      ? {
          runId: latest.intentId || latest.intentHash || null,
          scenarioId: existingSummary.latestRun?.scenarioId || null,
          result: existingSummary.latestRun?.result || null,
          executionMode: txHash(latest) ? "signer_audit" : "audit_lifecycle",
          watcherStatus: lifecycleStage(latest),
          txHash: txHash(latest),
        }
      : existingSummary.latestRun || null,
    dryRunReceiptRecorded: true,
    source: "signer_audit_log",
  };
}
