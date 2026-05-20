// Pure cost-floor evidence helper for report-only lifecycle consumers.
//
// Mirrors the receipt-cost p90 + cost-multiplier + min-profit-floor calculation
// used by `evGate` in src/executor/policy/ev-gate.mjs so that report-only
// surfaces (capital_refill dry-run intent, lane-intent-candidate lifecycle,
// etc.) can quote the exact same cost-floor numbers that the live policy gate
// will apply, without re-running the EV gate or fabricating values.
//
// Read-only. Never signs, enqueues, mutates runtime state, changes autoExecute,
// or relaxes any policy/EV/cap gate. The live gate decision is still owned by
// `evGate`; this helper exposes only the floor numerics so they can be
// forwarded into dry-run intents.

import {
  EXECUTION_EV_COST_POLICY,
  executionEvFallbackCostUsd,
  tinyCanarySameChainRoundTripCostUsd,
} from "../../config/sizing.mjs";

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeChain(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function evCostKey({ strategyId, chain, intentType }) {
  return `${normalizeString(strategyId) || "unknown"}:${normalizeChain(chain) || "unknown"}:${normalizeString(intentType) || "unknown"}`;
}

function normalizedFloorInputs({ strategyId, chain, intentType }) {
  const normalizedStrategyId = normalizeString(strategyId);
  const normalizedChain = normalizeChain(chain);
  const normalizedIntentType = normalizeString(intentType);
  if (!normalizedStrategyId || !normalizedChain || !normalizedIntentType) return null;
  return { normalizedStrategyId, normalizedChain, normalizedIntentType };
}

function receiptEntryFor({ receiptModel = null, key }) {
  const entries = Array.isArray(receiptModel?.entries) ? receiptModel.entries : [];
  return entries.find((item) => item && item.key === key) || null;
}

function sampleThresholdFor(policy = EXECUTION_EV_COST_POLICY) {
  return finiteNumber(policy?.minSamples) ?? EXECUTION_EV_COST_POLICY.minSamples;
}

function hasSufficientHistory(entry = null, sampleThreshold) {
  return Number.isFinite(entry?.sampleCount) && entry.sampleCount >= sampleThreshold;
}

function policyFloorNumbers(policy = EXECUTION_EV_COST_POLICY, isCapitalRebalance = false) {
  const costMultiplier = finiteNumber(policy?.costMultiplier) ?? EXECUTION_EV_COST_POLICY.costMultiplier;
  const minProfitFloorUsd = finiteNumber(policy?.minProfitFloorUsd) ?? EXECUTION_EV_COST_POLICY.minProfitFloorUsd;
  const effectiveMinProfitFloor = isCapitalRebalance ? 0.1 : minProfitFloorUsd;
  return { costMultiplier, minProfitFloorUsd, effectiveMinProfitFloor };
}

function resolveP90CostUsd({
  entry = null,
  hasSufficientHistory = false,
  normalizedChain,
  isTinyLiveCanary = false,
  estimatedGasCostUsd = null,
  policy = EXECUTION_EV_COST_POLICY,
}) {
  const fallbackP99CostUsd = executionEvFallbackCostUsd({ chain: normalizedChain, policy });
  const tinyCanaryFallbackUsd = isTinyLiveCanary
    ? tinyCanarySameChainRoundTripCostUsd({ chain: normalizedChain, estimatedGasCostUsd })
    : null;
  const p90CostUsd = hasSufficientHistory ? entry.p90CostUsd : (tinyCanaryFallbackUsd ?? fallbackP99CostUsd);
  const costSource = hasSufficientHistory
    ? "history_p90"
    : tinyCanaryFallbackUsd !== null
      ? "tiny_canary_shared_p90"
      : "fallback_chain_p99";
  return { p90CostUsd, fallbackP99CostUsd, tinyCanaryFallbackUsd, costSource };
}

export function executionEvCostFloorEvidence({
  strategyId = null,
  chain = null,
  intentType = null,
  isCapitalRebalance = false,
  isTinyLiveCanary = false,
  estimatedGasCostUsd = null,
  receiptModel = null,
  policy = EXECUTION_EV_COST_POLICY,
} = {}) {
  const normalized = normalizedFloorInputs({ strategyId, chain, intentType });
  if (!normalized) return null;
  const { normalizedStrategyId, normalizedChain, normalizedIntentType } = normalized;

  const key = evCostKey({
    strategyId: normalizedStrategyId,
    chain: normalizedChain,
    intentType: normalizedIntentType,
  });
  const entry = receiptEntryFor({ receiptModel, key });
  const sampleThreshold = sampleThresholdFor(policy);
  const historyReady = hasSufficientHistory(entry, sampleThreshold);

  const { p90CostUsd, fallbackP99CostUsd, costSource } = resolveP90CostUsd({
    entry,
    hasSufficientHistory: historyReady,
    normalizedChain,
    isTinyLiveCanary,
    estimatedGasCostUsd,
    policy,
  });
  const { costMultiplier, minProfitFloorUsd, effectiveMinProfitFloor } = policyFloorNumbers(policy, isCapitalRebalance);
  const requiredNetUsd = p90CostUsd * costMultiplier + effectiveMinProfitFloor;

  return {
    strategyId: normalizedStrategyId,
    chain: normalizedChain,
    intentType: normalizedIntentType,
    p90CostUsd,
    requiredNetUsd,
    effectiveFloorUsd: requiredNetUsd,
    fallbackP99CostUsd,
    costSource,
    sampleCount: entry?.sampleCount ?? 0,
    sampleThreshold,
    costMultiplier,
    minProfitFloorUsd,
    effectiveMinProfitFloor,
    modelGeneratedAt: receiptModel?.generatedAt || null,
    lookbackDays: receiptModel?.lookbackDays ?? null,
    producer: "src/executor/policy/ev-cost-floor.mjs#executionEvCostFloorEvidence",
  };
}

export const EV_COST_FLOOR_PRODUCER = Object.freeze({
  module: "src/executor/policy/ev-cost-floor.mjs",
  function: "executionEvCostFloorEvidence",
});
