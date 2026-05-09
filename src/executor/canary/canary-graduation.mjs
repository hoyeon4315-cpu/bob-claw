import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../../config/small-capital-campaign-mode.mjs";
import {
  strategyPauseResetFor,
  strategyPauseResetTimestamp,
} from "../../config/strategy-pause-state.mjs";

const DEFAULT_POLICY = SMALL_CAPITAL_CAMPAIGN_MODE.canaryGraduation;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function observedAt(record = {}) {
  return record.observedAt || record.timestamp || record.queueItem?.observedAt || null;
}

function observedAtMs(record = {}) {
  const parsed = new Date(observedAt(record) || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordStrategyId(record = {}) {
  return record.queueItem?.mappedStrategyId || record.mappedStrategyId || record.strategyId || record.intent?.strategyId || null;
}

function recordChain(record = {}) {
  return record.queueItem?.chain || record.chain || record.intent?.chain || null;
}

function recordProtocol(record = {}) {
  return record.queueItem?.protocolId || record.queueItem?.protocol || record.protocolId || record.protocol || record.intent?.protocol || null;
}

function recordOpportunityId(record = {}) {
  return record.queueItem?.opportunityId || record.opportunityId || record.intent?.opportunityId || record.metadata?.opportunityId || null;
}

function recordCampaignKey(record = {}) {
  return (
    record.queueItem?.campaignId ||
    record.queueItem?.campaignEndsAt ||
    record.campaignId ||
    record.campaignEndsAt ||
    recordOpportunityId(record) ||
    null
  );
}

function hasSentTx(record = {}) {
  return Boolean(
    record.txHash ||
      record.broadcast?.txHash ||
      record.broadcast?.hash ||
      record.execution?.txHash ||
      record.execution?.hash ||
      record.execution?.receipt?.transactionHash ||
      record.execution?.settlementStatus === "delivered" ||
      record.execution?.settlementStatus === "confirmed",
  );
}

function realizedNetUsd(record = {}) {
  return (
    finite(record.realized?.netUsd) ??
    finite(record.realized?.netPnLUsd) ??
    finite(record.realizedNetPnlUsd) ??
    finite(record.execution?.realized?.netUsd) ??
    null
  );
}

function isRejectedBeforeTx(record = {}) {
  const status = record.status || record.execution?.settlementStatus || null;
  const stage = record.lifecycle?.stage || null;
  const verdict = record.policyVerdict || null;
  return (
    (status === "rejected" || status === "blocked" || stage === "rejected" || verdict === "rejected") &&
    !hasSentTx(record)
  );
}

function isDelivered(record = {}) {
  const status = record.status || record.execution?.settlementStatus || record.lifecycle?.stage || null;
  return status === "delivered" || status === "confirmed";
}

function isSubstantiveFailure(record = {}) {
  const status = record.status || record.execution?.settlementStatus || record.lifecycle?.stage || null;
  if (status === "reverted" || status === "error" || status === "failed") return true;
  return Boolean(hasSentTx(record) && (status === "rejected" || record.policyVerdict === "errored"));
}

export function classifyCanaryOutcome(record = {}) {
  const netUsd = realizedNetUsd(record);
  if (isRejectedBeforeTx(record)) {
    return {
      kind: "no_tx_sent",
      countsAsSuccess: false,
      countsAsFailure: false,
      netUsd,
      observedAt: observedAt(record),
    };
  }
  if (Number.isFinite(netUsd) && netUsd < 0) {
    return {
      kind: "realized_negative",
      countsAsSuccess: false,
      countsAsFailure: true,
      netUsd,
      observedAt: observedAt(record),
    };
  }
  if (Number.isFinite(netUsd) && netUsd > 0) {
    return {
      kind: "realized_positive",
      countsAsSuccess: true,
      countsAsFailure: false,
      netUsd,
      observedAt: observedAt(record),
    };
  }
  if (isDelivered(record)) {
    return {
      kind: "tx_confirmed",
      countsAsSuccess: true,
      countsAsFailure: false,
      netUsd,
      observedAt: observedAt(record),
    };
  }
  if (isSubstantiveFailure(record)) {
    return {
      kind: "substantive_failure",
      countsAsSuccess: false,
      countsAsFailure: true,
      netUsd,
      observedAt: observedAt(record),
    };
  }
  return {
    kind: "ignored",
    countsAsSuccess: false,
    countsAsFailure: false,
    netUsd,
    observedAt: observedAt(record),
  };
}

function matchesQueueItem(record = {}, queueItem = {}) {
  const strategyId = queueItem.mappedStrategyId || queueItem.strategyId || null;
  const chain = queueItem.chain || null;
  const protocol = queueItem.protocolId || queueItem.protocol || null;
  if (strategyId && recordStrategyId(record) && recordStrategyId(record) !== strategyId) return false;
  if (chain && recordChain(record) && recordChain(record) !== chain) return false;
  if (protocol && recordProtocol(record) && recordProtocol(record) !== protocol) return false;
  return true;
}

function resetBoundaryForQueueItem(queueItem = {}) {
  const reset = strategyPauseResetFor(recordStrategyId({ queueItem }));
  const resetMs = strategyPauseResetTimestamp(reset);
  if (resetMs === null) return { reset: null, resetMs: null };
  return { reset, resetMs };
}

function isAfterResetBoundary(record = {}, resetMs = null) {
  if (resetMs === null) return true;
  return observedAtMs(record) > resetMs;
}

function normalizedPolicy(policy = DEFAULT_POLICY) {
  const candidate = policy || {};
  const rungs = Array.isArray(candidate.rungsUsd)
    ? candidate.rungsUsd.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  return {
    ...DEFAULT_POLICY,
    ...candidate,
    rungsUsd: rungs.length ? rungs : DEFAULT_POLICY.rungsUsd,
  };
}

function cappedRungUsd({ policy, rungIndex, chain }) {
  const rungs = policy.rungsUsd;
  const index = Math.max(0, Math.min(rungIndex, rungs.length - 1));
  const base = Number(rungs[index]);
  const chainFloor = chain === "ethereum" ? Number(policy.ethereumMinRungUsd || 0) : 0;
  const maxAuto = Number(policy.maxAutoGraduatedUsd || base);
  return Math.min(Math.max(base, chainFloor), maxAuto);
}

export function evaluateCanaryGraduation({
  queueItem = {},
  canaryExecutions = [],
  auditRecords = [],
  policy = DEFAULT_POLICY,
  now = new Date().toISOString(),
} = {}) {
  const p = normalizedPolicy(policy);
  const resetBoundary = resetBoundaryForQueueItem(queueItem);
  if (p.enabled === false) {
    return {
      status: "disabled",
      blockers: ["canary_graduation_disabled"],
      targetUsd: null,
      rungIndex: null,
      evidence: {},
    };
  }
  const records = [...canaryExecutions, ...auditRecords]
    .filter((record) => matchesQueueItem(record, queueItem))
    .filter((record) => isAfterResetBoundary(record, resetBoundary.resetMs));
  const outcomes = records.map((record) => ({
    record,
    outcome: classifyCanaryOutcome(record),
  }));
  const delivered = outcomes.filter(({ outcome }) => outcome.kind === "tx_confirmed" || outcome.kind === "realized_positive");
  const positiveRealized = outcomes.filter(({ outcome }) => outcome.kind === "realized_positive");
  const failures = outcomes.filter(({ outcome }) => outcome.countsAsFailure);
  const nowMs = new Date(now).getTime();
  const lossWindowMs = Number(p.realizedLossWindowMs ?? 24 * 60 * 60 * 1000);
  const cutoffMs = Number.isFinite(nowMs) && Number.isFinite(lossWindowMs) && lossWindowMs > 0
    ? nowMs - lossWindowMs
    : Number.NEGATIVE_INFINITY;
  const realizedLossUsd = outcomes
    .filter(({ record }) => observedAtMs(record) >= cutoffMs)
    .map(({ outcome }) => outcome.netUsd)
    .filter((value) => Number.isFinite(value) && value < 0)
    .reduce((sum, value) => sum + Math.abs(value), 0);
  const distinctWindows = new Set(
    positiveRealized
      .map(({ record }) => recordCampaignKey(record))
      .filter(Boolean),
  );

  const blockers = [];
  if (realizedLossUsd > Number(p.realizedDailyLossLockUsd)) blockers.push("canary_graduation_loss_lock");
  if (failures.length >= Number(p.maxSubstantiveFailures)) blockers.push("canary_graduation_failure_pause");

  let rungIndex = 0;
  if (delivered.length >= Number(p.minDeliveredForSecondRung)) rungIndex = 1;
  if (
    delivered.length >= Number(p.minDeliveredForThirdRung) &&
    positiveRealized.length >= Number(p.minPositiveRealizedForThirdRung)
  ) {
    rungIndex = 2;
  }
  if (
    positiveRealized.length >= Number(p.minPositiveRealizedForFourthRung) &&
    distinctWindows.size >= Number(p.minDistinctWindowsForFourthRung)
  ) {
    rungIndex = 3;
  }
  if (
    positiveRealized.length >= Number(p.minPositiveRealizedForFifthRung) &&
    distinctWindows.size >= Number(p.minDistinctWindowsForFifthRung)
  ) {
    rungIndex = 4;
  }

  return {
    status: blockers.length ? "blocked" : "ready",
    blockers,
    targetUsd: blockers.length ? null : cappedRungUsd({ policy: p, rungIndex, chain: queueItem.chain }),
    rungIndex: blockers.length ? null : rungIndex,
    evidence: {
      deliveredCount: delivered.length,
      positiveRealizedCount: positiveRealized.length,
      substantiveFailureCount: failures.length,
      noTxSentCount: outcomes.filter(({ outcome }) => outcome.kind === "no_tx_sent").length,
      distinctWindowCount: distinctWindows.size,
      realizedLossUsd,
      committedReset: resetBoundary.reset,
    },
  };
}
