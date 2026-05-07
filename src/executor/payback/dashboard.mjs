import { join } from "node:path";
import snapshotPaybackAccumulator, { profitSatsFromRecord } from "./accumulator.mjs";
import { GATEWAY_BTC_OFFRAMP_STRATEGY_ID } from "../helpers/gateway-btc-offramp.mjs";
import { loadLivePaybackReceiptStore, loadPaybackAuditLog } from "../ingestor/execution-receipt-ingest.mjs";
import { buildPaybackDecision, buildPreMinimumPaybackCostPreview } from "./scheduler.mjs";
import { PAYBACK_CONFIG } from "../../config/payback.mjs";
import { ACTIVE_SLEEVE_PROFILE_ID, SLEEVE_PROFILES, resolveSleeveProfile } from "../../config/sleeve-profile.mjs";
import { listStrategyCaps, resolveStrategyCapMatrix } from "../../config/strategy-caps.mjs";
import {
  filterRecordsByReportingPnlBaseline,
  readReportingPnlBaseline,
  summarizeReportingPnlBaseline,
} from "../../status/reporting-pnl-baseline.mjs";
import { writeTextIfChanged } from "../../lib/file-write.mjs";

const PREVIEW_BTC_DESTINATION = "bc1qpayback0000000000000000000000000000000";
const DAY_MS = 24 * 60 * 60 * 1000;
const PAYBACK_FORECAST_WINDOW_DAYS = 30;
// PAYBACK_CONFIG currently commits a weekly Monday scheduler, so period forecasts stay week-based.
const PAYBACK_FORECAST_PERIOD_DAYS = 7;
const PROPOSED_MIN_PAYBACK_SATS = 5_000;
const PROPOSED_MIN_PAYBACK_PATCH_RELATIVE_PATH = "data/payback/proposed-min-payback-diff.patch";

function isMissingDestinationDecision(decision = null) {
  return (
    decision?.reason === "payback_btc_destination_missing" ||
    decision?.reason === "missing_destination_config" ||
    decision?.decisionLog?.inputs?.underlyingReason === "payback_btc_destination_missing"
  );
}

function isMissingReserveDecision(decision = null) {
  return decision?.reason === "reserve_asset_missing";
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function finiteNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeRecords(items = []) {
  return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
}

function readPath(target, path) {
  if (!target || typeof target !== "object") return undefined;
  return path.split(".").reduce((value, segment) => (value == null ? undefined : value[segment]), target);
}

function firstPresent(target, paths = []) {
  for (const path of paths) {
    const value = readPath(target, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function firstFinite(target, paths = []) {
  for (const path of paths) {
    const value = finiteNumber(readPath(target, path));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function buildMinimumGapMetrics(grossTargetBeforeCostsSats, minPaybackSats) {
  if (!Number.isFinite(grossTargetBeforeCostsSats) || !Number.isFinite(minPaybackSats) || minPaybackSats <= 0) {
    return {
      satsToMinimumPayback: null,
      progressToMinimumRatio: null,
    };
  }
  return {
    satsToMinimumPayback: Math.max(0, Math.round(minPaybackSats - grossTargetBeforeCostsSats)),
    progressToMinimumRatio: Math.max(0, Math.min(1, grossTargetBeforeCostsSats / minPaybackSats)),
  };
}

function laterTimestampMs(...values) {
  const timestamps = values.map(normalizeTimestamp).filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function isoTimestamp(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function scaleRatio(baseValue, scaledValue) {
  if (!Number.isFinite(baseValue) || !(baseValue > 0) || !Number.isFinite(scaledValue) || !(scaledValue > 0)) {
    return null;
  }
  return scaledValue / baseValue;
}

function forecastReceiptStore(receiptStore = {}, reportingPnlBaseline = null) {
  if (!receiptStore || typeof receiptStore !== "object") return {};
  const scoped = { ...receiptStore };
  for (const key of ["receiptReconciliations", "wrappedBtcLoopReceipts", "wrappedBtcLoopLiveProofs"]) {
    if (!Array.isArray(scoped[key])) continue;
    scoped[key] = filterRecordsByReportingPnlBaseline(scoped[key], reportingPnlBaseline);
  }
  return scoped;
}

function nonBtcAutoExecuteStrategies() {
  return listStrategyCaps().filter(
    (strategy) => strategy?.autoExecute === true && strategy?.exposure?.btcDenominated !== true,
  );
}

function effectiveProfileSettlementTargetUsd(strategy = {}, chain, profileId) {
  const resolvedCaps = resolveStrategyCapMatrix(strategy, { profileId });
  const profileCapital = resolveSleeveProfile(profileId)?.capital || {};
  const perChainUsd = finiteNumber(resolvedCaps?.perChainUsd?.[chain]);
  if (perChainUsd === 0) return 0;
  const liveUnitUsd = finiteNumber(resolvedCaps?.tinyLivePerTxUsd) ?? finiteNumber(resolvedCaps?.perTxUsd);
  const candidates = [
    perChainUsd,
    liveUnitUsd,
    finiteNumber(profileCapital?.canaryStartUsdMax),
    finiteNumber(profileCapital?.maxIdleCapitalPerChainUsd),
  ].filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length > 0 ? Math.min(...candidates) : 0;
}

function profileSettlementTargetUsd(profileId) {
  const byChain = new Map();
  for (const strategy of nonBtcAutoExecuteStrategies()) {
    const chainKeys = Object.keys(strategy?.caps?.perChainUsd || {}).filter((chain) => chain !== "default");
    for (const chain of chainKeys) {
      byChain.set(
        chain,
        Math.max(byChain.get(chain) || 0, effectiveProfileSettlementTargetUsd(strategy, chain, profileId)),
      );
    }
  }
  return [...byChain.values()].reduce((sum, value) => sum + value, 0);
}

function observedPeriodCount(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 1;
  return Math.max(1, (endMs - startMs) / (PAYBACK_FORECAST_PERIOD_DAYS * DAY_MS));
}

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function recordsFromForecastStore(auditLogLines = [], receiptStore = {}) {
  return [
    ...normalizeRecords(auditLogLines),
    ...Object.entries(receiptStore || {})
      .filter(([key, value]) => Array.isArray(value) && key !== "marketPriceSnapshots" && key !== "priceSnapshots")
      .flatMap(([, value]) => normalizeRecords(value)),
  ];
}

function buildRealizedProfitPeriodDistribution({
  auditLogLines = [],
  receiptStore = {},
  marketPriceSnapshots = [],
  windowStartMs,
  nowMs,
} = {}) {
  const periodMs = PAYBACK_FORECAST_PERIOD_DAYS * DAY_MS;
  const periodBuckets = new Map();
  for (const record of recordsFromForecastStore(auditLogLines, receiptStore)) {
    const observedAtMs = normalizeTimestamp(
      record.observedAt ??
      record.timestamp ??
      record.createdAt ??
      record.receipt?.observedAt ??
      record.realized?.observedAt,
    );
    if (!Number.isFinite(observedAtMs) || !Number.isFinite(windowStartMs) || !Number.isFinite(nowMs)) continue;
    if (observedAtMs < windowStartMs || observedAtMs > nowMs) continue;
    const profitSats = profitSatsFromRecord(record, marketPriceSnapshots, {});
    if (!Number.isFinite(profitSats)) continue;
    const periodIndex = Math.max(0, Math.floor((observedAtMs - windowStartMs) / periodMs));
    periodBuckets.set(periodIndex, (periodBuckets.get(periodIndex) || 0) + profitSats);
  }
  const periodTotals = [...periodBuckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value);
  return {
    sampleCount: periodTotals.length,
    medianSatsPerPeriod: median(periodTotals),
    periodTotalsSats: periodTotals.map((value) => round(value, 2)),
  };
}

function buildEstimatedPeriodsToFirstPayback({
  now,
  minimumProgress = null,
  auditLogLines = [],
  receiptStore = {},
  reportingPnlBaseline = null,
} = {}) {
  const nowMs = normalizeTimestamp(now);
  const rollingWindowStartMs =
    Number.isFinite(nowMs) ? nowMs - (PAYBACK_FORECAST_WINDOW_DAYS * DAY_MS) : null;
  const scopedWindowStartMs = laterTimestampMs(rollingWindowStartMs, reportingPnlBaseline?.anchoredAt);
  const scopedAuditLogLines = filterRecordsByReportingPnlBaseline(auditLogLines, reportingPnlBaseline);
  const scopedReceiptStore = forecastReceiptStore(receiptStore, reportingPnlBaseline);
  const scopedPeriodStartAt = isoTimestamp(scopedWindowStartMs);
  const forecastSnapshot = snapshotPaybackAccumulator(scopedAuditLogLines, scopedReceiptStore, {
    paybackStrategyIds: [GATEWAY_BTC_OFFRAMP_STRATEGY_ID],
    paybackIntentTypes: ["gateway_btc_offramp"],
    periodId: "rolling_payback_forecast",
    periodStartAt: scopedPeriodStartAt,
    periodEndAt: now,
  });
  const requiredGrossProfitSats = finiteNumber(minimumProgress?.requiredGrossProfitSats);
  const realizedGrossProfitSatsWindow = finiteNumber(forecastSnapshot?.grossProfitSats_period) ?? 0;
  const periodsObserved = observedPeriodCount(scopedWindowStartMs, nowMs);
  const realizedGrossProfitSatsPerPeriod =
    realizedGrossProfitSatsWindow > 0 ? realizedGrossProfitSatsWindow / periodsObserved : 0;
  const realizedPeriodDistribution = buildRealizedProfitPeriodDistribution({
    auditLogLines: scopedAuditLogLines,
    receiptStore: scopedReceiptStore,
    marketPriceSnapshots: scopedReceiptStore.marketPriceSnapshots || [],
    windowStartMs: scopedWindowStartMs,
    nowMs,
  });
  const realizedGrossProfitSatsPeriodMedian =
    Number.isFinite(realizedPeriodDistribution.medianSatsPerPeriod)
      ? realizedPeriodDistribution.medianSatsPerPeriod
      : null;
  const activeProfileBudgetUsd = profileSettlementTargetUsd(ACTIVE_SLEEVE_PROFILE_ID);
  const baselineApplied =
    Number.isFinite(reportingPnlBaseline?.anchoredAtMs) &&
    (!Number.isFinite(rollingWindowStartMs) || reportingPnlBaseline.anchoredAtMs > rollingWindowStartMs);
  const profiles = Object.fromEntries(
    Object.keys(SLEEVE_PROFILES).map((profileId) => {
      const profileBudgetUsd = profileSettlementTargetUsd(profileId);
      const scalingRatio = scaleRatio(activeProfileBudgetUsd, profileBudgetUsd) ?? (profileId === ACTIVE_SLEEVE_PROFILE_ID ? 1 : null);
      const projectedGrossProfitSatsPerPeriod =
        realizedGrossProfitSatsPerPeriod > 0 && Number.isFinite(scalingRatio)
          ? realizedGrossProfitSatsPerPeriod * scalingRatio
          : null;
      const projectedMedianGrossProfitSatsPerPeriod =
        realizedGrossProfitSatsPeriodMedian > 0 && Number.isFinite(scalingRatio)
          ? realizedGrossProfitSatsPeriodMedian * scalingRatio
          : null;
      let status = "estimated";
      let reason = null;
      let estimatedPeriods = null;
      let medianEstimatedPeriods = null;
      if (!(requiredGrossProfitSats > 0)) {
        status = "unavailable";
        reason = "required_gross_profit_unknown";
      } else if (!(realizedGrossProfitSatsPerPeriod > 0)) {
        status = "unavailable";
        reason = "non_positive_realized_run_rate";
      } else if (!(projectedGrossProfitSatsPerPeriod > 0)) {
        status = "unavailable";
        reason = "profile_budget_unresolved";
      } else {
        estimatedPeriods = round(requiredGrossProfitSats / projectedGrossProfitSatsPerPeriod, 2);
        medianEstimatedPeriods = projectedMedianGrossProfitSatsPerPeriod > 0
          ? round(requiredGrossProfitSats / projectedMedianGrossProfitSatsPerPeriod, 2)
          : null;
      }
      return [
        profileId,
        {
          status,
          reason,
          estimatedPeriods,
          medianEstimatedPeriods,
          scalingRatio: round(scalingRatio, 4),
          profileSettlementTargetUsd: round(profileBudgetUsd, 2),
          projectedGrossProfitSatsPerPeriod: round(projectedGrossProfitSatsPerPeriod, 2),
          projectedMedianGrossProfitSatsPerPeriod: round(projectedMedianGrossProfitSatsPerPeriod, 2),
        },
      ];
    }),
  );
  return {
    windowDays: PAYBACK_FORECAST_WINDOW_DAYS,
    periodDays: PAYBACK_FORECAST_PERIOD_DAYS,
    schedulerCronExpression: PAYBACK_CONFIG.cronExpression,
    activeProfileId: ACTIVE_SLEEVE_PROFILE_ID,
    requiredGrossProfitSats,
    rollingWindowStartAt: scopedPeriodStartAt,
    rollingWindowEndAt: now,
    realizedGrossProfitSatsWindow,
    realizedGrossProfitSatsPerPeriod: round(realizedGrossProfitSatsPerPeriod, 2),
    realizedGrossProfitSatsPeriodMedian: round(realizedGrossProfitSatsPeriodMedian, 2),
    realizedGrossProfitPeriodSampleCount: realizedPeriodDistribution.sampleCount,
    realizedGrossProfitPeriodTotalsSats: realizedPeriodDistribution.periodTotalsSats,
    observedPeriods: round(periodsObserved, 2),
    reportingBaseline: summarizeReportingPnlBaseline(reportingPnlBaseline, {
      now,
      applied: baselineApplied,
    }),
    profiles,
  };
}

function requiredGrossProfitSats({ minPaybackSats, baseRatio, regimeMultiplier, volMultiplier }) {
  if (
    !Number.isFinite(minPaybackSats) ||
    !Number.isFinite(baseRatio) ||
    !Number.isFinite(regimeMultiplier) ||
    !Number.isFinite(volMultiplier)
  ) {
    return null;
  }
  const appliedMultiplier = baseRatio * regimeMultiplier * volMultiplier;
  if (!(appliedMultiplier > 0)) return null;
  return Math.ceil(minPaybackSats / appliedMultiplier);
}

const MIN_PAYBACK_PROPOSAL_PROFILE_IDS = ["smallCapital_v1", "aggressive_v1"];

function minPaybackProposalTrigger(estimatedPeriodsToFirstPayback = null) {
  const profiles = estimatedPeriodsToFirstPayback?.profiles || {};
  const profileIds = MIN_PAYBACK_PROPOSAL_PROFILE_IDS;
  const allAboveThreshold = profileIds.every((profileId) => {
    const estimate = profiles[profileId];
    const forecastPeriods = Number.isFinite(estimate?.medianEstimatedPeriods)
      ? estimate.medianEstimatedPeriods
      : estimate?.estimatedPeriods;
    return Number.isFinite(forecastPeriods) && forecastPeriods >= 8;
  });
  if (allAboveThreshold) return "both_profiles_above_threshold";
  const allNonPositiveRunRate = profileIds.every((profileId) => {
    const estimate = profiles[profileId];
    return estimate?.reason === "non_positive_realized_run_rate";
  });
  // A non-positive realized run rate means projected periods to first payback
  // is unbounded, which trivially exceeds the eight-period proposal threshold.
  // The patch is a PR draft for operator review, never a runtime change, so
  // surfacing it here keeps the floor visible in dashboard while AGENTS.md's
  // committed-config rule still gates any actual change.
  if (allNonPositiveRunRate) return "both_profiles_non_positive_run_rate";
  return null;
}

function shouldProposeMinPaybackPatch(estimatedPeriodsToFirstPayback = null) {
  return Boolean(minPaybackProposalTrigger(estimatedPeriodsToFirstPayback));
}

function buildMinimumPaybackReview({
  estimatedPeriodsToFirstPayback = null,
  proposedMinPaybackPatch = null,
  proposalTrigger = null,
} = {}) {
  const profiles = estimatedPeriodsToFirstPayback?.profiles || {};
  const profileIds = MIN_PAYBACK_PROPOSAL_PROFILE_IDS;
  const profileSummaries = Object.fromEntries(
    profileIds.map((profileId) => {
      const estimate = profiles[profileId] || {};
      return [
        profileId,
        {
          status: estimate.status || "unavailable",
          reason: estimate.reason || null,
          estimatedPeriods: Number.isFinite(estimate.estimatedPeriods) ? estimate.estimatedPeriods : null,
          medianEstimatedPeriods: Number.isFinite(estimate.medianEstimatedPeriods) ? estimate.medianEstimatedPeriods : null,
        },
      ];
    }),
  );
  const resolvedTrigger = proposalTrigger || minPaybackProposalTrigger(estimatedPeriodsToFirstPayback);
  if (proposedMinPaybackPatch) {
    return {
      status: "propose_patch",
      reason: resolvedTrigger || "both_profiles_above_threshold",
      thresholdPeriods: 8,
      currentMinPaybackSats: PAYBACK_CONFIG.minPaybackSats,
      proposedMinPaybackSats: PROPOSED_MIN_PAYBACK_SATS,
      proposedPatchPath: proposedMinPaybackPatch,
      profiles: profileSummaries,
    };
  }

  const profileReasons = profileIds
    .map((profileId) => profileSummaries[profileId]?.reason)
    .filter(Boolean);
  const estimatedWithinThresholdProfiles = profileIds.filter((profileId) => {
    const periods = profileSummaries[profileId]?.estimatedPeriods;
    return Number.isFinite(periods) && periods < 8;
  });
  let reason = "forecast_unavailable";
  if (
    profileReasons.length > 0 &&
    profileReasons.every((profileReason) => profileReason === "non_positive_realized_run_rate")
  ) {
    reason = "non_positive_realized_run_rate";
  } else if (estimatedWithinThresholdProfiles.length > 0) {
    reason = "forecast_within_threshold";
  }
  return {
    status: "keep_current",
    reason,
    thresholdPeriods: 8,
    currentMinPaybackSats: PAYBACK_CONFIG.minPaybackSats,
    proposedMinPaybackSats: null,
    proposedPatchPath: null,
    profiles: profileSummaries,
  };
}

const MIN_PAYBACK_PROPOSAL_RATIONALE = Object.freeze({
  both_profiles_above_threshold:
    "both committed sleeve profiles forecast at least eight periods to first payback at current capital",
  both_profiles_non_positive_run_rate:
    "both committed sleeve profiles report a non-positive realized run rate, so projected periods are unbounded",
});

export function buildProposedMinPaybackPatch({
  currentMinPaybackSats = PAYBACK_CONFIG.minPaybackSats,
  proposedMinPaybackSats = PROPOSED_MIN_PAYBACK_SATS,
  trigger = "both_profiles_above_threshold",
} = {}) {
  const rationale = MIN_PAYBACK_PROPOSAL_RATIONALE[trigger] || MIN_PAYBACK_PROPOSAL_RATIONALE.both_profiles_above_threshold;
  return [
    `# Trigger: ${trigger}`,
    `# Rationale: ${rationale}`,
    "# Note: PR draft only. Per AGENTS.md, payback ratio/timing changes require",
    "# a committed config diff with rationale in docs/research/payback-rationale.md.",
    "diff --git a/src/config/payback.mjs b/src/config/payback.mjs",
    "--- a/src/config/payback.mjs",
    "+++ b/src/config/payback.mjs",
    "@@",
    `-  minPaybackSats: ${currentMinPaybackSats.toLocaleString("en-US").replace(/,/g, "_")}, // ~= 0.0005 BTC`,
    `+  minPaybackSats: ${proposedMinPaybackSats.toLocaleString("en-US").replace(/,/g, "_")}, // PR candidate: lower bookkeeping floor`,
    "",
  ].join("\n");
}

async function maybeWriteProposedMinPaybackPatch({
  dataDir = null,
  estimatedPeriodsToFirstPayback = null,
} = {}) {
  if (!dataDir) return { path: null, trigger: null };
  const trigger = minPaybackProposalTrigger(estimatedPeriodsToFirstPayback);
  if (!trigger) return { path: null, trigger: null };
  const patchPath = join(dataDir, "payback", "proposed-min-payback-diff.patch");
  const patchContents = buildProposedMinPaybackPatch({ trigger });
  await writeTextIfChanged(patchPath, patchContents);
  return { path: PROPOSED_MIN_PAYBACK_PATCH_RELATIVE_PATH, trigger };
}

function minimumPaybackProgress(decision, { source = null } = {}) {
  if (!decision || typeof decision !== "object") return null;
  const grossTargetBeforeCostsSats = firstFinite(decision, [
    "decisionLog.inputs.grossTargetBeforeCostsSats",
    "decisionLog.applied.grossTargetBeforeCostsSats",
  ]);
  const minPaybackSats = firstFinite(decision, [
    "decisionLog.inputs.minPaybackSats",
    "policy.minPaybackSats",
  ]);
  const baseRatio = firstFinite(decision, [
    "decisionLog.inputs.baseRatio",
    "decisionLog.applied.baseRatio",
    "policy.baseRatio",
  ]);
  const regimeMultiplier = firstFinite(decision, [
    "decisionLog.inputs.regimeMultiplier",
    "decisionLog.applied.regimeMultiplier",
  ]);
  const volMultiplier = firstFinite(decision, [
    "decisionLog.inputs.volMultiplier",
    "decisionLog.applied.volMultiplier",
  ]);
  const gapMetrics = buildMinimumGapMetrics(grossTargetBeforeCostsSats, minPaybackSats);
  const grossProfitRequiredSats = requiredGrossProfitSats({
    minPaybackSats,
    baseRatio,
    regimeMultiplier,
    volMultiplier,
  });
  if (
    !Number.isFinite(grossTargetBeforeCostsSats) &&
    !Number.isFinite(minPaybackSats) &&
    !Number.isFinite(gapMetrics.satsToMinimumPayback) &&
    !Number.isFinite(grossProfitRequiredSats)
  ) {
    return null;
  }
  return {
    source,
    status: decision.status || null,
    reason: decision.reason || null,
    grossProfitSatsPeriod: firstFinite(decision, [
      "decisionLog.inputs.grossProfitSatsPeriod",
      "snapshot.grossProfitSats_period",
    ]),
    requiredGrossProfitSats: grossProfitRequiredSats,
    grossTargetBeforeCostsSats,
    minPaybackSats,
    satsToMinimumPayback: gapMetrics.satsToMinimumPayback,
    progressToMinimumRatio: gapMetrics.progressToMinimumRatio,
  };
}

function allRecordsForPayback(auditLogLines = [], receiptStore = {}) {
  return [
    ...normalizeRecords(auditLogLines),
    ...Object.values(receiptStore).filter(Array.isArray).flatMap((items) => normalizeRecords(items)),
  ];
}

function threeWayPaybackReceipt(record) {
  return {
    sourceTxHash: firstPresent(record, [
      "signerResult.broadcast.txHash",
      "broadcast.txHash",
      "receipt.hash",
      "txHash",
    ]),
    gatewayOrderId: firstPresent(record, [
      "metadata.gatewayOrderId",
      "plan.intent.metadata.gatewayOrderId",
      "plan.order.orderId",
      "order.orderId",
      "gatewayOrderId",
    ]),
    bitcoinTxid: firstPresent(record, [
      "destinationProof.txid",
      "destinationProof.bitcoinTxid",
      "metadata.bitcoinTxid",
      "payback.bitcoinTxid",
      "bitcoinTxid",
    ]),
  };
}

function paybackSettlementTimestamp(record) {
  return firstPresent(record, [
    "destinationProof.observedAt",
    "settledAt",
    "observedAt",
  ]);
}

function deliveredPaybackRecord(records = []) {
  let winner = null;
  let winnerMs = -1;
  for (const record of records) {
    const strategyId =
      record?.strategyId ??
      record?.plan?.strategyId ??
      record?.intent?.strategyId ??
      record?.signerResult?.signed?.strategyId ??
      null;
    const intentType =
      record?.intent?.intentType ??
      record?.plan?.intent?.intentType ??
      null;
    if (strategyId !== GATEWAY_BTC_OFFRAMP_STRATEGY_ID && intentType !== "gateway_btc_offramp") continue;
    if (record?.settlementStatus !== "delivered" && record?.destinationProof?.status !== "delivered") continue;
    const receipt = threeWayPaybackReceipt(record);
    if (!receipt.sourceTxHash || !receipt.gatewayOrderId || !receipt.bitcoinTxid) continue;
    const observedAtMs = normalizeTimestamp(paybackSettlementTimestamp(record));
    if (observedAtMs != null && observedAtMs >= winnerMs) {
      winner = record;
      winnerMs = observedAtMs;
    }
  }
  return winner;
}

export async function buildPaybackDashboardSlice({
  dataDir,
  logsDir,
  now = new Date().toISOString(),
  auditLogLines = null,
  receiptStore = null,
  decisionBuilder = buildPaybackDecision,
  preMinimumCostPreviewBuilder = buildPreMinimumPaybackCostPreview,
  writeProposedPatch = true,
} = {}) {
  const resolvedAuditLogLines = auditLogLines || await loadPaybackAuditLog({ logsDir });
  const resolvedReceiptStore = receiptStore || await loadLivePaybackReceiptStore({ dataDir });
  const reportingPnlBaseline = dataDir ? await readReportingPnlBaseline({ dataDir }) : null;
  const snapshot = snapshotPaybackAccumulator(resolvedAuditLogLines, resolvedReceiptStore, {
    paybackStrategyIds: [GATEWAY_BTC_OFFRAMP_STRATEGY_ID],
    paybackIntentTypes: ["gateway_btc_offramp"],
  });
  const decision = typeof decisionBuilder === "function"
    ? await decisionBuilder({
        auditLogLines: resolvedAuditLogLines,
        receiptStore: resolvedReceiptStore,
        now,
      })
    : null;
  const previewAfterDestination =
    typeof decisionBuilder === "function" && isMissingDestinationDecision(decision)
      ? await decisionBuilder({
          auditLogLines: resolvedAuditLogLines,
          receiptStore: resolvedReceiptStore,
          now,
          recipientOverride: PREVIEW_BTC_DESTINATION,
        })
      : null;
  const previewMinimumPaybackProgress = minimumPaybackProgress(previewAfterDestination, {
    source: "after_destination",
  });
  const currentMinimumPaybackProgress = minimumPaybackProgress(decision, {
    source: "current",
  });
  const effectiveMinimumProgress =
    decision?.reason === "planned_payback_below_minimum"
      ? currentMinimumPaybackProgress
      : previewMinimumPaybackProgress;
  let preMinimumCompositePreview = null;
  if (
    decision?.status === "carry" &&
    decision?.reason === "planned_payback_below_minimum" &&
    typeof preMinimumCostPreviewBuilder === "function"
  ) {
    try {
      preMinimumCompositePreview = await preMinimumCostPreviewBuilder({
        decision,
        now,
      });
    } catch (error) {
      preMinimumCompositePreview = {
        status: "blocked",
        reason: "pre_minimum_preview_failed",
        error: error.message,
        executionEligible: false,
        intentEligible: false,
      };
    }
  }
  const estimatedPeriodsToFirstPayback = buildEstimatedPeriodsToFirstPayback({
    now,
    minimumProgress: effectiveMinimumProgress,
    auditLogLines: resolvedAuditLogLines,
    receiptStore: resolvedReceiptStore,
    reportingPnlBaseline,
  });
  const proposalTrigger = minPaybackProposalTrigger(estimatedPeriodsToFirstPayback);
  let proposedMinPaybackPatch = null;
  if (writeProposedPatch) {
    const writeResult = await maybeWriteProposedMinPaybackPatch({
      dataDir,
      estimatedPeriodsToFirstPayback,
    });
    proposedMinPaybackPatch = writeResult.path;
  } else if (proposalTrigger) {
    proposedMinPaybackPatch = PROPOSED_MIN_PAYBACK_PATCH_RELATIVE_PATH;
  }
  const minimumReview = buildMinimumPaybackReview({
    estimatedPeriodsToFirstPayback,
    proposedMinPaybackPatch,
    proposalTrigger,
  });
  const latestDelivered = deliveredPaybackRecord(allRecordsForPayback(resolvedAuditLogLines, resolvedReceiptStore));
  return {
    schemaVersion: 1,
    observedAt: now,
    lastPaybackSettledAt: paybackSettlementTimestamp(latestDelivered),
    lastPaybackSettledSats:
      firstFinite(latestDelivered, [
        "destinationProof.observedDelta",
        "payback.settledBalanceDeltaSats",
        "realized.settledBalanceDeltaSats",
        "settledBalanceDeltaSats",
      ]),
    accumulatorPendingSats: snapshot.pendingDeferredSats,
    grossProfitSatsPeriod: snapshot.grossProfitSats_period,
    paidBackSatsLifetime: snapshot.paidBackSats_lifetime,
    profitSatsProvenance: snapshot.profitSatsProvenance || null,
    estimatedPeriodsToFirstPayback,
    proposedMinPaybackPatch,
    minimumReview,
    scheduler: {
      status: decision?.status || null,
      reason: decision?.reason || null,
      requiredEnvName: firstPresent(decision, [
        "decisionLog.inputs.bitcoinDestAddressEnv",
      ]),
      nextAction:
        isMissingDestinationDecision(decision)
          ? "set_payback_btc_destination_env"
          : isMissingReserveDecision(decision)
            ? "restore_profit_reserve_wbtc_oft"
          : null,
      minimumPaybackProgress:
        effectiveMinimumProgress,
      previewAfterDestination: previewAfterDestination
        ? {
            ...previewMinimumPaybackProgress,
          }
        : null,
      preMinimumCompositePreview,
    },
    carry: {
      active: decision?.reason === "planned_payback_below_minimum",
      reason: decision?.reason === "planned_payback_below_minimum" ? decision.reason : null,
      pendingSats: snapshot.pendingDeferredSats,
      pendingSatsProvenance: snapshot.profitSatsProvenance?.pendingDeferred || null,
      remainingSatsToMinimum: effectiveMinimumProgress?.satsToMinimumPayback ?? null,
      costPreview: preMinimumCompositePreview,
      progressToMinimumRatio: effectiveMinimumProgress?.progressToMinimumRatio ?? null,
      requiredGrossProfitSats: effectiveMinimumProgress?.requiredGrossProfitSats ?? null,
      roundTripEfficiencyPeriod: snapshot.kpi?.roundTripEfficiency_period ?? 0,
      expansionPeriodsRemaining: snapshot.expansionGate?.periodsRemaining ?? null,
      consecutivePeriodsMeetingTarget: snapshot.expansionGate?.consecutivePeriodsMeetingTarget ?? null,
    },
    kpi: {
      byrRolling12m: snapshot.kpi?.byr_rolling12m ?? 0,
      cgRolling12m: snapshot.kpi?.cg_rolling12m ?? 0,
      tbrRolling12m: snapshot.kpi?.tbr_rolling12m ?? 0,
      roundTripEfficiencyPeriod: snapshot.kpi?.roundTripEfficiency_period ?? 0,
      daysToBreakeven: snapshot.kpi?.daysToBreakeven ?? 0,
    },
    expansionGate: snapshot.expansionGate
      ? {
          reserveChain: snapshot.expansionGate.reserveChain,
          targetEfficiency: snapshot.expansionGate.targetEfficiency,
          requiredConsecutivePeriods: snapshot.expansionGate.requiredConsecutivePeriods,
          consecutivePeriodsMeetingTarget: snapshot.expansionGate.consecutivePeriodsMeetingTarget,
          periodsRemaining: snapshot.expansionGate.periodsRemaining,
          deliveredPeriodCountOnReserveChain: snapshot.expansionGate.deliveredPeriodCountOnReserveChain,
          deliveredPeriodCountAllChains: snapshot.expansionGate.deliveredPeriodCountAllChains,
          eligible: snapshot.expansionGate.eligible,
          mostRecentPeriodEfficiency: snapshot.expansionGate.mostRecent?.efficiency ?? null,
          mostRecentPeriodObservedAt: snapshot.expansionGate.mostRecent?.observedAt ?? null,
        }
      : null,
    paybackPeriodEfficiencies: snapshot.paybackPeriodEfficiencies || [],
    dataSources: {
      auditLogCount: normalizeRecords(resolvedAuditLogLines).length,
      receiptReconciliationCount: normalizeRecords(resolvedReceiptStore.receiptReconciliations).length,
      liveWrappedLoopReceiptCount:
        normalizeRecords(resolvedReceiptStore.wrappedBtcLoopReceipts).length +
        normalizeRecords(resolvedReceiptStore.wrappedBtcLoopLiveProofs).length,
      treasuryInventoryCount: normalizeRecords(resolvedReceiptStore.treasuryInventory).length,
      marketPriceSnapshotCount: normalizeRecords(resolvedReceiptStore.marketPriceSnapshots).length,
    },
  };
}
