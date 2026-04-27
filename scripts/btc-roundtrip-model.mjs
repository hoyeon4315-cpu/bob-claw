// BTC Round-trip Yield Model
// Bitcoin L1 → BOB Gateway → Destination Chain → DeFi Yield → BOB Gateway → Bitcoin L1

const BTC_PRICE_USD = 95000; // Approximate BTC price
const SATOSHIS_PER_BTC = 100_000_000;

// Gateway costs from AGENTS.md memory + recent live proofs
const GATEWAY_COSTS = {
  onramp: {
    // Bitcoin L1 → BOB L2 wBTC.OFT
    btcTxFeeSats: 2000, // ~$1.90 at 95k
    gatewayFeeSats: 1000, // ~$0.95
    totalSats: 3000,
  },
  offramp: {
    // wBTC.OFT → BOB L2 → Bitcoin L1
    gatewayFeeSats: 1500,
    btcTxFeeSats: 2000,
    totalSats: 3500,
  },
};

// Chain-specific DeFi entry/exit gas estimates (in native token, converted to USD)
const CHAIN_GAS = {
  "Base": { entryUsd: 0.06, exitUsd: 0.06, nativeToken: "ETH" },
  "Ethereum": { entryUsd: 5.0, exitUsd: 3.0, nativeToken: "ETH" },
  "BOB L2": { entryUsd: 0.06, exitUsd: 0.06, nativeToken: "ETH" },
  "BNB": { entryUsd: 0.05, exitUsd: 0.05, nativeToken: "BNB" },
  "Avalanche": { entryUsd: 0.10, exitUsd: 0.10, nativeToken: "AVAX" },
  "Optimism": { entryUsd: 0.15, exitUsd: 0.15, nativeToken: "ETH" },
  "Berachain": { entryUsd: 0.20, exitUsd: 0.20, nativeToken: "BERA" },
  "Unichain": { entryUsd: 0.06, exitUsd: 0.06, nativeToken: "ETH" },
  "Soneium": { entryUsd: 0.10, exitUsd: 0.10, nativeToken: "ETH" },
  "Sei": { entryUsd: 0.05, exitUsd: 0.05, nativeToken: "SEI" },
  "Sonic": { entryUsd: 0.05, exitUsd: 0.05, nativeToken: "S" },
};

// Best opportunities per chain from scan
const OPPORTUNITIES = [
  // BTC-native opportunities
  { chain: "Base", protocol: "aerodrome-slipstream", asset: "cbBTC-USDC", apy: 89.29, tvlM: 12.20, rewardDominant: true, baseApy: 16.91 },
  { chain: "Base", protocol: "aerodrome-slipstream", asset: "WETH-cbBTC", apy: 51.61, tvlM: 23.17, rewardDominant: true, baseApy: 8.81 },
  { chain: "Ethereum", protocol: "uniswap-v4", asset: "WBTC-USDC", apy: 22.73, tvlM: 19.94, rewardDominant: false },
  { chain: "Ethereum", protocol: "curve-dex", asset: "crvUSD-cbBTC", apy: 8.80, tvlM: 144.99, rewardDominant: false },
  { chain: "Berachain", protocol: "berapaw", asset: "KODIWBTC-HONEY", apy: 13.39, tvlM: 1.18, rewardDominant: true, baseApy: 0 },
  
  // Stablecoin opportunities (BTC→stable→yield→BTC triangular)
  { chain: "Base", protocol: "yo-protocol", asset: "USDC", apy: 15.69, tvlM: 19.12, rewardDominant: false, isStable: true },
  { chain: "Base", protocol: "aerodrome-v1", asset: "MSUSD-USDC", apy: 9.26, tvlM: 7.67, rewardDominant: false, isStable: true },
  { chain: "Ethereum", protocol: "morpho-blue", asset: "USDC", apy: 20.77, tvlM: 8.19, rewardDominant: false, isStable: true },
  { chain: "BNB", protocol: "lista-lending", asset: "USDT", apy: 11.69, tvlM: 5.37, rewardDominant: false, isStable: true },
  { chain: "Avalanche", protocol: "avant-avusd", asset: "savUSD", apy: 8.37, tvlM: 61.98, rewardDominant: false, isStable: true },
];

function btc(sats) {
  return sats / SATOSHIS_PER_BTC;
}

function sats(btcAmount) {
  return Math.round(btcAmount * SATOSHIS_PER_BTC);
}

function simulateRoundTrip({ principalBtc, opportunity, holdDays, swapCostBps = 0 }) {
  const principalUsd = principalBtc * BTC_PRICE_USD;
  const gatewayEntrySats = GATEWAY_COSTS.onramp.totalSats;
  const gatewayExitSats = GATEWAY_COSTS.offramp.totalSats;
  
  const gas = CHAIN_GAS[opportunity.chain] || { entryUsd: 0.50, exitUsd: 0.50 };
  const gasEntrySats = sats(gas.entryUsd / BTC_PRICE_USD);
  const gasExitSats = sats(gas.exitUsd / BTC_PRICE_USD);
  
  // Swap cost if going through stablecoin route
  const swapCostSats = opportunity.isStable ? sats((principalUsd * (swapCostBps / 10000)) / BTC_PRICE_USD) : 0;
  
  const totalCostSats = gatewayEntrySats + gasEntrySats + gasExitSats + gatewayExitSats + swapCostSats;
  const totalCostBtc = btc(totalCostSats);
  
  // Gross yield
  const yearFraction = holdDays / 365;
  const grossYieldBtc = principalBtc * (opportunity.apy / 100) * yearFraction;
  
  // Net yield
  const netYieldBtc = grossYieldBtc - totalCostBtc;
  const netApy = principalBtc > 0 ? (netYieldBtc / principalBtc) * (365 / holdDays) * 100 : 0;
  const breakevenDays = grossYieldBtc > 0 ? Math.ceil(totalCostBtc / (grossYieldBtc / holdDays)) : Infinity;
  
  return {
    principalBtc,
    principalUsd,
    opportunity,
    holdDays,
    costs: {
      gatewayEntry: btc(gatewayEntrySats),
      gasEntry: btc(gasEntrySats),
      gasExit: btc(gasExitSats),
      gatewayExit: btc(gatewayExitSats),
      swapCost: btc(swapCostSats),
      total: totalCostBtc,
    },
    grossYieldBtc,
    netYieldBtc,
    netApy,
    breakevenDays,
    viable: netYieldBtc > 0,
  };
}

console.log("=== BTC Round-trip Yield Analysis ===\n");
console.log(`BTC Price: $${BTC_PRICE_USD.toLocaleString()}`);
console.log(`Gateway onramp: ${btc(GATEWAY_COSTS.onramp.totalSats)} BTC ($${(btc(GATEWAY_COSTS.onramp.totalSats) * BTC_PRICE_USD).toFixed(2)})`);
console.log(`Gateway offramp: ${btc(GATEWAY_COSTS.offramp.totalSats)} BTC ($${(btc(GATEWAY_COSTS.offramp.totalSats) * BTC_PRICE_USD).toFixed(2)})`);
console.log("");

const principals = [0.001, 0.01, 0.1, 1.0];
const holdDays = 30;

for (const principalBtc of principals) {
  console.log(`\n--- Principal: ${principalBtc} BTC ($${(principalBtc * BTC_PRICE_USD).toLocaleString()}) | Hold: ${holdDays} days ---\n`);
  
  const results = OPPORTUNITIES.map((opp) => simulateRoundTrip({ principalBtc, opportunity: opp, holdDays, swapCostBps: opp.isStable ? 50 : 0 }));
  results.sort((a, b) => b.netApy - a.netApy);
  
  for (const r of results) {
    const flag = r.viable ? "✅" : "❌";
    const assetType = r.opportunity.isStable ? "[STABLE-ROUTE]" : "[BTC-NATIVE]";
    console.log(
      `${flag} ${assetType} ${r.opportunity.chain.padEnd(10)} | ${r.opportunity.protocol.padEnd(20)} | ${r.opportunity.asset.padEnd(15)} | ${r.opportunity.apy.toFixed(2)}% | Net: ${r.netYieldBtc.toFixed(8)} BTC (${r.netApy.toFixed(2)}% APY) | Break-even: ${r.breakevenDays}d`
    );
  }
}

// Multi-chain hop model
console.log("\n\n=== Multi-Chain BTC Tourism Model ===\n");
console.log("Bitcoin L1 → Base (yield) → Ethereum (higher yield) → Bitcoin L1\n");

function simulateMultiHop({ principalBtc, hops, holdDaysPerHop }) {
  let currentBtc = principalBtc;
  let totalCostBtc = 0;
  const log = [];
  
  // Entry
  const entryCost = btc(GATEWAY_COSTS.onramp.totalSats);
  currentBtc -= entryCost;
  totalCostBtc += entryCost;
  log.push({ action: "entry", chain: hops[0].chain, costBtc: entryCost });
  
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const gas = CHAIN_GAS[hop.chain] || { entryUsd: 0.50, exitUsd: 0.50 };
    const gasEntry = sats(gas.entryUsd / BTC_PRICE_USD);
    const gasExit = sats(gas.exitUsd / BTC_PRICE_USD);
    
    currentBtc -= btc(gasEntry);
    totalCostBtc += btc(gasEntry);
    
    const yieldBtc = currentBtc * (hop.apy / 100) * (holdDaysPerHop / 365);
    currentBtc += yieldBtc;
    
    log.push({ action: "yield", chain: hop.chain, apy: hop.apy, earnedBtc: yieldBtc, balanceBtc: currentBtc });
    
    if (i < hops.length - 1) {
      // Inter-chain bridge: 25 bps of principal value in BTC
      const bridgeCostBtc = currentBtc * 0.0025; // 25 bps
      currentBtc -= bridgeCostBtc;
      totalCostBtc += bridgeCostBtc;
      log.push({ action: "bridge", from: hop.chain, to: hops[i+1].chain, costBtc: bridgeCostBtc });
    }
    
    currentBtc -= btc(gasExit);
    totalCostBtc += btc(gasExit);
  }
  
  // Exit
  const exitCost = btc(GATEWAY_COSTS.offramp.totalSats);
  currentBtc -= exitCost;
  totalCostBtc += exitCost;
  log.push({ action: "exit", costBtc: exitCost, finalBtc: currentBtc });
  
  const netYield = currentBtc - principalBtc;
  const totalDays = holdDaysPerHop * hops.length;
  const netApy = (netYield / principalBtc) * (365 / totalDays) * 100;
  
  return { principalBtc, finalBtc: currentBtc, netYield, netApy, totalCostBtc, log };
}

const multiHopScenarios = [
  {
    name: "Base → Ethereum (2 hops)",
    principalBtc: 1.0,
    hops: [
      { chain: "Base", apy: 9.26, protocol: "aerodrome-v1", asset: "MSUSD-USDC" },
      { chain: "Ethereum", apy: 20.77, protocol: "morpho-blue", asset: "USDC" },
    ],
    holdDaysPerHop: 30,
  },
  {
    name: "Ethereum only (1 hop)",
    principalBtc: 1.0,
    hops: [
      { chain: "Ethereum", apy: 20.77, protocol: "morpho-blue", asset: "USDC" },
    ],
    holdDaysPerHop: 60,
  },
  {
    name: "Base cbBTC (1 hop)",
    principalBtc: 1.0,
    hops: [
      { chain: "Base", apy: 51.61, protocol: "aerodrome-slipstream", asset: "WETH-cbBTC" },
    ],
    holdDaysPerHop: 60,
  },
];

for (const scenario of multiHopScenarios) {
  const result = simulateMultiHop(scenario);
  console.log(`\n${scenario.name} (${scenario.principalBtc} BTC, ${scenario.holdDaysPerHop}d/hop)`);
  console.log("-".repeat(80));
  for (const entry of result.log) {
    if (entry.action === "yield") {
      console.log(`  ${entry.action.toUpperCase()} on ${entry.chain}: +${entry.earnedBtc.toFixed(8)} BTC | balance: ${entry.balanceBtc.toFixed(8)} BTC`);
    } else {
      console.log(`  ${entry.action.toUpperCase()}: -${entry.costBtc.toFixed(8)} BTC`);
    }
  }
  console.log(`  NET: ${result.netYield >= 0 ? '+' : ''}${result.netYield.toFixed(8)} BTC | APY: ${result.netApy.toFixed(2)}% | Total cost: ${result.totalCostBtc.toFixed(8)} BTC`);
}
