import { NON_PRIMARY_ENTRY_EV_POLICY } from "../config/sizing.mjs";
import { canonicalGatewayChain } from "../config/gateway-destinations.mjs";
import { pnlEvGateP90Breakdown } from "./radar/pnl-ev-gate.mjs";

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundUsd(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function hasExplicitRewardToken(candidate = {}) {
  return Boolean(candidate.rewardToken || candidate.rewardTokenAddress || candidate.rewardAsset);
}

function sampleUncertaintyMultiplier(policy = {}, observedSampleCount = null) {
  const count = finite(observedSampleCount);
  const samples = Number.isFinite(count) ? count : 0;
  const uncertainty = policy.sampleUncertainty || {};
  if (samples < (uncertainty.sparseSampleMaxExclusive ?? 10)) {
    return uncertainty.sparseP90Multiplier ?? 0.5;
  }
  if (samples < (uncertainty.mediumSampleMaxExclusive ?? 30)) {
    return uncertainty.mediumP90Multiplier ?? 0.25;
  }
  return uncertainty.establishedP90Multiplier ?? 0.10;
}

export function evaluateNonPrimaryEntryPolicy({
  candidate = {},
  policy = NON_PRIMARY_ENTRY_EV_POLICY,
  costLedger = null,
} = {}) {
  const notionalUsd = finite(candidate.notionalUsd ?? candidate.amountUsd ?? candidate.positionUsd);
  const expectedNetEvUsd = finite(candidate.expectedNetEvUsd ?? candidate.expectedRealizedNetUsd ?? candidate.netUsd);
  const canonicalChain = canonicalGatewayChain(candidate.chain);
  const p90Breakdown = pnlEvGateP90Breakdown(costLedger || {}, canonicalChain, candidate);
  const p90RoundTripCostUsd = p90Breakdown.totalUsd;
  const uncertaintyPenaltyUsd = p90RoundTripCostUsd * sampleUncertaintyMultiplier(policy, candidate.observedSampleCount);
  const minEdgePctOfNotional = finite(policy.minEdgePctOfNotional) ?? 0.005;
  const minEdgeFloorUsd = finite(policy.minEdgeFloorUsd) ?? 0.5;
  const notionalEdgeUsd = notionalUsd === null ? 0 : notionalUsd * minEdgePctOfNotional;
  const edgeFloorUsd = Math.max(minEdgeFloorUsd, notionalEdgeUsd);
  const rewardExitCostUsd = hasExplicitRewardToken(candidate)
    ? Math.max(0, finite(candidate.rewardExitCostUsd ?? candidate.claimSwapCostUsd) ?? p90Breakdown.rewardExitCostUsd)
    : 0;
  const requiredEdgeUsd = roundUsd(p90RoundTripCostUsd + uncertaintyPenaltyUsd + edgeFloorUsd);
  const blockers = [];

  if (notionalUsd === null || notionalUsd <= 0) blockers.push("candidate_amount_missing");
  if (expectedNetEvUsd === null) blockers.push("expected_net_ev_missing");
  if (expectedNetEvUsd !== null && expectedNetEvUsd < requiredEdgeUsd) {
    blockers.push("non_primary_ev_below_required_edge");
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    chain: canonicalChain,
    policyMode: policy.mode || "p90_cost_plus_sample_uncertainty",
    notionalUsd,
    expectedNetEvUsd,
    requiredEdgeUsd,
    p90RoundTripCostUsd,
    uncertaintyPenaltyUsd: roundUsd(uncertaintyPenaltyUsd),
    edgeFloorUsd: roundUsd(edgeFloorUsd),
    rewardExitCostUsd,
    p90CostBreakdown: p90Breakdown,
    observedSampleCount: finite(candidate.observedSampleCount) ?? null,
  };
}
