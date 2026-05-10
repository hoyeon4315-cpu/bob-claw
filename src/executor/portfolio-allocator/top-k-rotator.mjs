import {
  K_for_capital,
  canarySizeForCapital,
  resolveAggressionProfile,
} from "../../config/portfolio-rotator.mjs";
import { overfitPenaltyForBacktestQuality, validateStrategyRecord } from "../../strategy/strategy-record-schema.mjs";
import { combinedConfidence } from "./confidence-tracker.mjs";

const IL_RISK_PENALTY = Object.freeze({
  none: 0,
  low: 0.25,
  medium: 0.75,
  high: 2,
});

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sameCount(selected = [], field, candidate = {}) {
  return selected.filter((item) => item.record?.[field] === candidate[field]).length;
}

export function scoreStrategyForSlot(record = {}, context = {}) {
  const capitalUsd = finiteNumber(context.capitalUsd, 0);
  const measuredAprPct = finiteNumber(record.measured_apr_pct, 0);
  const rewardHaircutPct = Math.max(0, Math.min(100, finiteNumber(record.reward_haircut_pct, 0)));
  const effectiveAprPct = measuredAprPct * (1 - rewardHaircutPct / 100);
  const confidence = combinedConfidence(record);
  const overfitPenalty = overfitPenaltyForBacktestQuality(record.backtest_quality);
  const entryCost = finiteNumber(record.entry_cost_usd_per_dollar, 0);
  const exitCost = finiteNumber(record.exit_cost_usd_per_dollar, 0);
  const costPct = (entryCost + exitCost) * 100;
  const riskPenalty = IL_RISK_PENALTY[record.il_risk_class] ?? 1;
  const holdDays = Math.max(1, finiteNumber(record.expected_hold_days, 1));
  const expectedGrossUsd = capitalUsd * (effectiveAprPct / 100) * (holdDays / 365);
  const expectedCostUsd = capitalUsd * (entryCost + exitCost);
  const expectedNetUsd = expectedGrossUsd - expectedCostUsd;
  const breakeven_days = effectiveAprPct > 0
    ? ((entryCost + exitCost) / (effectiveAprPct / 100)) * 365
    : null;
  const score = (effectiveAprPct * confidence * overfitPenalty) - costPct - riskPenalty;

  return {
    strategyId: record.strategyId || null,
    score,
    expectedNetUsd,
    eligible: score > 0 && expectedNetUsd > 0,
    breakdown: {
      apr: measuredAprPct,
      effectiveAprPct,
      confidence,
      protocolClassConfidenceTimesInstanceConfidence: confidence,
      overfitPenalty,
      backtest_quality: record.backtest_quality,
      rewardHaircutPct,
      cost: costPct,
      risk: riskPenalty,
      diversity: 0,
      breakeven_days,
      expectedNetUsd,
    },
  };
}

export function enforceDiversity(selected = [], candidate = {}, options = {}) {
  const maxSameChain = options.maxSameChain ?? 1;
  const maxSameProtocol = options.maxSameProtocol ?? 1;
  const maxSameFamily = options.maxSameFamily ?? 2;
  const blockers = [];
  if (sameCount(selected, "chain", candidate) >= maxSameChain) blockers.push("diversity_same_chain_limit");
  if (sameCount(selected, "protocol", candidate) >= maxSameProtocol) blockers.push("diversity_same_protocol_limit");
  if (sameCount(selected, "family", candidate) >= maxSameFamily) blockers.push("diversity_same_family_limit");
  return {
    allowed: blockers.length === 0,
    blockers,
  };
}

export function rotateTopK(records = [], context = {}) {
  const capitalUsd = finiteNumber(context.capitalUsd, 0);
  const profile = resolveAggressionProfile(context.profile);
  const k = K_for_capital(capitalUsd, profile);
  const blockedStrategies = context.blockedStrategies || new Set();
  const chainBlockers = context.chainBlockers || new Map();
  const selected = [];
  const rejected = [];

  if (!Array.isArray(records) || records.length === 0) {
    return {
      schemaVersion: 1,
      status: "no_action",
      selected: [],
      actions: [],
      rejected,
      noTxReason: "empty_strategy_registry",
      blockerClass: "source",
      k,
      capitalUsd,
    };
  }

  const scored = records.map((record) => {
    const validation = validateStrategyRecord(record);
    const score = scoreStrategyForSlot(validation.record || record, context);
    return {
      record: validation.record || record,
      validation,
      ...score,
    };
  }).sort((left, right) => right.score - left.score);

  for (const candidate of scored) {
    if (selected.length >= k) break;
    if (!candidate.validation.ok) {
      rejected.push({ strategyId: candidate.record.strategyId, reason: "invalid_strategy_record", errors: candidate.validation.errors });
      continue;
    }
    if (blockedStrategies.has(candidate.record.strategyId)) {
      rejected.push({ strategyId: candidate.record.strategyId, reason: "strategy_blocked" });
      continue;
    }
    if (chainBlockers.has(candidate.record.chain)) {
      rejected.push({ strategyId: candidate.record.strategyId, reason: "chain_blocked", chain: candidate.record.chain });
      continue;
    }
    if (!candidate.eligible) {
      rejected.push({ strategyId: candidate.record.strategyId, reason: "non_positive_expected_net", score: candidate.score });
      continue;
    }
    const diversity = enforceDiversity(selected, candidate.record, profile.diversity || {});
    if (!diversity.allowed) {
      rejected.push({ strategyId: candidate.record.strategyId, reason: "diversity_blocked", blockers: diversity.blockers });
      continue;
    }
    selected.push(candidate);
  }

  const actions = selected.map((item, slot) => ({
    action: "enter_tiny_canary",
    slot,
    strategyId: item.record.strategyId,
    chain: item.record.chain,
    protocol: item.record.protocol,
    capitalUsd: canarySizeForCapital(capitalUsd, profile),
    score: item.score,
    reasons: item.breakdown,
  }));

  const noTxReason = actions.length > 0 ? null : "no_strategy_candidates_eligible";
  const blockerClass = actions.length > 0
    ? null
    : rejected.some((item) => item.reason === "chain_blocked")
      ? "chain"
      : "policy";

  return {
    schemaVersion: 1,
    status: actions.length > 0 ? "actions_ready" : "no_action",
    k,
    capitalUsd,
    selected,
    actions,
    rejected,
    noTxReason,
    blockerClass,
  };
}
