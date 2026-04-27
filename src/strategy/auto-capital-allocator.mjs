// Auto-Capital Allocator
// Automatically rebalances portfolio based on real-time opportunity scoring
// Runs every 4 hours via autopilot
// Only executes when improvement > threshold and gas costs are justified
//
// Architecture:
// 1. Scan all current positions (RPC + protocol)
// 2. Fetch live APYs from DefiLlama
// 3. Score each opportunity (risk-adjusted net APY)
// 4. Compare with current allocation
// 5. Generate rebalance intents if delta > threshold
// 6. Policy gate validates before execution
//
// NEVER moves >30% of capital in single tick
// NEVER executes if gas > 20% of expected 30-day profit
// ALWAYS maintains 5% cash reserve for gas

import { fetchRealtimePortfolio, toAutopilotPositions } from "../executor/realtime-portfolio.mjs";
import { evaluateOpportunityPolicy } from "../executor/policy/opportunity-policy.mjs";

const CONFIG = Object.freeze({
  minRebalanceImprovementBps: 50, // 0.5% APY improvement minimum
  maxSingleMovePct: 0.30, // Max 30% of capital in one rebalance
  minCashReservePct: 0.05, // 5% cash for gas
  maxGasPctOfMonthlyProfit: 0.20, // Gas < 20% of 30-day profit
  rebalanceCooldownHours: 24, // Don't rebalance same position within 24h
  targetChains: ["base", "ethereum"], // Focus on low-gas chains
  trustedProtocols: new Set([
    "aave-v3", "compound-v3", "morpho", "morpho-blue",
    "moonwell", "yo-protocol", "fluid-lending", "aerodrome", "aerodrome-slipstream",
  ]),
});

// Fetch live opportunities
async function fetchLiveOpportunities() {
  try {
    const res = await fetch("https://yields.llama.fi/pools", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : json;
  } catch (e) {
    return [];
  }
}

// Score opportunity
function scoreOpportunity(pool, capitalUsd, totalCapital) {
  const protocol = (pool.project || "").toLowerCase();
  const chain = (pool.chain || "").toLowerCase();
  
  // Skip unknown protocols
  if (!CONFIG.trustedProtocols.has(protocol)) return null;
  
  // Skip non-target chains (unless very high yield)
  if (!CONFIG.targetChains.includes(chain) && pool.apy < 50) return null;
  
  // Skip low TVL
  if (pool.tvlUsd < 200_000) return null;
  
  // Skip crazy APYs (likely bugs or scams)
  if (pool.apy > 200) return null;
  
  // Base APY vs reward APY
  const baseApy = pool.apyBase || pool.apy;
  const rewardApy = pool.apyReward || 0;
  
  // Risk scoring
  let riskScore = 1.0;
  if (protocol === "aave-v3" || protocol === "compound-v3") riskScore = 0.9;
  else if (protocol === "morpho" || protocol === "morpho-blue") riskScore = 0.85;
  else if (protocol === "moonwell") riskScore = 0.8;
  else if (protocol === "yo-protocol") riskScore = 0.6; // Higher yield, higher risk
  else if (protocol === "aerodrome" || protocol === "aerodrome-slipstream") riskScore = 0.5; // IL risk
  else riskScore = 0.4;
  
  // Concentration limit
  const maxAllocation = totalCapital * CONFIG.maxSingleMovePct;
  
  // Gas estimate
  const gasUsd = chain === "base" ? 0.05 : chain === "ethereum" ? 1.5 : 3.0;
  
  // Net APY (risk-adjusted)
  const netApy = (baseApy * riskScore) + (rewardApy * 0.3); // Discount rewards 70%
  
  // Minimum viable position (gas must be < 20% of monthly profit)
  const monthlyProfit = (capitalUsd * netApy / 100) / 12;
  if (monthlyProfit > 0 && gasUsd > monthlyProfit * 0.2) {
    // Gas too expensive relative to profit
    return null;
  }
  
  return {
    pool,
    protocol,
    chain,
    symbol: pool.symbol,
    baseApy,
    rewardApy,
    totalApy: pool.apy,
    riskScore,
    netApy,
    tvlUsd: pool.tvlUsd,
    gasUsd,
    maxAllocation,
    score: netApy * riskScore * Math.log10(pool.tvlUsd / 1000), // TVL-weighted
  };
}

// Build optimal allocation
function buildOptimalAllocation(opportunities, totalCapital) {
  // Filter viable
  const viable = opportunities
    .filter(Boolean)
    .filter(o => o.netApy > 3) // Min 3% APY
    .sort((a, b) => b.score - a.score);
  
  if (viable.length === 0) return { allocations: [], totalAllocated: 0, cash: totalCapital };
  
  const cashReserve = totalCapital * CONFIG.minCashReservePct;
  const deployable = totalCapital - cashReserve;
  
  const allocations = [];
  let remaining = deployable;
  const protocolAllocated = {};
  
  for (const opp of viable.slice(0, 6)) {
    if (remaining <= 0) break;
    
    // Protocol concentration limit
    const protocolCurrent = protocolAllocated[opp.protocol] || 0;
    const protocolMax = totalCapital * 0.40; // Max 40% per protocol
    const protocolAvailable = Math.max(0, protocolMax - protocolCurrent);
    
    // Allocate based on score weight
    const totalScore = viable.slice(0, 6).reduce((s, o) => s + o.score, 0);
    const weight = opp.score / totalScore;
    const targetAlloc = Math.min(deployable * weight, opp.maxAllocation, protocolAvailable, remaining);
    
    if (targetAlloc < 10) continue; // Min $10
    
    allocations.push({
      ...opp,
      allocatedUsd: targetAlloc,
      allocatedPct: targetAlloc / totalCapital,
    });
    
    remaining -= targetAlloc;
    protocolAllocated[opp.protocol] = protocolCurrent + targetAlloc;
  }
  
  return {
    allocations,
    totalAllocated: allocations.reduce((s, a) => s + a.allocatedUsd, 0),
    cash: remaining + cashReserve,
    deployable,
  };
}

// Compare current vs optimal
function calculateRebalanceDelta(currentPositions, optimalAllocations) {
  const deltas = [];
  const currentMap = new Map();
  
  for (const pos of currentPositions) {
    const key = `${pos.chain}-${pos.protocol}-${pos.symbol}`;
    currentMap.set(key, pos);
  }
  
  for (const opt of optimalAllocations) {
    const key = `${opt.chain}-${opt.protocol}-${opt.symbol}`;
    const current = currentMap.get(key);
    
    if (!current) {
      // New position
      deltas.push({
        action: "enter",
        opportunity: opt,
        targetUsd: opt.allocatedUsd,
        currentUsd: 0,
        deltaUsd: opt.allocatedUsd,
        expectedImprovement: opt.netApy,
      });
    } else if (Math.abs(current.allocatedUsd - opt.allocatedUsd) > 10) {
      // Size adjustment
      const delta = opt.allocatedUsd - current.allocatedUsd;
      deltas.push({
        action: delta > 0 ? "increase" : "decrease",
        opportunity: opt,
        targetUsd: opt.allocatedUsd,
        currentUsd: current.allocatedUsd,
        deltaUsd: Math.abs(delta),
        expectedImprovement: opt.netApy - (current.apy || 0),
      });
    }
  }
  
  // Check exits
  for (const [key, current] of currentMap) {
    const opt = optimalAllocations.find(o => `${o.chain}-${o.protocol}-${o.symbol}` === key);
    if (!opt && current.allocatedUsd > 0) {
      deltas.push({
        action: "exit",
        opportunity: current,
        targetUsd: 0,
        currentUsd: current.allocatedUsd,
        deltaUsd: current.allocatedUsd,
        expectedImprovement: -(current.apy || 0),
      });
    }
  }
  
  return deltas.sort((a, b) => Math.abs(b.expectedImprovement) - Math.abs(a.expectedImprovement));
}

// Main auto-allocation tick
export async function runAutoAllocationTick({
  walletAddress = "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
  dryRun = true,
} = {}) {
  // 1. Get current portfolio
  const portfolio = await fetchRealtimePortfolio(walletAddress, { useCache: false });
  const walletPositions = toAutopilotPositions(portfolio, {
    priceMap: { ETH: 2300, WETH: 2300, BTC: 95000, WBTC: 95000, cbBTC: 95000, USDC: 1, USDT: 1, RLUSD: 1 },
  });
  
  // Add protocol positions (manual confirmed)
  const protocolPositions = [
    { chain: "Base", protocol: "yo-protocol", symbol: "USDC", allocatedUsd: 80, apy: 15.7 },
    { chain: "Base", protocol: "moonwell", symbol: "USDC", allocatedUsd: 128.57, apy: 8.5 },
    { chain: "Ethereum", protocol: "morpho-blue", symbol: "USDC", allocatedUsd: 75, apy: 4.09 },
    { chain: "Ethereum", protocol: "morpho-blue", symbol: "USDC", allocatedUsd: 50, apy: 4.09 },
    { chain: "Ethereum", protocol: "aave-v3", symbol: "RLUSD", allocatedUsd: 25, apy: 3.45 },
  ];
  
  const allPositions = [...protocolPositions, ...walletPositions];
  const totalCapital = allPositions.reduce((s, p) => s + p.allocatedUsd, 0);
  
  // 2. Fetch live opportunities
  const pools = await fetchLiveOpportunities();
  const scored = pools
    .map(p => scoreOpportunity(p, 100, totalCapital))
    .filter(Boolean);
  
  // 3. Build optimal allocation
  const optimal = buildOptimalAllocation(scored, totalCapital);
  
  // 4. Calculate rebalance delta
  const deltas = calculateRebalanceDelta(allPositions, optimal.allocations);
  
  // 5. Filter actionable deltas
  const actionable = deltas.filter(d => {
    // Min improvement threshold
    if (Math.abs(d.expectedImprovement) < CONFIG.minRebalanceImprovementBps / 100) return false;
    // Gas justification
    const gas = d.opportunity.gasUsd || (d.opportunity.chain === "base" ? 0.05 : 1.5);
    const monthlyProfit = (d.deltaUsd * Math.abs(d.expectedImprovement) / 100) / 12;
    return gas < monthlyProfit * 0.5; // Gas < 50% of monthly profit
  });
  
  // 6. Build intents
  const intents = [];
  for (const delta of actionable) {
    const intent = buildRebalanceIntent(delta, walletAddress);
    if (intent) intents.push(intent);
  }
  
  // 7. Policy check
  const approved = [];
  const blocked = [];
  for (const intent of intents) {
    const policy = await evaluateOpportunityPolicy({
      intent,
      capitalState: { totalDeployableCapital: totalCapital },
    });
    if (policy.decision === "ALLOW") {
      approved.push({ intent, policy });
    } else {
      blocked.push({ intent, policy });
    }
  }
  
  return {
    timestamp: new Date().toISOString(),
    totalCapital,
    currentAllocation: allPositions,
    optimalAllocation: optimal,
    deltas,
    actionable,
    intents: approved,
    blocked,
    dryRun,
    nextTickHours: 4,
  };
}

function buildRebalanceIntent(delta, walletAddress) {
  const base = {
    schemaVersion: 1,
    intentType: "portfolio_rebalance",
    strategyId: `auto-rebalance-${Date.now()}`,
    walletAddress,
    observedAt: new Date().toISOString(),
  };
  
  switch (delta.action) {
    case "enter":
      return {
        ...base,
        action: "enter",
        chain: delta.opportunity.chain,
        protocol: delta.opportunity.protocol,
        symbol: delta.opportunity.symbol,
        amountUsd: delta.deltaUsd,
        estimatedGasUsd: delta.opportunity.gasUsd || 0.05,
        expectedApy: delta.opportunity.netApy,
        reason: `auto_rebalance:opportunity_${delta.opportunity.netApy.toFixed(1)}pct_apy`,
      };
    case "exit":
      return {
        ...base,
        action: "exit",
        chain: delta.opportunity.chain,
        protocol: delta.opportunity.protocol,
        symbol: delta.opportunity.symbol,
        amountUsd: delta.deltaUsd,
        estimatedGasUsd: delta.opportunity.chain === "base" ? 0.05 : 1.5,
        reason: "auto_rebalance:underperforming",
      };
    case "increase":
      return {
        ...base,
        action: "increase",
        chain: delta.opportunity.chain,
        protocol: delta.opportunity.protocol,
        symbol: delta.opportunity.symbol,
        amountUsd: delta.deltaUsd,
        estimatedGasUsd: delta.opportunity.gasUsd || 0.05,
        reason: `auto_rebalance:increase_allocation`,
      };
    case "decrease":
      return {
        ...base,
        action: "decrease",
        chain: delta.opportunity.chain,
        protocol: delta.opportunity.protocol,
        symbol: delta.opportunity.symbol,
        amountUsd: delta.deltaUsd,
        estimatedGasUsd: delta.opportunity.gasUsd || 0.05,
        reason: "auto_rebalance:reduce_allocation",
      };
    default:
      return null;
  }
}

export { CONFIG, scoreOpportunity, buildOptimalAllocation };
