import { CHAIN_SCORING_POLICY } from "../config/chain-scoring.mjs";
import {
  OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  canonicalGatewayChain,
} from "../config/gateway-destinations.mjs";
import {
  isSignerBackedRecord,
  realizedNetPnlSats,
  txHashFor,
} from "./strategy-receipt-distribution.mjs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function statusFor(record = {}) {
  return record.receipt?.status
    || record.lifecycle?.stage
    || record.settlementStatus
    || record.status
    || null;
}

function reconciliationStatusFor(record = {}) {
  return record.reconciliation?.status
    || record.reconciliationStatus
    || record.receiptReconciliation?.status
    || null;
}

function evidenceClassFor(record = {}) {
  return record.evidenceClass
    || record.receipt?.evidenceClass
    || record.realized?.evidenceClass
    || (record.realized || Number.isFinite(record.realizedNetPnlSats) ? "strategy_realized_pnl" : "execution_evidence_cost");
}

function isExcludedMode(record = {}) {
  const mode = String(record.mode || record.executionMode || "").toLowerCase();
  return mode === "dry_run"
    || mode === "dry-run"
    || mode === "preview"
    || record.preview === true
    || record.dryRun === true
    || Boolean(record.normalizationError);
}

function isFinalitySafeRecord(record = {}) {
  if (!isSignerBackedRecord(record)) return false;
  if (!txHashFor(record)) return false;
  if (isExcludedMode(record)) return false;
  const status = statusFor(record);
  if (!["confirmed", "delivered", "failed", "reverted"].includes(status)) return false;
  const reconciliationStatus = reconciliationStatusFor(record);
  if (["confirmed", "delivered"].includes(status) && reconciliationStatus !== "reconciled") return false;
  if (["failed", "reverted"].includes(status) && reconciliationStatus !== "final_failed") return false;
  const confirmations = finiteNumber(record.lifecycle?.confirmations ?? record.receipt?.confirmations ?? record.confirmations);
  if (confirmations !== null && confirmations < 1) return false;
  return true;
}

function roundTripUsdFor(record = {}) {
  return finiteNumber(record.cost?.roundTripUsd)
    ?? finiteNumber(record.roundTripCostUsd)
    ?? finiteNumber(record.realized?.roundTripCostUsd)
    ?? null;
}

function routeAvailabilityScore(proof = null) {
  if (!proof) return 0.5;
  if (proof.ok === false) return 0;
  const exit = proof.exitLiquidityProof === true ? 0.5 : 0;
  const reward = proof.rewardTokenConversionProof === true || proof.rewardToken === null ? 0.5 : 0;
  return proof.ok === true ? Math.max(0.5, exit + reward) : 0.5;
}

function routeAvailabilityBlockers(proof = null) {
  if (!proof) return ["route_availability_unobserved"];
  const blockers = [];
  if (proof.ok === false) blockers.push("route_availability_blocked");
  if (proof.exitLiquidityProof !== true) blockers.push("exit_liquidity_proof_missing");
  if (proof.rewardToken !== null && proof.rewardTokenConversionProof !== true) {
    blockers.push("reward_conversion_proof_missing");
  }
  return blockers;
}

function costEfficiencyScore(p90RoundTripUsd) {
  const cost = finiteNumber(p90RoundTripUsd);
  if (cost === null) return 0.5;
  return clamp(1 - (cost / 10), 0, 1);
}

function realizedScore(avgPnlSats) {
  return clamp(0.5 + (avgPnlSats / 2_000), 0, 1);
}

function freshnessScore(freshnessHours, halfLifeHours) {
  if (!Number.isFinite(freshnessHours)) return 0.5;
  return clamp(Math.exp(-freshnessHours / halfLifeHours), 0, 1);
}

function emptyChainEntry(chain, now, policy, auditIntegrityStatus) {
  return {
    chain,
    chainScore: policy.priorScore,
    scoreSource: "prior",
    widePosterior: true,
    observedAt: now,
    sampleCount: 0,
    alphaSampleCount: 0,
    realizedNetPnlSats7d: 0,
    receiptFreshnessHours: null,
    p90RoundTripUsd: null,
    decayFactor: 0,
    auditIntegrityStatus,
    evidenceClassBreakdown: {
      strategyRealizedPnlCount: 0,
      executionEvidenceCostCount: 0,
      failedReceiptCount: 0,
    },
    blockers: ["chain_score_unobserved"],
  };
}

function clampScoreDelta({ chain, score, previousLedger, policy, nowMs }) {
  const previous = previousLedger?.byChain?.[chain] || null;
  const previousScore = finiteNumber(previous?.chainScore);
  if (previousScore === null) return { score, clamped: false };
  const previousMs = Date.parse(previous.observedAt || previousLedger.generatedAt || "");
  const elapsedDays = Number.isFinite(previousMs)
    ? Math.max(0, (nowMs - previousMs) / DAY_MS)
    : 1;
  const maxDelta = finiteNumber(policy.maxScoreDeltaPerDay);
  if (maxDelta === null || maxDelta <= 0) return { score, clamped: false };
  const limit = maxDelta * Math.max(elapsedDays, 1 / 24);
  const clampedScore = clamp(score, previousScore - limit, previousScore + limit);
  return { score: clampedScore, clamped: Math.abs(clampedScore - score) > 1e-12 };
}

export function buildChainScoreLedger({
  records = [],
  now = new Date().toISOString(),
  policy = CHAIN_SCORING_POLICY,
  p90RoundTripUsdByChain = {},
  routeAvailabilityByChain = {},
  auditIntegrityStatus = "unknown",
  previousLedger = null,
} = {}) {
  const nowMs = Date.parse(now);
  const effectiveNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const window7d = effectiveNowMs - 7 * DAY_MS;
  const byChainStats = new Map();

  for (const record of records || []) {
    if (!isFinalitySafeRecord(record)) continue;
    const chain = canonicalGatewayChain(record.chain);
    if (!OFFICIAL_GATEWAY_DESTINATION_CHAINS.includes(chain)) continue;
    const tsMs = Date.parse(record.observedAt || record.timestamp || record.receipt?.observedAt || "");
    if (!Number.isFinite(tsMs) || tsMs > effectiveNowMs) continue;
    if (!byChainStats.has(chain)) {
      byChainStats.set(chain, {
        chain,
        latestTsMs: 0,
        strategyPnlSats7d: 0,
        strategyPnlCount: 0,
        executionEvidenceCostCount: 0,
        failedReceiptCount: 0,
        roundTripCosts: [],
      });
    }
    const stats = byChainStats.get(chain);
    stats.latestTsMs = Math.max(stats.latestTsMs, tsMs);
    const status = statusFor(record);
    if (status === "failed" || status === "reverted") {
      stats.failedReceiptCount += 1;
      continue;
    }
    const evidenceClass = evidenceClassFor(record);
    if (evidenceClass === "execution_evidence_cost") {
      stats.executionEvidenceCostCount += 1;
      const costUsd = roundTripUsdFor(record);
      if (costUsd !== null) stats.roundTripCosts.push(costUsd);
      continue;
    }
    if (evidenceClass === "strategy_realized_pnl") {
      stats.strategyPnlCount += 1;
      if (tsMs >= window7d) stats.strategyPnlSats7d += realizedNetPnlSats(record);
    }
  }

  const byChain = {};
  for (const chain of OFFICIAL_GATEWAY_DESTINATION_CHAINS) {
    const stats = byChainStats.get(chain);
    if (!stats) {
      byChain[chain] = emptyChainEntry(chain, new Date(effectiveNowMs).toISOString(), policy, auditIntegrityStatus);
      continue;
    }
    const sampleCount = stats.strategyPnlCount + stats.executionEvidenceCostCount + stats.failedReceiptCount;
    const alphaSampleCount = stats.strategyPnlCount;
    const freshnessHours = stats.latestTsMs > 0 ? (effectiveNowMs - stats.latestTsMs) / HOUR_MS : null;
    const p90FromRecords = stats.roundTripCosts.length > 0
      ? stats.roundTripCosts.slice().sort((a, b) => a - b)[Math.min(stats.roundTripCosts.length - 1, Math.ceil(stats.roundTripCosts.length * 0.9) - 1)]
      : null;
    const p90RoundTripUsd = finiteNumber(p90RoundTripUsdByChain[chain]) ?? p90FromRecords;
    const avgPnlSats = stats.strategyPnlCount > 0 ? stats.strategyPnlSats7d / stats.strategyPnlCount : 0;
    const failedRate = sampleCount > 0 ? stats.failedReceiptCount / sampleCount : 0;
    const routeBlockers = routeAvailabilityBlockers(routeAvailabilityByChain[chain]);
    const rawScore =
      realizedScore(avgPnlSats) * policy.weights.realizedNetBtc +
      freshnessScore(freshnessHours, policy.halfLifeHours) * policy.weights.receiptFreshness +
      routeAvailabilityScore(routeAvailabilityByChain[chain]) * policy.weights.routeAvailability +
      costEfficiencyScore(p90RoundTripUsd) * policy.weights.costEfficiency;
    const shrink = clamp(alphaSampleCount / policy.minObservedSamplesForConfidentScore, 0, 1);
    const failedPenalty = failedRate * 0.2;
    const unclampedScore = clamp(
      policy.priorScore * (1 - shrink) + rawScore * shrink - failedPenalty,
      0,
      1,
    );
    const conservativeScore = alphaSampleCount === 0 ? Math.min(policy.priorScore, unclampedScore) : unclampedScore;
    const deltaClamped = clampScoreDelta({
      chain,
      score: conservativeScore,
      previousLedger,
      policy,
      nowMs: effectiveNowMs,
    });
    const chainScore = deltaClamped.score;
    const blockers = [];
    if (alphaSampleCount === 0) blockers.push("strategy_realized_pnl_missing");
    blockers.push(...routeBlockers);
    if (deltaClamped.clamped) blockers.push("score_delta_clamped");
    byChain[chain] = {
      chain,
      chainScore,
      scoreSource: "ledger",
      widePosterior: alphaSampleCount < policy.minObservedSamplesForConfidentScore || auditIntegrityStatus !== "ok" || routeBlockers.length > 0,
      observedAt: new Date(stats.latestTsMs).toISOString(),
      sampleCount,
      alphaSampleCount,
      realizedNetPnlSats7d: stats.strategyPnlSats7d,
      receiptFreshnessHours: freshnessHours,
      p90RoundTripUsd,
      decayFactor: freshnessScore(freshnessHours, policy.halfLifeHours),
      auditIntegrityStatus,
      evidenceClassBreakdown: {
        strategyRealizedPnlCount: stats.strategyPnlCount,
        executionEvidenceCostCount: stats.executionEvidenceCostCount,
        failedReceiptCount: stats.failedReceiptCount,
      },
      blockers,
    };
  }

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date(effectiveNowMs).toISOString(),
    policy,
    byChain: Object.freeze(byChain),
  });
}

export {
  isFinalitySafeRecord,
};
