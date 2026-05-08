export const RUNTIME_BLOCKER_CODES = Object.freeze([
  "missing_caps",
  "policy_reject",
  "kill_switch",
  "consecutive_failure_lock",
]);

function firstBlocker(blockers = []) {
  return Array.isArray(blockers) && blockers.length ? blockers[0] : null;
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
