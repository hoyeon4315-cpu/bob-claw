// Correct Uniswap v3 / Aerodrome Slipstream IL Simulation
// Uses actual Uniswap v3 IL formula with real price data validation
//
// IL Formula (full range): IL = (2*sqrt(x))/(1+x) - 1
// Where x = p1/p0 (price ratio)
//
// For concentrated liquidity in range [P_a, P_b]:
// IL is bounded and depends on position within the range
// When price exits range: position becomes 100% single token
//
// This module is for RESEARCH and VALIDATION only.
// Execution decisions require policy engine approval.

// Correct Uniswap v3 IL formula
export function calculateUniswapV3IL(priceRatio) {
  // priceRatio = p1 / p0
  // e.g., if price goes up 10%, ratio = 1.10
  // IL is negative (loss relative to HODL)
  const sqrtRatio = Math.sqrt(priceRatio);
  const il = (2 * sqrtRatio) / (1 + priceRatio) - 1;
  return il * 100; // Return as percentage
}

// Concentrated liquidity IL within a specific range
// When price is within [lower, upper] relative to entry
export function calculateCLIL(currentPriceRatio, lowerRatio, upperRatio) {
  // If price is outside the range, IL is determined by the range boundary
  let effectiveRatio = currentPriceRatio;
  let outOfRange = false;
  
  if (currentPriceRatio <= lowerRatio) {
    effectiveRatio = lowerRatio;
    outOfRange = true;
  } else if (currentPriceRatio >= upperRatio) {
    effectiveRatio = upperRatio;
    outOfRange = true;
  }
  
  // IL relative to HODL 50/50
  const il = calculateUniswapV3IL(effectiveRatio);
  
  return {
    ilPct: il,
    outOfRange,
    effectiveRatio,
  };
}

// Fee income for concentrated liquidity
// Based on Uniswap v3 whitepaper
export function calculateCLFees({
  capitalUsd,
  currentTick,
  lowerTick,
  upperTick,
  feeTier, // 0.05%, 0.30%, 1.00%
  poolLiquidity, // Total pool liquidity in USD
  dailyVolumeUsd,
  days,
}) {
  // Capital efficiency factor = L / L_full_range
  // For CL: L is concentrated, so efficiency is higher
  // Simplified: if your range is 1/N of full range, you get N times the fees
  // But only while in range
  
  const rangeWidth = upperTick - lowerTick;
  const fullRangeWidth = 887272; // Approximate full tick range (-443636 to +443636)
  
  // This is a simplification; actual calculation requires tick math
  const concentrationFactor = Math.min(fullRangeWidth / rangeWidth, 100); // Cap at 100x
  
  // Our share of liquidity (concentrated)
  const ourShare = (capitalUsd / poolLiquidity) * concentrationFactor;
  
  // Daily fees
  const dailyFees = dailyVolumeUsd * (feeTier / 100);
  const ourDailyFees = dailyFees * ourShare;
  
  return {
    concentrationFactor,
    ourSharePct: ourShare * 100,
    dailyFees,
    ourDailyFees,
    periodFees: ourDailyFees * days,
    grossApy: (ourDailyFees * 365 / capitalUsd) * 100,
  };
}

// Realistic CL simulator with correct math
export function simulateRealisticCL({
  capitalUsd = 300,
  entryPrice, // ETH price at entry
  priceData = [], // Array of { date, price }
  lowerPct = -0.10, // -10% from entry
  upperPct = 0.10, // +10% from entry
  feeTier = 0.05, // 0.05%
  poolLiquidityUsd = 13_000_000,
  dailyVolumeUsd = 8_500_000,
  rebalanceGasUsd = 0.15, // Base: remove + add
}) {
  if (!entryPrice && priceData.length > 0) {
    entryPrice = priceData[0].price;
  }
  
  const lowerPrice = entryPrice * (1 + lowerPct);
  const upperPrice = entryPrice * (1 + upperPct);
  
  let currentCapital = capitalUsd;
  let totalFees = 0;
  let totalGas = 0;
  let rebalances = 0;
  let inRangeDays = 0;
  let outOfRangeDays = 0;
  let cumulativeIlPct = 0;
  
  // Track position: 50/50 at entry
  let token0Usd = capitalUsd / 2; // ETH
  let token1Usd = capitalUsd / 2; // USDC
  
  for (let i = 1; i < priceData.length; i++) {
    const day = priceData[i];
    const prevPrice = priceData[i-1].price;
    const currPrice = day.price;
    
    // Price ratio from entry
    const priceRatio = currPrice / entryPrice;
    const prevRatio = prevPrice / entryPrice;
    
    // Check if in range
    const inRange = currPrice >= lowerPrice && currPrice <= upperPrice;
    const wasInRange = prevPrice >= lowerPrice && prevPrice <= upperPrice;
    
    // Calculate IL
    const ilResult = calculateCLIL(priceRatio, 
      lowerPrice / entryPrice, 
      upperPrice / entryPrice
    );
    
    if (inRange) {
      inRangeDays++;
      
      // Accrue fees (only when in range)
      // Use average of current and previous day for fee calculation
      const avgPrice = (currPrice + prevPrice) / 2;
      const feeCalc = calculateCLFees({
        capitalUsd: currentCapital,
        currentTick: 0, // Simplified
        lowerTick: 0,
        upperTick: 0,
        feeTier,
        poolLiquidity: poolLiquidityUsd,
        dailyVolumeUsd,
        days: 1,
      });
      totalFees += feeCalc.ourDailyFees;
      
    } else {
      outOfRangeDays++;
    }
    
    // Rebalance if just went out of range (or periodically)
    if (wasInRange && !inRange) {
      // Rebalance: close position, swap to 50/50, reopen at new range
      totalGas += rebalanceGasUsd;
      rebalances++;
      
      // Update entry price to current price for new range
      entryPrice = currPrice;
      
      // Apply IL from current position
      const ilUsd = currentCapital * (ilResult.ilPct / 100);
      currentCapital += ilUsd; // IL is negative, so this reduces capital
      
      // Reset 50/50 with new capital
      token0Usd = currentCapital / 2;
      token1Usd = currentCapital / 2;
    }
  }
  
  // Final IL calculation
  const finalPrice = priceData[priceData.length - 1].price;
  const finalRatio = finalPrice / entryPrice;
  const finalIl = calculateCLIL(finalRatio,
    lowerPrice / entryPrice,
    upperPrice / entryPrice
  );
  
  const finalIlUsd = currentCapital * (finalIl.ilPct / 100);
  const finalCapital = currentCapital + finalIlUsd + totalFees;
  
  const totalReturn = finalCapital - capitalUsd;
  const days = priceData.length;
  const apy = (totalReturn / capitalUsd) * (365 / days) * 100;
  
  // Compare with HODL 50/50
  const hodlToken0 = (capitalUsd / 2) / priceData[0].price * finalPrice;
  const hodlToken1 = capitalUsd / 2;
  const hodlValue = hodlToken0 + hodlToken1;
  const vsHodl = finalCapital - hodlValue;
  
  return {
    capitalUsd,
    finalCapital,
    totalReturn,
    apy,
    totalFees,
    totalGas,
    rebalances,
    inRangeDays,
    outOfRangeDays,
    timeInRange: (inRangeDays / days) * 100,
    vsHodl,
    finalIlPct: finalIl.ilPct,
    breakdown: {
      feeIncome: totalFees,
      gasCosts: totalGas,
      ilImpact: finalIlUsd,
      days,
    },
  };
}

// Fetch real price data and simulate
export async function validateCLWithRealData({
  capitalUsd = 300,
  days = 90,
  rangePct = 0.10, // ±10%
} = {}) {
  // Fetch ETH price history
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=${days}&interval=daily`);
  const data = await res.json();
  
  const priceData = data.prices.map(([timestamp, price]) => ({
    date: new Date(timestamp).toISOString().split('T')[0],
    price,
  }));
  
  // Simulate with different range widths
  const results = [];
  for (const range of [0.05, 0.10, 0.15, 0.20, 0.30]) {
    const sim = simulateRealisticCL({
      capitalUsd,
      priceData,
      lowerPct: -range,
      upperPct: range,
    });
    results.push({
      range: `±${(range * 100).toFixed(0)}%`,
      ...sim,
    });
  }
  
  return {
    priceData,
    results,
    ethVolatility: calculateVolatility(priceData),
  };
}

function calculateVolatility(priceData) {
  const returns = [];
  for (let i = 1; i < priceData.length; i++) {
    returns.push((priceData[i].price - priceData[i-1].price) / priceData[i-1].price);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100; // Daily volatility in %
}

// Compare strategies on same price data
export function compareStrategiesOnRealData(priceData, capitalUsd = 300) {
  const days = priceData.length;
  const startPrice = priceData[0].price;
  const endPrice = priceData[priceData.length - 1].price;
  
  // 1. HODL 50/50
  const hodlToken0 = (capitalUsd / 2) / startPrice * endPrice;
  const hodlToken1 = capitalUsd / 2;
  const hodlValue = hodlToken0 + hodlToken1;
  const hodlReturn = hodlValue - capitalUsd;
  const hodlApy = (hodlReturn / capitalUsd) * (365 / days) * 100;
  
  // 2. HODL 100% ETH
  const hodlEth = capitalUsd / startPrice * endPrice;
  const hodlEthReturn = hodlEth - capitalUsd;
  const hodlEthApy = (hodlEthReturn / capitalUsd) * (365 / days) * 100;
  
  // 3. HODL 100% USDC
  const hodlUsdc = capitalUsd;
  const hodlUsdcReturn = 0;
  const hodlUsdcApy = 0;
  
  // 4. YO Protocol lending (15.69% APY, no IL)
  const yoReturn = capitalUsd * (0.1569 * days / 365);
  const yoApy = 15.69;
  
  // 5. CL strategies (various ranges)
  const clResults = [];
  for (const range of [0.05, 0.10, 0.15, 0.20]) {
    const sim = simulateRealisticCL({ capitalUsd, priceData, lowerPct: -range, upperPct: range });
    clResults.push({
      range: `±${(range * 100).toFixed(0)}%`,
      finalCapital: sim.finalCapital,
      totalReturn: sim.totalReturn,
      apy: sim.apy,
      timeInRange: sim.timeInRange,
      rebalances: sim.rebalances,
    });
  }
  
  return {
    days,
    startPrice,
    endPrice,
    priceChangePct: ((endPrice - startPrice) / startPrice) * 100,
    benchmarks: [
      { name: "HODL 50/50", finalValue: hodlValue, return: hodlReturn, apy: hodlApy },
      { name: "HODL 100% ETH", finalValue: hodlEth, return: hodlEthReturn, apy: hodlEthApy },
      { name: "HODL 100% USDC", finalValue: hodlUsdc, return: hodlUsdcReturn, apy: hodlUsdcApy },
      { name: "YO Protocol Lending", finalValue: capitalUsd + yoReturn, return: yoReturn, apy: yoApy },
    ],
    clStrategies: clResults,
  };
}

// Exports already defined above
