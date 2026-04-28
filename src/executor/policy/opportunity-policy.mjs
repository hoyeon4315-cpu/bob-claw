import { evaluateRoundtripEnforcer } from "../../risk/roundtrip-enforcer.mjs";
import { evaluateConcentrationLimits } from "../../config/concentration-limits.mjs";
import { SIZING_POLICY, computeMinProfitablePositionUsd } from "../../config/sizing.mjs";
import { evaluateGasBudgetController } from "../../risk/gas-budget-controller.mjs";
import { evaluateExitRules } from "../../config/merkl-exit-rules.mjs";
import { checkKillSwitch } from "./kill-switch.mjs";
import { evaluateStaleQuote } from "./stale-quote.mjs";
import { SMALL_CAPITAL_CAMPAIGN_MODE, applyRewardHaircut } from "../../config/small-capital-campaign-mode.mjs";
import { getProtocolTier } from "../../config/protocol-trust-tiers.mjs";

function isCapitalMovementIntent(intent = {}) {
  const movementTypes = new Set([
    "bridge", "withdraw", "deposit", "rebalance", "exit", "harvest_yield",
    "scale_up", "capital_rebalance", "capital_drain", "refill", "consolidation",
    "erc4626_redeem", "aave_withdraw", "euler_evault_withdraw",
  ]);
  return movementTypes.has(intent.intentType) || movementTypes.has(intent.action);
}

export function computeExpectedRealizedNet({ displayedAprPct, rewardTokenType, estimatedCostsUsd, positionUsd, holdDays }) {
  const yearFraction = Number(holdDays) / 365;
  const grossRewardUsd = Number(positionUsd) * (Number(displayedAprPct) / 100) * yearFraction;
  const expectedRewardUsd = applyRewardHaircut(rewardTokenType, grossRewardUsd);
  const estimatedCosts = Number(estimatedCostsUsd ?? 0);
  const haircut = SMALL_CAPITAL_CAMPAIGN_MODE.rewardHaircuts[rewardTokenType] ?? SMALL_CAPITAL_CAMPAIGN_MODE.rewardHaircuts.defaultRewardToken;
  const effectiveAprPct = Number(displayedAprPct) * (1 - haircut);
  return {
    expectedRewardUsd,
    estimatedCostsUsd: estimatedCosts,
    netUsd: expectedRewardUsd - estimatedCosts,
    effectiveAprPct,
  };
}

export async function evaluateOpportunityPolicy({
  intent = {},
  auditRecords = [],
  positionState = null,
  gasBaselines = {},
  activePositions = [],
  currentAllocations = {},
  capitalState = {},
  now = new Date().toISOString(),
  killSwitchPath = null,
  killSwitchExistsImpl = null,
} = {}) {
  const blockers = [];
  const results = [];

  const killResult = await checkKillSwitch({
    killSwitchPath,
    existsImpl: killSwitchExistsImpl,
    now,
  });
  results.push(killResult);
  if (killResult.decision === "BLOCK") blockers.push(...killResult.blockers);

  const rtResult = evaluateRoundtripEnforcer(intent);
  results.push({
    policy: "roundtrip_enforcer",
    observedAt: now,
    decision: rtResult.ok ? "ALLOW" : "BLOCK",
    blockers: rtResult.blockers,
  });
  if (!rtResult.ok) blockers.push(...rtResult.blockers);

  const staleResult = evaluateStaleQuote({ intent, maxAgeMs: 30_000, now });
  results.push(staleResult);
  if (staleResult.decision === "BLOCK") blockers.push(...staleResult.blockers);

  const projected = {
    chainSharePct: { ...(currentAllocations.chainSharePct || {}) },
    protocolSharePct: { ...(currentAllocations.protocolSharePct || {}) },
    opportunitySharePct: { ...(currentAllocations.opportunitySharePct || {}) },
  };
  const addShare = intent.sharePct ?? 0;
  if (intent.chain) {
    projected.chainSharePct[intent.chain] = (projected.chainSharePct[intent.chain] || 0) + addShare;
  }
  if (intent.protocol) {
    projected.protocolSharePct[intent.protocol] = (projected.protocolSharePct[intent.protocol] || 0) + addShare;
  }
  if (intent.opportunityId) {
    projected.opportunitySharePct[intent.opportunityId] = (projected.opportunitySharePct[intent.opportunityId] || 0) + addShare;
  }

  const isMovement = isCapitalMovementIntent(intent);
  const concResult = evaluateConcentrationLimits({ allocations: projected });
  // Capital movement intents are exempt from opportunity/protocol concentration
  // but still bound by chain concentration (don't over-concentrate on one chain).
  const concBlockers = isMovement
    ? concResult.violations.filter((v) => v.kind === "chain_concentration_exceeded").map((v) => v.kind)
    : concResult.violations.map((v) => v.kind);
  results.push({
    policy: "concentration_limits",
    observedAt: now,
    decision: concBlockers.length === 0 ? "ALLOW" : "BLOCK",
    blockers: concBlockers,
  });
  if (concBlockers.length > 0) blockers.push(...concBlockers);

  // Expected realized net check for reward-token opportunities
  const positionUsd = Number(intent.amountUsd ?? intent.positionUsd ?? 0);
  if (intent.rewardTokenType != null && intent.displayedApr != null) {
    const netResult = computeExpectedRealizedNet({
      displayedAprPct: Number(intent.displayedApr),
      rewardTokenType: intent.rewardTokenType,
      estimatedCostsUsd: Number(intent.estimatedCostsUsd ?? 0),
      positionUsd,
      holdDays: Number(intent.expectedHoldDays ?? 14),
    });
    if (netResult.netUsd < 0 || netResult.effectiveAprPct < 0) {
      blockers.push("negative_expected_realized_net");
    }
    // Non-base chain entry gate
    if (!isMovement && intent.chain && !SMALL_CAPITAL_CAMPAIGN_MODE.baseFirstChains.includes(intent.chain)) {
      const nonBase = SMALL_CAPITAL_CAMPAIGN_MODE.nonBaseEntry;
      const meetsMinUsd = netResult.netUsd >= nonBase.minNetProfitUsd;
      const meetsMinPct = netResult.netUsd >= positionUsd * nonBase.minNetProfitPctOfPosition;
      if (!meetsMinUsd && !meetsMinPct) {
        blockers.push("non_base_entry_insufficient_expected_net");
      }
    }
  }

  // Protocol concentration check for small-capital campaign mode
  // Capital movement intents are exempt (same rule as concentration_limits above).
  if (intent.protocol && !isMovement) {
    const tier = getProtocolTier(intent.protocol);
    const isBluechip = tier.tierKey === "TIER_A";
    const protocolProjectedShare = projected.protocolSharePct[intent.protocol] || 0;
    if (!isBluechip && protocolProjectedShare > SMALL_CAPITAL_CAMPAIGN_MODE.protocolConcentration.defaultMaxPct) {
      blockers.push("protocol_concentration_exceeded");
    }
    const isClVenue = intent.venue === "cl" || intent.executionSurface === "clLp";
    if (isClVenue && protocolProjectedShare > SMALL_CAPITAL_CAMPAIGN_MODE.protocolConcentration.venueMaxPctWithLiveMonitor) {
      blockers.push("protocol_concentration_exceeded");
    }
  }

  if (positionUsd > 0 && positionUsd < SIZING_POLICY.minPositionUsd) {
    blockers.push("position_below_min_position_usd");
  }
  const totalCapital = Number(capitalState.totalDeployableCapital ?? 0);
  if (totalCapital > 0) {
    // Movement intents can use up to 70% of capital (consolidation efficiency)
    // Small-capital relief: if totalCapital < $200, allow enough % to meet minPositionUsd
    // so that $32 capital can still enter a $25 position (76.7%) instead of being blocked by 25%
    const maxPositionPct = isMovement
      ? 0.70
      : totalCapital < 200
        ? Math.max(SIZING_POLICY.maxSinglePositionPct, SIZING_POLICY.minPositionUsd / totalCapital)
        : SIZING_POLICY.maxSinglePositionPct;
    const maxPosition = totalCapital * maxPositionPct;
    if (positionUsd > maxPosition) {
      blockers.push("position_above_max_single_position_pct");
    }
  }

  // Micro-test gate: allow small high-risk tests (<$30, <6% of capital)
  const isMicroTest = intent.strategyId?.includes("micro-test") || intent.metadata?.microTest === true;
  if (isMicroTest && positionUsd > 0) {
    const totalCapital = Number(capitalState.totalDeployableCapital ?? 0);
    if (totalCapital > 0) {
      const microPct = positionUsd / totalCapital;
      if (microPct > 0.06) {
        blockers.push("micro_test_cap_exceeded_6pct");
      }
      if (positionUsd > 30) {
        blockers.push("micro_test_max_30usd");
      }
    }
  }

  // Cross-chain bridge cost gate: reject if bridge cost would eat >50% of gross profit
  // Exempt capital movement intents — they are cost-center operations, not yield positions.
  const srcChain = intent.srcChain || intent.chain;
  const dstChain = intent.dstChain || intent.chain;
  if (!isMovement && srcChain && dstChain && srcChain !== dstChain) {
    const bridgeCostUsd = Number(intent.estimatedBridgeCostUsd ?? 0);
    const holdDays = Number(intent.expectedHoldDays ?? 14);
    const aprDecimal = Number(intent.apr ?? intent.apy ?? 0) / 100;
    const minProfitable = computeMinProfitablePositionUsd({
      roundTripCostUsd: bridgeCostUsd + 0.12,
      postedAprDecimal: aprDecimal,
      expectedHoldYearFraction: holdDays / 365,
      safetyFactor: 0.5,
    });
    if (minProfitable !== null && positionUsd < minProfitable) {
      blockers.push(`cross_chain_unprofitable:need_$${Math.ceil(minProfitable)}_for_${srcChain}_to_${dstChain}`);
    }
  }

  // Same-chain minimum profitability floor based on gas only
  // Exempt capital movement intents.
  if (!isMovement && srcChain && dstChain && srcChain === dstChain) {
    const gasOnlyCost = Number(intent.estimatedGasCostUsd ?? 0.12);
    const holdDays = Number(intent.expectedHoldDays ?? 14);
    const aprDecimal = Number(intent.apr ?? intent.apy ?? 0) / 100;
    const minProfitable = computeMinProfitablePositionUsd({
      roundTripCostUsd: gasOnlyCost,
      postedAprDecimal: aprDecimal,
      expectedHoldYearFraction: holdDays / 365,
      safetyFactor: 0.5,
    });
    if (minProfitable !== null && positionUsd < minProfitable) {
      blockers.push(`same_chain_unprofitable:need_$${Math.ceil(minProfitable)}_on_${srcChain}`);
    }
  }

  const gasResult = evaluateGasBudgetController({
    intent,
    auditRecords,
    positionState,
    gasBaselines,
  });
  results.push({
    policy: "gas_budget",
    observedAt: now,
    decision: gasResult.allowed ? "ALLOW" : "BLOCK",
    blockers: gasResult.blockers,
  });
  if (!gasResult.allowed) blockers.push(...gasResult.blockers);

  for (const pos of activePositions) {
    const exitResult = evaluateExitRules({ position: pos, current: pos });
    if (exitResult.triggers.length > 0) {
      blockers.push(`exit_rule_triggered:${pos.opportunityId}`);
    }
  }

  return {
    observedAt: now,
    strategyId: intent.strategyId || null,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers: [...new Set(blockers)],
    results,
  };
}
