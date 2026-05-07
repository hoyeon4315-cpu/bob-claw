import { evaluateCanaryGraduation } from "./canary-graduation.mjs";
import { sizeMerklCanaryAmount } from "../merkl-canary-autopilot.mjs";
import { evaluateMerklAutoEntry } from "../../config/merkl-auto-entry.mjs";
import { isSupportedBindingKind } from "../protocol-binding-registry.mjs";
import {
  computeTinyCanaryMinProfitablePositionUsd,
  resolveTinyCanaryExpectedHoldDays,
} from "../../config/sizing.mjs";

function bindingKind(queueItem = {}) {
  return queueItem.protocolBindingPlan?.bindingKind || null;
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayedAprPct(queueItem = {}) {
  return finite(
    queueItem.effectiveAprPct ??
      queueItem.displayedAprPct ??
      queueItem.aprPct ??
      queueItem.apr ??
      queueItem.apy,
  );
}

function limitingFactor({ queueItem = {}, sizing = {}, neededUsd = null } = {}) {
  const inventoryUsd = finite(queueItem.executionReadiness?.matchedToken?.estimatedUsd);
  const capUsd = finite(sizing.capUsd);
  const currentUsd = finite(sizing.amountUsd);
  if (inventoryUsd !== null && currentUsd !== null && Math.abs(inventoryUsd - currentUsd) < 0.000001) return "inventory";
  if (inventoryUsd !== null && neededUsd !== null && inventoryUsd < neededUsd) return "inventory";
  if (capUsd !== null && neededUsd !== null && capUsd < neededUsd) return "cap";
  return "unknown";
}

function tinyCanaryEvGate(queueItem = {}, sizing = {}, { now = new Date().toISOString() } = {}) {
  if (sizing.status !== "ready") return null;
  const srcChain = queueItem.srcChain || queueItem.chain || null;
  const dstChain = queueItem.dstChain || queueItem.chain || null;
  if (!srcChain || !dstChain || srcChain !== dstChain) return null;
  const holdDays = resolveTinyCanaryExpectedHoldDays({
    expectedHoldDays: queueItem.expectedHoldDays,
    campaignRemainingHours: queueItem.campaignRemainingHours,
    campaignEndsAt: queueItem.campaignEndsAt,
    now,
  });
  const neededUsd = computeTinyCanaryMinProfitablePositionUsd({
    chain: srcChain,
    aprPct: displayedAprPct(queueItem),
    expectedHoldDays: holdDays,
    estimatedGasCostUsd: queueItem.estimatedGasCostUsd,
  });
  const currentAmountUsd = finite(sizing.amountUsd);
  if (neededUsd === null || currentAmountUsd === null || currentAmountUsd >= neededUsd) {
    return {
      status: "ready",
      blocker: null,
      currentAmountUsd,
      neededUsd,
      holdDays,
      limitingFactor: null,
    };
  }
  return {
    status: "blocked",
    blocker: `same_chain_unprofitable:need_$${Math.ceil(neededUsd)}_on_${srcChain}`,
    currentAmountUsd,
    neededUsd,
    holdDays,
    limitingFactor: limitingFactor({ queueItem, sizing, neededUsd }),
  };
}

export function buildProofGraduationCanaryRequest({
  queueItem = {},
  canaryExecutions = [],
  auditRecords = [],
  now = new Date().toISOString(),
  canaryGraduationPolicy = undefined,
} = {}) {
  const graduation = evaluateCanaryGraduation({
    queueItem,
    canaryExecutions,
    auditRecords,
    policy: canaryGraduationPolicy,
    now,
  });
  const sizing = sizeMerklCanaryAmount(queueItem, {
    useTinyLiveCap: true,
    useGraduationCap: true,
    canaryExecutions,
    auditRecords,
    canaryGraduationPolicy,
    now,
  });
  const autoEntry = evaluateMerklAutoEntry(queueItem, {
    bindingSupported: isSupportedBindingKind(bindingKind(queueItem)),
  });
  const evGate = tinyCanaryEvGate(queueItem, sizing, { now });
  const blockers = [
    ...(graduation.status === "ready" ? [] : graduation.blockers || ["canary_graduation_unavailable"]),
    ...(sizing.status === "ready" ? [] : sizing.blockers || ["canary_sizing_unavailable"]),
    ...(autoEntry.autoExecute ? [] : autoEntry.blockers || ["canary_auto_entry_unavailable"]),
    ...(evGate?.status === "blocked" ? [evGate.blocker] : []),
  ];

  if (blockers.length > 0) {
    return {
      status: "blocked",
      blockers: [...new Set(blockers)],
      graduation,
      sizing,
      autoEntry,
      evGate,
      request: null,
    };
  }

  return {
    status: "ready",
    blockers: [],
    graduation,
    sizing,
    autoEntry,
    evGate,
    request: {
      opportunityId: queueItem.opportunityId || null,
      queueId: queueItem.queueId || null,
      strategyId: sizing.strategyId || queueItem.mappedStrategyId || null,
      chain: queueItem.chain || null,
      protocolId: queueItem.protocolId || queueItem.protocol || null,
      bindingKind: bindingKind(queueItem),
      amount: sizing.amount,
      amountUsd: sizing.amountUsd,
      capUsd: sizing.capUsd,
      executionReason: "merkl_canary_autopilot",
      evidenceConfidence: `graduation_ladder_rung_${graduation.rungIndex ?? 0}`,
      graduation,
      metadata: {
        portfolioHoldProofRequired: true,
        sameOpportunityHoldProofSatisfied: false,
        source: "proof_graduation_bridge",
        observedAt: now,
      },
    },
  };
}
