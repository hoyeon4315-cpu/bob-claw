import { evaluateRoundtripEnforcer } from "../../risk/roundtrip-enforcer.mjs";
import { evaluateConcentrationLimits } from "../../config/concentration-limits.mjs";
import { SIZING_POLICY, computeMinProfitablePositionUsd } from "../../config/sizing.mjs";
import { evaluateGasBudgetController } from "../../risk/gas-budget-controller.mjs";
import { evaluateExitRules } from "../../config/merkl-exit-rules.mjs";
import { checkKillSwitch } from "./kill-switch.mjs";
import { evaluateStaleQuote } from "./stale-quote.mjs";

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

  const concResult = evaluateConcentrationLimits({ allocations: projected });
  results.push({
    policy: "concentration_limits",
    observedAt: now,
    decision: concResult.ok ? "ALLOW" : "BLOCK",
    blockers: concResult.violations.map((v) => v.kind),
  });
  if (!concResult.ok) blockers.push(...concResult.violations.map((v) => v.kind));

  const positionUsd = Number(intent.amountUsd ?? intent.positionUsd ?? 0);
  if (positionUsd > 0 && positionUsd < SIZING_POLICY.minPositionUsd) {
    blockers.push("position_below_min_position_usd");
  }
  const totalCapital = Number(capitalState.totalDeployableCapital ?? 0);
  if (totalCapital > 0) {
    const maxPosition = totalCapital * SIZING_POLICY.maxSinglePositionPct;
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
  const srcChain = intent.srcChain || intent.chain;
  const dstChain = intent.dstChain || intent.chain;
  if (srcChain && dstChain && srcChain !== dstChain) {
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
  if (srcChain && dstChain && srcChain === dstChain) {
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
