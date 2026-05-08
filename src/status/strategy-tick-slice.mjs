export const RUNTIME_BLOCKER_CODES = Object.freeze([
  "missing_caps",
  "policy_reject",
  "kill_switch",
  "consecutive_failure_lock",
]);

const BROADCAST_STAGES = new Set(["broadcast", "broadcasted", "confirmed", "reverted"]);
const SIGNER_AUDIT_STAGE_TIMESTAMPS = new Set(["broadcast", "broadcasted", "confirmed"]);
const MS_PER_DAY = 86_400_000;

function firstBlocker(blockers = []) {
  return Array.isArray(blockers) && blockers.length ? blockers[0] : null;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function timestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromMs(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function roundRatio(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function txHashForRecord(record = {}) {
  return record?.txHash ||
    record?.broadcast?.txHash ||
    record?.lifecycle?.txHash ||
    record?.receipt?.txHash ||
    null;
}

function timestampMsForRecord(record = {}) {
  return timestampMs(record?.timestamp) ??
    timestampMs(record?.observedAt) ??
    timestampMs(record?.confirmedAt) ??
    timestampMs(record?.broadcast?.observedAt) ??
    timestampMs(record?.lifecycle?.timestamp) ??
    timestampMs(record?.ts) ??
    (Number.isFinite(record?.tsMs) ? record.tsMs : null);
}

function broadcastStageForRecord(record = {}) {
  return record?.lifecycle?.stage ||
    record?.stage ||
    record?.broadcast?.stage ||
    null;
}

function isBroadcastReceipt(record = {}) {
  if (!txHashForRecord(record)) return false;
  if (record?.broadcast?.txHash) return true;
  const stage = broadcastStageForRecord(record);
  return BROADCAST_STAGES.has(stage);
}

export function realizedPnlSatsFromRecord(record = {}) {
  const candidates = [
    record?.realizedProfitSats,
    record?.realizedPnlSats,
    record?.realized?.realizedPnlSats,
    record?.realized?.realizedNetPnlSats,
    record?.realized?.realizedNetProfitSats,
    record?.realized?.realizedNetCarrySats,
    record?.realized?.netPnlSats,
    record?.receipt?.realized?.realizedNetPnlSats,
    record?.receiptIngest?.receiptRecord?.realized?.realizedNetPnlSats,
    record?.execution?.receiptIngest?.receiptRecord?.realized?.realizedNetPnlSats,
  ];
  const value = candidates.map(finiteNumber).find((candidate) => candidate !== null);
  return value === null || value === undefined ? 0 : Math.max(0, Math.floor(value));
}

function normalizedBroadcastReceipts(receipts = []) {
  return (Array.isArray(receipts) ? receipts : [])
    .map((record) => ({
      record,
      tsMs: timestampMsForRecord(record),
      txHash: txHashForRecord(record),
      stage: broadcastStageForRecord(record),
      realizedPnlSats: realizedPnlSatsFromRecord(record),
      broadcast: isBroadcastReceipt(record),
    }))
    .filter((receipt) => receipt.txHash && Number.isFinite(receipt.tsMs))
    .sort((a, b) => {
      if (a.tsMs !== b.tsMs) return a.tsMs - b.tsMs;
      return String(a.txHash).localeCompare(String(b.txHash));
    });
}

function sortedTickTimes(tickTimes = [], receipts = []) {
  const times = tickTimes
    .map((value) => Number.isFinite(value) ? value : timestampMs(value))
    .filter(Number.isFinite);
  if (times.length === 0) {
    for (const receipt of receipts) {
      if (Number.isFinite(receipt.tsMs)) times.push(receipt.tsMs);
    }
  }
  return [...new Set(times)].sort((a, b) => a - b);
}

function cumulativeRealizedAt(receipts = [], tickMs) {
  return receipts
    .filter((receipt) => Number.isFinite(receipt.tsMs) && receipt.tsMs <= tickMs)
    .reduce((sum, receipt) => sum + (Number(receipt.realizedPnlSats) || 0), 0);
}

function paybackTargetSats(realizedPnlSats, paybackBaseRatio) {
  const ratio = finiteNumber(paybackBaseRatio);
  return Math.max(0, Math.floor((Number(realizedPnlSats) || 0) * (ratio ?? 0)));
}

function progressRatioForTarget(targetSats, effectiveMinPaybackSats) {
  const minSats = finiteNumber(effectiveMinPaybackSats);
  if (!minSats || minSats <= 0) return null;
  return roundRatio(Math.min(1, Math.max(0, targetSats / minSats)));
}

export function buildStrategyBroadcastProgress({
  receipts = [],
  tickTimes = [],
  effectiveMinPaybackSats = 5_000,
  paybackBaseRatio = 0.20,
} = {}) {
  const normalized = normalizedBroadcastReceipts(receipts);
  const broadcasts = normalized.filter((receipt) => receipt.broadcast);
  const firstBroadcast = broadcasts[0] || null;
  const firstRealized = normalized.find((receipt) => receipt.realizedPnlSats > 0) || null;
  const lastSignerAuditStage = normalized
    .filter((receipt) => SIGNER_AUDIT_STAGE_TIMESTAMPS.has(receipt.stage))
    .at(-1) || null;
  const checkpoints = sortedTickTimes(tickTimes, normalized).slice(-7);
  let paybackEffectiveMinReachedAt = null;
  const paybackProgressTrajectory = checkpoints.map((tickMs) => {
    const realizedPnlSats = cumulativeRealizedAt(normalized, tickMs);
    const targetSats = paybackTargetSats(realizedPnlSats, paybackBaseRatio);
    const progressRatio = progressRatioForTarget(targetSats, effectiveMinPaybackSats);
    if (!paybackEffectiveMinReachedAt && progressRatio !== null && progressRatio >= 1) {
      paybackEffectiveMinReachedAt = isoFromMs(tickMs);
    }
    return Object.freeze({
      tickAt: isoFromMs(tickMs),
      realizedPnlSats,
      paybackTargetSats: targetSats,
      progressRatio,
    });
  });

  return Object.freeze({
    firstLiveBroadcastAt: isoFromMs(firstBroadcast?.tsMs),
    firstLiveBroadcastTxHash: firstBroadcast?.txHash || null,
    firstRealizedPnlSats: firstRealized?.realizedPnlSats ?? null,
    paybackEffectiveMinReachedAt,
    lastSignerAuditStage: lastSignerAuditStage?.stage || null,
    lastSignerAuditStageAt: isoFromMs(lastSignerAuditStage?.tsMs),
    paybackProgressTrajectory,
  });
}

function estimateNextDeliveryCandidateEta({
  firstBroadcast = null,
  paybackTargetSatsSinceFirst = 0,
  effectiveMinPaybackSats = 5_000,
  paybackEffectiveMinReachedAt = null,
  nowMs = Date.now(),
} = {}) {
  if (paybackEffectiveMinReachedAt) return paybackEffectiveMinReachedAt;
  const minSats = finiteNumber(effectiveMinPaybackSats);
  const targetSats = finiteNumber(paybackTargetSatsSinceFirst);
  if (!firstBroadcast || !minSats || minSats <= 0 || targetSats === null || targetSats <= 0) return null;
  const elapsedDays = Math.max(0, ((Number(nowMs) || Date.now()) - firstBroadcast.tsMs) / MS_PER_DAY);
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return null;
  const averageTargetSatsPerDay = targetSats / elapsedDays;
  if (!Number.isFinite(averageTargetSatsPerDay) || averageTargetSatsPerDay <= 0) return null;
  const remainingSats = Math.max(0, minSats - targetSats);
  return isoFromMs((Number(nowMs) || Date.now()) + (remainingSats / averageTargetSatsPerDay) * MS_PER_DAY);
}

export function buildOverallBroadcastProgress({
  receipts = [],
  tickTimes = [],
  effectiveMinPaybackSats = 5_000,
  paybackBaseRatio = 0.20,
  nowMs = Date.now(),
} = {}) {
  const normalized = normalizedBroadcastReceipts(receipts);
  const broadcasts = normalized.filter((receipt) => receipt.broadcast);
  const firstBroadcast = broadcasts[0] || null;
  const latestBroadcast = broadcasts.at(-1) || null;
  const sinceFirst = firstBroadcast
    ? normalized.filter((receipt) => receipt.tsMs >= firstBroadcast.tsMs)
    : [];
  const satsSinceFirstBroadcast = sinceFirst.reduce((sum, receipt) => sum + receipt.realizedPnlSats, 0);
  const paybackTargetSatsSinceFirst = paybackTargetSats(satsSinceFirstBroadcast, paybackBaseRatio);
  const checkpoints = sortedTickTimes(tickTimes, normalized);
  let paybackEffectiveMinReachedAt = null;
  for (const tickMs of checkpoints) {
    const realizedPnlSats = firstBroadcast
      ? normalized
          .filter((receipt) => receipt.tsMs >= firstBroadcast.tsMs)
          .filter((receipt) => receipt.tsMs <= tickMs)
          .reduce((sum, receipt) => sum + receipt.realizedPnlSats, 0)
      : 0;
    const targetSats = paybackTargetSats(realizedPnlSats, paybackBaseRatio);
    const ratio = progressRatioForTarget(targetSats, effectiveMinPaybackSats);
    if (ratio !== null && ratio >= 1) {
      paybackEffectiveMinReachedAt = isoFromMs(tickMs);
      break;
    }
  }

  return Object.freeze({
    latestBroadcastAt: isoFromMs(latestBroadcast?.tsMs),
    satsSinceFirstBroadcast,
    daysSinceFirstBroadcast: firstBroadcast
      ? roundRatio(Math.max(0, ((Number(nowMs) || Date.now()) - firstBroadcast.tsMs) / MS_PER_DAY))
      : null,
    paybackEffectiveMinReachedAt,
    nextDeliveryCandidateEta: estimateNextDeliveryCandidateEta({
      firstBroadcast,
      paybackTargetSatsSinceFirst,
      effectiveMinPaybackSats,
      paybackEffectiveMinReachedAt,
      nowMs,
    }),
  });
}

function normalizeAdviceFields(report = null, tickBlockers = []) {
  const fields = [];
  if (report?.topBlocker) fields.push("reportSummaries.topBlocker");
  if (report?.blockerCount > 0) fields.push("reportSummaries.blockerCount");
  if (tickBlockers.length) fields.push("blockers.blockers");
  if (report && "liveReady" in report) fields.push("reportSummaries.liveReady");
  return fields.length ? fields : ["reporting_only_surface"];
}

export function buildSurfaceAdvice({ report = null, tickBlockers = [] } = {}) {
  const adviceCode = report?.topBlocker || firstBlocker(tickBlockers);
  const liveEligible = report
    ? report.liveReady === true && Number(report.blockerCount ?? 0) === 0 && !adviceCode
    : tickBlockers.length === 0;
  return Object.freeze({
    liveEligible,
    adviceCode: adviceCode || null,
    adviceFields: normalizeAdviceFields(report, tickBlockers),
    adviceAuthority: "commit_time_guard",
  });
}

export function runtimeBlockerFor({
  capsConfigured,
  policyOk,
  killSwitchSet = false,
  consecutiveFailureLock = false,
} = {}) {
  if (capsConfigured !== true) return "missing_caps";
  if (killSwitchSet === true) return "kill_switch";
  if (consecutiveFailureLock === true) return "consecutive_failure_lock";
  if (policyOk !== true) return "policy_reject";
  return null;
}

export function buildLayerStatus({
  tickPresent = false,
  tickReason = null,
  autoExecute = false,
  capsConfigured = false,
  policyOk = false,
  killSwitchSet = false,
  consecutiveFailureLock = false,
  surfaceAdvice = null,
  intentCount = 0,
  broadcastTxHash = null,
} = {}) {
  const runtimeBlocker = runtimeBlockerFor({
    capsConfigured,
    policyOk,
    killSwitchSet,
    consecutiveFailureLock,
  });
  const runtimeExecutable =
    autoExecute === true &&
    capsConfigured === true &&
    policyOk === true &&
    killSwitchSet !== true &&
    consecutiveFailureLock !== true;
  const intentEmitted = Number(intentCount) > 0;
  return Object.freeze({
    tick: tickPresent && !tickReason ? "pass" : "block",
    tickReason: tickReason || null,
    runtimeExecutable,
    runtimeBlocker: runtimeExecutable ? null : runtimeBlocker,
    surfaceAdvice: surfaceAdvice || buildSurfaceAdvice(),
    intentEmitted,
    intentCount: Number(intentCount) || 0,
    broadcastSent: Boolean(broadcastTxHash),
    txHash: broadcastTxHash || null,
  });
}

export function buildFunnelSummary(strategyRows = []) {
  const rows = Array.isArray(strategyRows) ? strategyRows : [];
  return Object.freeze({
    tickPassCount: rows.filter((row) => row.layerStatus?.tick === "pass").length,
    runtimeExecutableCount: rows.filter((row) => row.layerStatus?.runtimeExecutable === true).length,
    intentEmittedCount: rows.filter((row) => row.layerStatus?.intentEmitted === true).length,
    broadcastSentCount: rows.filter((row) => row.layerStatus?.broadcastSent === true).length,
    surfaceAdviceBlockedCount: rows.filter((row) => row.layerStatus?.surfaceAdvice?.liveEligible === false).length,
  });
}
