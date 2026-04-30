import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../../config/small-capital-campaign-mode.mjs";
import { evaluateExecutableCandidateGate } from "./executable-candidate-gate.mjs";
import { resolveFamilyBinding } from "./family-binding-registry.mjs";
import { computeRealizedPnlEv } from "./pnl-ev-gate.mjs";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hoursUntil(isoTimestamp, now) {
  if (!isoTimestamp) return null;
  const targetMs = Date.parse(isoTimestamp);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) return null;
  return (targetMs - nowMs) / 3_600_000;
}

function expectedHoldDays(candidate, binding, now) {
  if (Number.isFinite(Number(candidate.expectedHoldDays))) {
    return Math.max(0, Number(candidate.expectedHoldDays));
  }
  const remainingHours = hoursUntil(candidate.campaignEndsAt, now);
  if (remainingHours !== null) return Math.max(0, remainingHours / 24);
  return binding.defaultHoldDays;
}

function missingRequiredFields(candidate, requiredFields = []) {
  return requiredFields.filter((field) => candidate[field] === undefined || candidate[field] === null);
}

function rewardExitLiquidityDepthUsd(candidate = {}) {
  return finiteNumber(
    candidate.rewardExitLiquidityProof?.dexDepthUsd
      ?? candidate.rewardExitLiquidityProof?.rewardTokenDexDepthUsd
      ?? candidate.rewardTokenDexDepthAtCanarySizeUsd
      ?? candidate.rewardTokenDexDepthUsd
  );
}

function rewardExitLiquidityProven(candidate = {}, amountUsd) {
  if ((candidate.rewardTokenType ?? "defaultRewardToken") === "stable") return true;
  const depthUsd = rewardExitLiquidityDepthUsd(candidate);
  return depthUsd !== null && depthUsd >= amountUsd * 3;
}

export function buildRadarCanaryIntent({
  packet = {},
  candidate = {},
  policy,
  strategyCapsById = {},
  costLedger = {},
  radarLanePolicy = SMALL_CAPITAL_CAMPAIGN_MODE.radarLane,
  radarLockOn = false,
  now = new Date().toISOString(),
} = {}) {
  if (radarLockOn) return { status: "blocked", blockers: ["radar_lock_active"] };

  const gate = evaluateExecutableCandidateGate({ packet, candidate, policy });
  if (!gate.ok) {
    return { status: "blocked", blockers: gate.blockers, gate };
  }

  const binding = resolveFamilyBinding(candidate);
  if (!binding) return { status: "blocked", blockers: ["family_binding_missing"], gate };

  const missingFields = missingRequiredFields(candidate, binding.requiredFields);
  if (missingFields.length > 0) {
    return {
      status: "blocked",
      blockers: missingFields.map((field) => `required_field_missing:${field}`),
      gate,
      binding,
    };
  }

  const caps = strategyCapsById[binding.strategyId]?.caps ?? {};
  const tinyLiveCapUsd = finiteNumber(caps.tinyLivePerTxUsd);
  if (tinyLiveCapUsd === null) {
    return { status: "blocked", blockers: ["tiny_live_cap_missing"], gate, binding };
  }

  const radarPerCanaryUsd = finiteNumber(radarLanePolicy?.perCanaryUsd) ?? tinyLiveCapUsd;
  const amountUsd = Math.min(tinyLiveCapUsd, radarPerCanaryUsd);
  if (!rewardExitLiquidityProven(candidate, amountUsd)) {
    return {
      status: "blocked",
      blockers: ["reward_exit_liquidity_unproven"],
      gate,
      binding,
    };
  }
  const holdDays = expectedHoldDays(candidate, binding, now);
  const ev = computeRealizedPnlEv({
    candidate,
    positionUsd: amountUsd,
    holdDays,
    costLedger,
    costVarianceBufferUsd: radarLanePolicy?.minRealizedPnlBufferUsd ?? 0,
  });
  if (!ev.ok) {
    return { status: "blocked", blockers: [ev.blocker], gate, binding, ev };
  }

  return {
    status: "ready",
    intent: {
      strategyId: binding.strategyId,
      intentType: "tiny_live_canary",
      executionSubType: binding.executionSubType,
      chain: candidate.chain,
      protocol: candidate.protocol ?? candidate.protocolId,
      opportunityId: candidate.opportunityId ?? candidate.candidateId,
      amountUsd,
      expectedHoldDays: holdDays,
      displayedApr: candidate.displayedAprPct ?? candidate.displayedApr ?? candidate.apr ?? null,
      rewardTokenType: candidate.rewardTokenType ?? null,
      estimatedCostsUsd: ev.expectedCostUsd,
      estimatedBridgeCostUsd: ev.p90BridgeUsd,
      mode: "live",
      executionReason: "radar_tiny_live_canary",
      metadata: {
        radarCandidateId: candidate.candidateId,
        radarPacketId: packet.packetId ?? candidate.packetId ?? null,
        familyKey: candidate.familyKey ?? null,
        expectedNetPnlUsd: ev.expectedNetPnlUsd,
        btcPaybackConversionRequired: true,
        promotedAt: now,
      },
    },
    gate,
    binding,
    ev,
  };
}
