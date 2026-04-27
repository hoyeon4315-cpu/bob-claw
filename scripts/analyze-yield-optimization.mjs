import { writeFile, mkdir } from "node:fs/promises";

// ===== 1. Compound Frequency Optimization =====
// Model: find optimal compounding frequency given APY, principal, gas cost
// n* ≈ sqrt(2 * r * P / G)  where r = daily rate, P = principal, G = gas per compound
// This is a simplified Kelly-like approximation

function optimalCompoundFreq(apyPct, principal, gasPerCompound) {
  const dailyRate = apyPct / 100 / 365;
  const nStar = Math.sqrt((2 * dailyRate * principal) / gasPerCompound);
  return Math.max(1, Math.round(nStar));
}

function simulateCompound(apyPct, principal, days, compoundsPerYear, gasPerCompound) {
  const r = apyPct / 100;
  const n = compoundsPerYear;
  const compoundDays = 365 / n;
  const periods = Math.floor(days / compoundDays);
  const remainderDays = days % compoundDays;

  let value = principal;
  let totalGas = 0;

  for (let i = 0; i < periods; i++) {
    value = value * (1 + r / n);
    totalGas += gasPerCompound;
  }

  // Simple interest for remainder
  if (remainderDays > 0) {
    value = value * (1 + (r / 365) * remainderDays);
  }

  const grossProfit = value - principal;
  const netProfit = grossProfit - totalGas;
  return {
    periods,
    finalValue: value,
    grossProfit,
    totalGas,
    netProfit,
    netApy: (netProfit / principal) * (365 / days) * 100,
  };
}

console.log("=== Compound Frequency Optimization (Base, Morpho STEAKUSDC 4.09%) ===");
const PRINCIPAL = 1000;
const APY = 4.09;
const GAS_PER_COMPOUND = 0.06; // Base claim + deposit
const DAYS = 14;

const freqs = [1, 2, 4, 7, 14, 30, 52, 365];
for (const freq of freqs) {
  const sim = simulateCompound(APY, PRINCIPAL, DAYS, freq, GAS_PER_COMPOUND);
  console.log(
    `${freq.toString().padStart(3)}x/yr | periods:${sim.periods.toString().padStart(2)} | gross:$${sim.grossProfit.toFixed(4)} | gas:$${sim.totalGas.toFixed(2)} | net:$${sim.netProfit.toFixed(4)} | netAPY:${sim.netApy.toFixed(2)}%`
  );
}

const optimalFreq = optimalCompoundFreq(APY, PRINCIPAL, GAS_PER_COMPOUND);
console.log(`\nOptimal frequency (approx): ${optimalFreq}x/year = ${(365 / optimalFreq).toFixed(1)} days`);

// ===== 2. Leverage Loop Model =====
// Simple model: deposit collateral → borrow → redeposit
// Assumes collateral and borrow are same asset (USDC) for simplicity
// LTV = loan-to-value, borrowAPY = cost of borrowing

function simulateLeverage({ principal, baseApy, borrowApy, ltv, leverage, gasEntry, gasExit, days }) {
  const leveragedPrincipal = principal * leverage;
  const borrowed = leveragedPrincipal - principal;
  const grossYield = leveragedPrincipal * (baseApy / 100) * (days / 365);
  const borrowCost = borrowed * (borrowApy / 100) * (days / 365);
  const totalGas = gasEntry + gasExit;
  const netProfit = grossYield - borrowCost - totalGas;
  return {
    leveragedPrincipal,
    borrowed,
    grossYield,
    borrowCost,
    totalGas,
    netProfit,
    netApy: (netProfit / principal) * (365 / days) * 100,
    healthFactor: 1 / ltv / leverage, // simplified
  };
}

console.log("\n=== Leverage Loop Simulation (Morpho Blue) ===");
console.log("Principal: $1,000 | Base APY: 4.09% | Borrow APY: 2.0% | LTV: 80% | Base gas");

const leverages = [1, 2, 3, 4, 5];
for (const lev of leverages) {
  const sim = simulateLeverage({
    principal: 1000,
    baseApy: 4.09,
    borrowApy: 2.0,
    ltv: 0.80,
    leverage: lev,
    gasEntry: 0.12,
    gasExit: 0.12,
    days: 14,
  });
  const hfColor = sim.healthFactor < 1.1 ? "CRITICAL" : sim.healthFactor < 1.3 ? "RISKY" : "SAFE";
  console.log(
    `${lev}x | gross:$${sim.grossYield.toFixed(2)} | borrow:$${sim.borrowCost.toFixed(2)} | gas:$${sim.totalGas.toFixed(2)} | net:$${sim.netProfit.toFixed(2)} | netAPY:${sim.netApy.toFixed(2)}% | HF:${sim.healthFactor.toFixed(2)} ${hfColor}`
  );
}

// ===== 3. Cross-chain vs Same-chain Comparison =====
console.log("\n=== Cross-chain vs Same-chain (14 days, $1,000) ===");
const scenarios = [
  { name: "Same-chain (Base only)", bridge: 0, gasEntry: 0.06, gasExit: 0.06, apy: 4.09 },
  { name: "Cross-chain (Base→Eth, Across)", bridge: 0.33, gasEntry: 5.0, gasExit: 3.0, apy: 5.5 }, //假设 Ethereum 有更高 APY
  { name: "Cross-chain (Base→Eth, LiFi)", bridge: 0.25, gasEntry: 5.0, gasExit: 3.0, apy: 5.5 },
];

for (const s of scenarios) {
  const gross = 1000 * (s.apy / 100) * (14 / 365);
  const totalCost = s.bridge + s.gasEntry + s.gasExit;
  const net = gross - totalCost;
  console.log(
    `${s.name.padEnd(40)} | gross:$${gross.toFixed(2)} | cost:$${totalCost.toFixed(2)} | net:$${net.toFixed(2)} | netAPY:${((net/1000)*(365/14)*100).toFixed(2)}%`
  );
}

// ===== 4. Scaling Analysis =====
console.log("\n=== Scaling: Same-chain optimal amount (Base, 4.09%, 14d) ===");
for (const amt of [100, 500, 1000, 5000, 10000, 50000]) {
  const gross = amt * (4.09 / 100) * (14 / 365);
  const gas = 0.12; // fixed on Base
  const net = gross - gas;
  const netApy = (net / amt) * (365 / 14) * 100;
  console.log(
    `$${amt.toString().padStart(6)} | gross:$${gross.toFixed(4)} | gas:$${gas.toFixed(2)} | net:$${net.toFixed(4)} | netAPY:${netApy.toFixed(2)}% | gas/gross:${((gas/gross)*100).toFixed(1)}%`
  );
}

// Save analysis
const analysis = {
  compoundOptimization: { principal: PRINCIPAL, apy: APY, gasPerCompound: GAS_PER_COMPOUND, optimalFreq },
  leverageSimulation: leverages.map((lev) => ({
    leverage: lev,
    ...simulateLeverage({ principal: 1000, baseApy: 4.09, borrowApy: 2.0, ltv: 0.80, leverage: lev, gasEntry: 0.12, gasExit: 0.12, days: 14 }),
  })),
  bridgeThreshold: [
    { amount: 10, acrossBps: 3340, lifiBps: 250, acrossBreakevenApy: 118.4, lifiBreakevenApy: 37.8 },
    { amount: 100, acrossBps: 334, lifiBps: 25, acrossBreakevenApy: 11.8, lifiBreakevenApy: 9.6 },
    { amount: 1000, acrossBps: 33, lifiBps: 25, acrossBreakevenApy: 1.2, lifiBreakevenApy: 6.8 },
    { amount: 5000, acrossBps: 7, lifiBps: 25, acrossBreakevenApy: 0.2, lifiBreakevenApy: 6.6 },
  ],
  safeBasePools: [
    { apy: 4.09, tvlUsd: 470930000, project: "morpho-blue", symbol: "STEAKUSDC", pool: "7820bd3c-461a-4811-9f0b-1d39c1503c3f" },
    { apy: 3.45, tvlUsd: 21650000, project: "aave-v3", symbol: "USDC", pool: "7e0661bf-8cf3-45e6-9424-31916d4c7b84" },
    { apy: 4.23, tvlUsd: 55970000, project: "morpho-blue", symbol: "GTUSDCP", pool: "df7ccfd1-2642-4d79-851a-a5b07d9b8a97" },
  ],
};

await mkdir("data/opportunities", { recursive: true });
await writeFile("data/opportunities/yield-optimization-analysis.json", JSON.stringify(analysis, null, 2));
console.log("\nSaved to data/opportunities/yield-optimization-analysis.json");
