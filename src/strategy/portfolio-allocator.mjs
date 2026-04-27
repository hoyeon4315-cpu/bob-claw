import { getProtocolTier, computeRiskAdjustedScore } from "../config/protocol-trust-tiers.mjs";
import { computeExtendedNetBtcApy } from "./extended-chain-router.mjs";

const MAX_CHAIN_CONCENTRATION = 0.40;      // 40% per chain
const MAX_PROTOCOL_CONCENTRATION = 0.30;   // 30% per protocol
const MAX_SINGLE_OPPORTUNITY = 0.25;       // 25% per pool
const MIN_OPPORTUNITY_ALLOCATION = 0.02;   // 2% minimum
const REBALANCE_MIN_IMPROVEMENT_BPS = 100; // 1% APY improvement threshold

// Kelly Criterion simplified for multiple uncorrelated opportunities
// f* = (bp - q) / b where b = odds, p = win prob, q = loss prob
// For yield farming: f* ≈ expected_return / variance
function kellyWeight(expectedApy, volatilityEstimate = 0.5) {
  // Conservative half-Kelly
  const fullKelly = expectedApy / (volatilityEstimate * 100);
  return Math.max(0, Math.min(fullKelly * 0.5, 0.25)); // Half-Kelly, cap at 25%
}

export function buildDiversifiedPortfolio({
  opportunities = [],
  totalCapitalBtc = 1.0,
  targetOpportunityCount = 5,
  maxSlippageTolerance = 0.02,
} = {}) {
  if (opportunities.length === 0) return { allocations: [], totalAllocated: 0, cash: totalCapitalBtc };

  // 1. Score and rank all opportunities
  const scored = opportunities.map((opp) => {
    const netBtc = computeExtendedNetBtcApy(opp, 1.0, 30);
    const riskScore = computeRiskAdjustedScore(opp);
    const tier = getProtocolTier(opp.protocol);

    // Estimate volatility from APY components
    const baseApy = opp.apyBase || opp.apy * 0.3;
    const rewardApy = opp.apyReward || opp.apy * 0.7;
    const volEstimate = 0.3 + (rewardApy / Math.max(opp.apy, 1)) * 0.5; // Higher reward = higher vol

    const kelly = kellyWeight(netBtc.netApy, volEstimate);

    return {
      ...opp,
      netBtc,
      riskScore,
      tier,
      kellyWeight: kelly,
      compositeScore: riskScore * kelly * (netBtc.viable ? 1 : 0),
    };
  });

  // Filter viable only, sort by composite score
  // Filter: unknown protocols get heavily penalized or excluded
  const withUnknownPenalty = scored.map((s) => {
    const tier = getProtocolTier(s.protocol);
    if (tier.tierKey === "UNKNOWN") {
      return { ...s, compositeScore: -1 }; // Force to bottom
    }
    return s;
  });

  const viable = withUnknownPenalty
    .filter((s) => s.netBtc.viable && s.netBtc.netApy > 0 && getProtocolTier(s.protocol).tierKey !== "UNKNOWN")
    .sort((a, b) => b.compositeScore - a.compositeScore);

  if (viable.length === 0) return { allocations: [], totalAllocated: 0, cash: totalCapitalBtc };

  // 2. Greedy allocation with concentration limits
  const allocations = [];
  let remainingBtc = totalCapitalBtc;
  const chainAllocated = {};
  const protocolAllocated = {};

  for (const opp of viable.slice(0, targetOpportunityCount * 2)) {
    if (remainingBtc <= 0) break;

    const chain = opp.chain?.toLowerCase().trim() || "unknown";
    const protocol = opp.protocol?.toLowerCase().trim() || "unknown";
    const tier = opp.tier;

    // Check existing concentration
    const chainCurrent = chainAllocated[chain] || 0;
    const protocolCurrent = protocolAllocated[protocol] || 0;

    // Calculate max allowed for this opportunity
    const kellyAlloc = totalCapitalBtc * opp.kellyWeight;
    const tierMax = totalCapitalBtc * tier.maxSingleExposurePct;
    const opportunityMax = totalCapitalBtc * MAX_SINGLE_OPPORTUNITY;
    const chainRemaining = (totalCapitalBtc * MAX_CHAIN_CONCENTRATION) - chainCurrent;
    const protocolRemaining = (totalCapitalBtc * MAX_PROTOCOL_CONCENTRATION) - protocolCurrent;

    const maxAlloc = Math.min(
      kellyAlloc,
      tierMax,
      opportunityMax,
      chainRemaining,
      protocolRemaining,
      remainingBtc
    );

    const minAlloc = totalCapitalBtc * MIN_OPPORTUNITY_ALLOCATION;
    if (maxAlloc < minAlloc) continue;

    // Final allocation
    const allocBtc = Math.max(minAlloc, maxAlloc * (1 - maxSlippageTolerance));

    allocations.push({
      opportunity: opp,
      allocatedBtc: allocBtc,
      allocationPct: allocBtc / totalCapitalBtc,
      expectedNetApy: opp.netBtc.netApy,
      expectedYield30d: allocBtc * (opp.netBtc.netApy / 100) * (30 / 365),
      tier: tier.tierKey,
      riskMultiplier: tier.riskMultiplier,
      chain,
      protocol,
    });

    remainingBtc -= allocBtc;
    chainAllocated[chain] = (chainAllocated[chain] || 0) + allocBtc;
    protocolAllocated[protocol] = (protocolAllocated[protocol] || 0) + allocBtc;
  }

  // Normalize to ensure we don't over-allocate
  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedBtc, 0);

  return {
    allocations,
    totalAllocated,
    cash: Math.max(0, totalCapitalBtc - totalAllocated),
    cashPct: Math.max(0, totalCapitalBtc - totalAllocated) / totalCapitalBtc,
    chainBreakdown: chainAllocated,
    protocolBreakdown: protocolAllocated,
    weightedNetApy: computeWeightedApy(allocations, totalCapitalBtc),
    opportunityCount: allocations.length,
  };
}

function computeWeightedApy(allocations, totalCapital) {
  if (totalCapital <= 0 || allocations.length === 0) return 0;
  const weightedSum = allocations.reduce((s, a) => s + (a.allocatedBtc / totalCapital) * a.expectedNetApy, 0);
  return weightedSum;
}

export function evaluateRebalance({
  currentPortfolio = [],
  newOpportunities = [],
  totalCapitalBtc = 1.0,
  lastRebalanceDays = 0,
  minRebalanceIntervalDays = 7,
} = {}) {
  const newPortfolio = buildDiversifiedPortfolio({
    opportunities: newOpportunities,
    totalCapitalBtc,
  });

  const currentWeightedApy = computeWeightedApy(currentPortfolio, totalCapitalBtc);
  const newWeightedApy = newPortfolio.weightedNetApy;
  const apyImprovement = newWeightedApy - currentWeightedApy;

  // Don't rebalance if too soon and improvement is small
  if (lastRebalanceDays < minRebalanceIntervalDays && apyImprovement < (REBALANCE_MIN_IMPROVEMENT_BPS / 100)) {
    return {
      shouldRebalance: false,
      reason: `interval_not_met_${lastRebalanceDays}d_and_improvement_${apyImprovement.toFixed(2)}%`,
      currentWeightedApy,
      newWeightedApy,
      apyImprovement,
    };
  }

  // Don't rebalance if improvement is tiny
  if (apyImprovement < 0.5) {
    return {
      shouldRebalance: false,
      reason: `improvement_too_small_${apyImprovement.toFixed(2)}%`,
      currentWeightedApy,
      newWeightedApy,
      apyImprovement,
    };
  }

  // Calculate migration plan
  const migrations = [];
  const currentIds = new Set(currentPortfolio.map((p) => p.opportunity?.pool || p.opportunityId));
  const newIds = new Set(newPortfolio.allocations.map((a) => a.opportunity.pool));

  // Find exits
  for (const curr of currentPortfolio) {
    const id = curr.opportunity?.pool || curr.opportunityId;
    if (!newIds.has(id)) {
      migrations.push({
        action: "exit",
        opportunity: curr.opportunity,
        amountBtc: curr.allocatedBtc,
        reason: "better_opportunities_available",
      });
    }
  }

  // Find entries
  for (const alloc of newPortfolio.allocations) {
    if (!currentIds.has(alloc.opportunity.pool)) {
      migrations.push({
        action: "enter",
        opportunity: alloc.opportunity,
        amountBtc: alloc.allocatedBtc,
        expectedNetApy: alloc.expectedNetApy,
        reason: "new_high_score_opportunity",
      });
    }
  }

  // Find size adjustments
  for (const alloc of newPortfolio.allocations) {
    const curr = currentPortfolio.find((c) => (c.opportunity?.pool || c.opportunityId) === alloc.opportunity.pool);
    if (curr) {
      const diff = alloc.allocatedBtc - curr.allocatedBtc;
      if (Math.abs(diff) > curr.allocatedBtc * 0.15) { // >15% size change
        migrations.push({
          action: diff > 0 ? "increase" : "decrease",
          opportunity: alloc.opportunity,
          amountBtc: Math.abs(diff),
          reason: "size_rebalancing",
        });
      }
    }
  }

  return {
    shouldRebalance: true,
    reason: `apy_improvement_${apyImprovement.toFixed(2)}%`,
    currentWeightedApy,
    newWeightedApy,
    apyImprovement,
    newPortfolio,
    migrations,
    migrationCount: migrations.length,
    estimatedGasCost: migrations.length * 0.0001, // Rough estimate
  };
}

export function formatPortfolioReport(portfolio = {}) {
  const lines = [];
  lines.push("=== Diversified BTC Yield Portfolio ===\n");
  lines.push(`Total Capital: ${portfolio.totalCapitalBtc || 1.0} BTC`);
  lines.push(`Allocated: ${portfolio.totalAllocated?.toFixed(8) || 0} BTC (${((portfolio.totalAllocated / (portfolio.totalCapitalBtc || 1)) * 100).toFixed(1)}%)`);
  lines.push(`Cash Reserve: ${portfolio.cash?.toFixed(8) || 0} BTC (${(portfolio.cashPct * 100 || 0).toFixed(1)}%)`);
  lines.push(`Weighted Net APY: ${portfolio.weightedNetApy?.toFixed(2) || 0}%`);
  lines.push(`Opportunities: ${portfolio.opportunityCount || 0}\n`);

  lines.push("Allocations:");
  lines.push("-".repeat(100));
  for (const alloc of portfolio.allocations || []) {
    lines.push(
      `  ${alloc.chain.padEnd(12)} | ${alloc.protocol.padEnd(18)} | ${alloc.opportunity.symbol.padEnd(15)} | ` +
      `${alloc.allocatedBtc.toFixed(6)} BTC (${(alloc.allocationPct * 100).toFixed(1)}%) | ` +
      `Net APY: ${alloc.expectedNetApy.toFixed(2)}% | Tier: ${alloc.tier}`
    );
  }

  lines.push("\nChain Breakdown:");
  for (const [chain, amount] of Object.entries(portfolio.chainBreakdown || {})) {
    const pct = (amount / (portfolio.totalCapitalBtc || 1)) * 100;
    lines.push(`  ${chain.padEnd(12)}: ${amount.toFixed(6)} BTC (${pct.toFixed(1)}%)${pct > 35 ? ' ⚠️ HIGH' : ''}`);
  }

  lines.push("\nProtocol Breakdown:");
  for (const [protocol, amount] of Object.entries(portfolio.protocolBreakdown || {})) {
    const pct = (amount / (portfolio.totalCapitalBtc || 1)) * 100;
    lines.push(`  ${protocol.padEnd(18)}: ${amount.toFixed(6)} BTC (${pct.toFixed(1)}%)${pct > 25 ? ' ⚠️ HIGH' : ''}`);
  }

  return lines.join("\n");
}
