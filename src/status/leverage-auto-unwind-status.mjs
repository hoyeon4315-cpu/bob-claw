// Leverage auto-unwind status combiner.
// Merges watcher runtime reports with signer audit records to produce
// the 4-state dashboard surface:
//   auto_unwind_ready  — watcher says breach detected
//   submitted          — emergency_unwind intent sent to signer
//   confirmed          — on-chain receipt confirmed
//   failed             — reverted or error after broadcast
//
// Pure function. No I/O.

export function buildLeverageAutoUnwindStatus({
  runtimeReports = [],
  auditRecords = [],
} = {}) {
  const byStrategy = new Map();

  for (const report of runtimeReports) {
    const sid = report?.strategy?.id || report?.strategyId || null;
    if (!sid) continue;
    const status = report?.runtime?.status || "unknown";
    byStrategy.set(sid, {
      strategyId: sid,
      watcherStatus: status,
      autoUnwindReady: status === "auto_unwind",
      submitted: false,
      confirmed: false,
      failed: false,
      lastTxHash: null,
      lastError: null,
    });
  }

  for (const record of auditRecords) {
    const intentType = record?.intent?.intentType || record?.intentType;
    if (intentType !== "emergency_unwind") continue;
    const sid = record?.strategyId || record?.intent?.strategyId;
    if (!sid) continue;
    const existing = byStrategy.get(sid) || {
      strategyId: sid,
      watcherStatus: null,
      autoUnwindReady: false,
      submitted: false,
      confirmed: false,
      failed: false,
      lastTxHash: null,
      lastError: null,
    };

    const stage = record?.lifecycle?.stage;
    if (stage === "signed" || stage === "broadcasted") {
      existing.submitted = true;
    }
    if (stage === "confirmed") {
      existing.confirmed = true;
      existing.lastTxHash = record?.lifecycle?.txHash || existing.lastTxHash;
    }
    if (stage === "reverted" || stage === "error" || record?.policyVerdict === "errored") {
      existing.failed = true;
      existing.lastError = record?.error?.message || record?.lifecycle?.error || null;
    }
    if (record?.broadcast?.txHash) {
      existing.lastTxHash = record.broadcast.txHash;
    }
    byStrategy.set(sid, existing);
  }

  const items = [...byStrategy.values()];
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    total: items.length,
    autoUnwindReadyCount: items.filter((i) => i.autoUnwindReady).length,
    submittedCount: items.filter((i) => i.submitted).length,
    confirmedCount: items.filter((i) => i.confirmed).length,
    failedCount: items.filter((i) => i.failed).length,
    items: Object.freeze(items.map(Object.freeze)),
  });
}
