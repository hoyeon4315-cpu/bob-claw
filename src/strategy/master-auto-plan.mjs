// Master Auto-Strategy v2.0
// Single-concentration + auto-scaling + micro-risk-test
// Capital: $520 full deployment
// 
// AGENTS.md COMPLIANCE:
// - No LLM in trade execution path
// - Policy engine validates every intent
// - Kill-switch checked every tick
// - Auto-pause on drawdown >20%
// - Max $10/month gas budget

import { runAutopilotTick } from "./autopilot-portfolio-rebalancer.mjs";
import { evaluateAerodromeForAutopilot } from "./aerodrome-cl-manager.mjs";
import { fetchRealtimePortfolio, toAutopilotPositions } from "../executor/realtime-portfolio.mjs";
import { evaluateOpportunityPolicy } from "../executor/policy/opportunity-policy.mjs";
import { checkKillSwitch } from "../executor/policy/kill-switch.mjs";

// ═══════════════════════════════════════════════════════════
// CAPITAL ALLOCATION (FULL $520)
// ═══════════════════════════════════════════════════════════

const CAPITAL_PLAN = Object.freeze({
  total: 520,
  primary: {
    strategy: "aerodrome-cl-weth-cbbtc",
    targetUsd: 350,
    targetPct: 0.673,
    expectedApy: 30.0,
    chain: "base",
    autoRebalance: true,
    compoundWeekly: true,
  },
  safety: {
    strategy: "yo-protocol-usdc",
    targetUsd: 125,
    targetPct: 0.240,
    expectedApy: 15.7,
    chain: "base",
  },
  gasReserve: {
    targetUsd: 15.67,
    targetPct: 0.030,
    chain: "base",
  },
  microTest: {
    strategy: "high-risk-test",
    targetUsd: 29.33, // Remainder for testing
    targetPct: 0.056,
    maxPerTest: 20,
    autoRotate: true, // Rotate to best performer monthly
  },
});

// ═══════════════════════════════════════════════════════════
// PHASE 0: CONSOLIDATE ALL CHAINS TO BASE
// ═══════════════════════════════════════════════════════════

const CONSOLIDATION_INTENTS = Object.freeze([
  { step: 1, chain: "ethereum", action: "withdraw", protocol: "morpho-blue", market: "clearstar", amount: 75, gas: 0.73 },
  { step: 2, chain: "ethereum", action: "withdraw", protocol: "morpho-blue", market: "steakhouse", amount: 50, gas: 0.73 },
  { step: 3, chain: "ethereum", action: "withdraw", protocol: "aave-v3", market: "rlusd", amount: 25, gas: 0.97 },
  { step: 4, chain: "ethereum", action: "bridge", asset: "USDC", dstChain: "base", amount: 147, gas: 0.58 },
  { step: 5, chain: "bera", action: "bridge", asset: "BERA", dstChain: "base", amount: 78, gas: 4.00 },
  { step: 6, chain: "avalanche", action: "bridge", asset: "USDC", dstChain: "base", amount: 12, gas: 2.00 },
]);

// ═══════════════════════════════════════════════════════════
// PHASE 1: DEPLOY TO PRIMARY STRATEGY
// ═══════════════════════════════════════════════════════════

const DEPLOYMENT_INTENTS = Object.freeze([
  {
    step: 1,
    chain: "base",
    action: "enter",
    strategy: "aerodrome-cl",
    protocol: "aerodrome-slipstream",
    pool: "0x70d5B6fCa241780fAc5d96Ec3dB1b66e3e63b138",
    pair: "WETH-cbBTC",
    amountUsd: 350,
    token0Pct: 50,
    token1Pct: 50,
    rangeWidthPct: 0.10,
    gas: 0.15,
    expectedApy: 30.0,
  },
  {
    step: 2,
    chain: "base",
    action: "deposit",
    strategy: "yo-protocol",
    protocol: "yo-protocol",
    asset: "USDC",
    amountUsd: 125,
    gas: 0.05,
    expectedApy: 15.7,
  },
]);

// ═══════════════════════════════════════════════════════════
// AUTOMATION ENGINE
// ═══════════════════════════════════════════════════════════

const AUTO_CONFIG = Object.freeze({
  // Tick intervals
  portfolioScanMinutes: 60,
  clMonitorMinutes: 15,
  yieldHarvestDays: 7,
  
  // Rebalancing
  clRebalanceThresholdPct: 8,
  clEmergencyExitPct: 15,
  minHoldDays: 7,
  
  // Auto-scaling
  scaleUpThreshold: 150, // When capital reaches $650, scale to 2 strategies
  scaleUpStrategy: "pendle-yt-or-second-cl",
  
  // Micro-test rotation
  microTestRotationDays: 30,
  microTestMaxLossPct: 50, // Auto-exit if >50% loss
  
  // Risk limits
  maxDrawdownPct: 20,
  maxMonthlyGasUsd: 10,
  minCashReserveUsd: 15,
  
  // Policy
  policyGate: true,
  killSwitchCheck: true,
  autoPauseOnLoss: true,
});

// ═══════════════════════════════════════════════════════════
// MAIN AUTOPILOT TICK
// ═══════════════════════════════════════════════════════════

export async function runMasterAutopilot({
  walletAddress = "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
  dryRun = true,
} = {}) {
  // 1. Kill-switch check
  const ks = await checkKillSwitch({});
  if (ks.decision === "BLOCK") {
    return { status: "halted", reason: "kill_switch", timestamp: new Date().toISOString() };
  }
  
  // 2. Real-time portfolio (RPC)
  const portfolio = await fetchRealtimePortfolio(walletAddress, { useCache: true });
  const positions = toAutopilotPositions(portfolio, {
    priceMap: { ETH: 2300, WETH: 2300, BTC: 95000, WBTC: 95000, cbBTC: 95000, USDC: 1, USDT: 1, BERA: 5, AVAX: 22 },
  });
  
  // 3. Calculate current allocation
  const totalCapital = positions.reduce((s, p) => s + p.allocatedUsd, 0);
  const clPosition = positions.find(p => p.protocol === "aerodrome-slipstream");
  const yoPosition = positions.find(p => p.protocol === "yo-protocol");
  
  // 4. CL auto-management
  const clTick = await evaluateAerodromeForAutopilot({
    totalCapitalUsd: totalCapital,
    currentPositions: positions,
    walletAddress,
  });
  
  // 5. Yield harvest check
  const harvestNeeded = clPosition && (clPosition.accumulatedFeesUsd || 0) > 5;
  
  // 6. Auto-scale check
  const shouldScale = totalCapital > AUTO_CONFIG.scaleUpThreshold;
  
  // 7. Micro-test rotation
  const microTest = positions.find(p => p.strategyId?.includes("micro-test"));
  const shouldRotateMicro = microTest && (Date.now() - (microTest.entryDate || 0)) > AUTO_CONFIG.microTestRotationDays * 86400000;
  
  // 8. Build intents
  const intents = [];
  
  if (clTick.executable && clTick.intent) {
    intents.push(clTick.intent);
  }
  
  if (harvestNeeded && clPosition) {
    intents.push({
      intentType: "harvest_yield",
      strategyId: "aerodrome-cl-harvest",
      chain: "base",
      protocol: "aerodrome-slipstream",
      amountUsd: clPosition.accumulatedFeesUsd,
      action: "compound",
      estimatedGasUsd: 0.10,
    });
  }
  
  if (shouldScale) {
    intents.push({
      intentType: "scale_up",
      strategyId: "auto-scale",
      chain: "base",
      action: "allocate_new_strategy",
      amountUsd: totalCapital * 0.15,
      reason: `capital_exceeded_${AUTO_CONFIG.scaleUpThreshold}`,
    });
  }
  
  // 9. Policy validation
  const validated = [];
  for (const intent of intents) {
    const policy = await evaluateOpportunityPolicy({
      intent,
      capitalState: { totalDeployableCapital: totalCapital },
    });
    validated.push({ intent, policy, approved: policy.decision === "ALLOW" });
  }
  
  return {
    status: "active",
    timestamp: new Date().toISOString(),
    totalCapital,
    clStatus: clTick,
    harvestNeeded,
    shouldScale,
    shouldRotateMicro,
    intents: validated,
    approved: validated.filter(v => v.approved),
    blocked: validated.filter(v => !v.approved),
    dryRun,
    nextTickMinutes: AUTO_CONFIG.portfolioScanMinutes,
  };
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

export { CAPITAL_PLAN, CONSOLIDATION_INTENTS, DEPLOYMENT_INTENTS, AUTO_CONFIG };
export default runMasterAutopilot;
