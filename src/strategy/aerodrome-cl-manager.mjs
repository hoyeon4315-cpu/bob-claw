// Aerodrome CL Auto-Manager
// Automated concentrated liquidity management for Aerodrome Slipstream on Base
// Monitors price, rebalances when out of range, exits when unprofitable
//
// Integration: Called by autopilot-portfolio-rebalancer.mjs every 4 hours
// Emits intents only. Never signs. Policy engine validates before execution.

import { evaluateOpportunityPolicy } from "../executor/policy/opportunity-policy.mjs";
import { fetchRealtimePortfolio } from "../executor/realtime-portfolio.mjs";

const AERODROME_CONFIG = Object.freeze({
  chain: "base",
  pool: "0xB4885Bc63399BF5518b994c1b0C2c414af8b858E", // WETH-USDC (example, actual WETH-cbBTC needed)
  poolWethCbbtc: "0x70d5B6fCa241780fAc5d96Ec3dB1b66e3e63b138", // Actual Aerodrome WETH-cbBTC
  token0: "WETH",
  token1: "cbBTC",
  token0Address: "0x4200000000000000000000000000000000000006",
  token1Address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  feeTier: 0.05, // 0.05%
  rebalanceThresholdPct: 8, // Rebalance when price moves 8% from center (80% of ±10% range)
  emergencyExitThresholdPct: 15, // Exit if price moves 15% (beyond ±10% range)
  minHoldingDays: 7, // Don't exit before 7 days (avoid gas churn)
  targetRangeWidthPct: 0.10, // ±10%
});

// Price monitoring via CoinGecko or RPC
export async function fetchEthBtcPrice() {
  try {
    const ethRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd", {
      headers: { Accept: "application/json" },
    });
    const data = await ethRes.json();
    return {
      ethUsd: data.ethereum.usd,
      btcUsd: data.bitcoin.usd,
      ethBtcRatio: data.ethereum.usd / data.bitcoin.usd,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return null;
  }
}

// Calculate current position status
export function calculateCLPositionStatus({
  entryEthBtcRatio,
  currentEthBtcRatio,
  rangeWidthPct = 0.10,
  capitalUsd,
  accumulatedFeesUsd = 0,
  daysHeld = 0,
}) {
  const priceChangePct = ((currentEthBtcRatio - entryEthBtcRatio) / entryEthBtcRatio) * 100;
  const rangeBoundary = rangeWidthPct * 100;
  
  // Distance from center of range
  const distanceFromCenter = Math.abs(priceChangePct);
  
  // IL calculation (Uniswap v3 formula)
  const priceRatio = currentEthBtcRatio / entryEthBtcRatio;
  const il = ((2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1) * 100;
  
  // Current value
  const ilUsd = capitalUsd * (il / 100);
  const currentValue = capitalUsd + ilUsd + accumulatedFeesUsd;
  
  // Status
  const inRange = distanceFromCenter < rangeBoundary;
  const rebalanceNeeded = distanceFromCenter >= (rangeBoundary * 0.8); // 80% of range
  const emergencyExit = distanceFromCenter >= rangeBoundary * 1.5; // Beyond 1.5x range
  
  // Net APY
  const netReturn = currentValue - capitalUsd;
  const netApy = daysHeld > 0 ? (netReturn / capitalUsd) * (365 / daysHeld) * 100 : 0;
  
  return {
    entryEthBtcRatio,
    currentEthBtcRatio,
    priceChangePct,
    distanceFromCenter,
    inRange,
    rebalanceNeeded,
    emergencyExit,
    ilPct: il,
    ilUsd,
    accumulatedFeesUsd,
    currentValue,
    netReturn,
    netApy,
    daysHeld,
  };
}

// Auto-manager tick
export async function runAerodromeManagerTick({
  position = null, // { entryEthBtcRatio, capitalUsd, accumulatedFeesUsd, daysHeld, entryDate }
  walletAddress = "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
} = {}) {
  const prices = await fetchEthBtcPrice();
  if (!prices) {
    return { status: "error", reason: "price_fetch_failed", action: null };
  }
  
  // If no position exists, recommend entry
  if (!position) {
    return {
      status: "recommend_entry",
      currentEthBtcRatio: prices.ethBtcRatio,
      action: {
        type: "enter",
        pool: AERODROME_CONFIG.poolWethCbbtc,
        token0: AERODROME_CONFIG.token0,
        token1: AERODROME_CONFIG.token1,
        rangeWidthPct: AERODROME_CONFIG.targetRangeWidthPct,
        reason: "no_active_position",
      },
    };
  }
  
  // Calculate position status
  const status = calculateCLPositionStatus({
    entryEthBtcRatio: position.entryEthBtcRatio,
    currentEthBtcRatio: prices.ethBtcRatio,
    rangeWidthPct: AERODROME_CONFIG.targetRangeWidthPct,
    capitalUsd: position.capitalUsd,
    accumulatedFeesUsd: position.accumulatedFeesUsd || 0,
    daysHeld: position.daysHeld || 0,
  });
  
  // Decision logic
  let action = null;
  
  if (status.emergencyExit && status.daysHeld >= AERODROME_CONFIG.minHoldingDays) {
    action = {
      type: "exit",
      pool: AERODROME_CONFIG.poolWethCbbtc,
      reason: "emergency_exit_beyond_range",
      details: status,
    };
  } else if (status.rebalanceNeeded) {
    action = {
      type: "rebalance",
      pool: AERODROME_CONFIG.poolWethCbbtc,
      newCenterRatio: prices.ethBtcRatio,
      rangeWidthPct: AERODROME_CONFIG.targetRangeWidthPct,
      reason: "price_near_range_edge",
      details: status,
    };
  } else if (status.netApy < -20 && status.daysHeld >= 14) {
    // Underperforming for 2 weeks
    action = {
      type: "exit",
      pool: AERODROME_CONFIG.poolWethCbbtc,
      reason: "underperforming_negative_apy",
      details: status,
    };
  }
  
  return {
    status: action ? action.type : "hold",
    currentPrices: prices,
    positionStatus: status,
    action,
  };
}

// Build intent for policy engine
export function buildAerodromeIntent(action, walletAddress) {
  if (!action) return null;
  
  const base = {
    schemaVersion: 1,
    intentType: "concentrated_liquidity",
    strategyId: "aerodrome-cl-weth-cbbtc",
    chain: "base",
    protocol: "aerodrome-slipstream",
    pool: action.pool,
    walletAddress,
    observedAt: new Date().toISOString(),
  };
  
  switch (action.type) {
    case "enter":
      return {
        ...base,
        action: "enter",
        amountUsd: action.capitalUsd || 100,
        token0Pct: 50,
        token1Pct: 50,
        rangeWidthPct: action.rangeWidthPct || 0.10,
        estimatedGasUsd: 0.15,
        expectedHoldDays: 30,
      };
      
    case "rebalance":
      return {
        ...base,
        action: "rebalance",
        newRangeCenter: action.newCenterRatio,
        rangeWidthPct: action.rangeWidthPct || 0.10,
        estimatedGasUsd: 0.15,
        reason: action.reason,
      };
      
    case "exit":
      return {
        ...base,
        action: "exit",
        exitTo: "USDC", // Exit to stablecoin
        estimatedGasUsd: 0.10,
        reason: action.reason,
      };
      
    default:
      return null;
  }
}

// Integration with autopilot
export async function evaluateAerodromeForAutopilot({
  totalCapitalUsd,
  currentPositions = [],
  walletAddress = "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
}) {
  // Check if we already have Aerodrome position
  const existingCL = currentPositions.find(p => 
    p.protocol === "aerodrome-slipstream" || p.pool?.includes("aerodrome")
  );
  
  const tick = await runAerodromeManagerTick({
    position: existingCL ? {
      entryEthBtcRatio: existingCL.entryEthBtcRatio,
      capitalUsd: existingCL.allocatedUsd,
      accumulatedFeesUsd: existingCL.accumulatedFeesUsd || 0,
      daysHeld: existingCL.daysHeld || Math.floor((Date.now() - new Date(existingCL.entryDate).getTime()) / 86400000),
    } : null,
    walletAddress,
  });
  
  if (tick.action) {
    const intent = buildAerodromeIntent(tick.action, walletAddress);
    if (intent) {
      const policy = await evaluateOpportunityPolicy({
        intent,
        capitalState: { totalDeployableCapital: totalCapitalUsd },
      });
      
      return {
        ...tick,
        intent,
        policy,
        executable: policy.decision === "ALLOW",
      };
    }
  }
  
  return { ...tick, intent: null, policy: null, executable: false };
}

export { AERODROME_CONFIG };
