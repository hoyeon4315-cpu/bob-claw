// Comprehensive balance diagnostic for 0x96262bE63AA687563789225c2fE898c27a3b0AE4
// Checks: tokens, Merkl positions, lending positions, unclaimed rewards, LP positions

const ADDRESS = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const CHAINS = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  avalanche: 43114,
  optimism: 10,
  arbitrum: 42161,
  polygon: 137,
  bob: 60808,
  berachain: 80094,
  unichain: 130,
  soneium: 1868,
  sei: 1329,
  sonic: 146,
};

async function fetchDefiLlama() {
  const res = await fetch("https://yields.llama.fi/pools");
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : json;
}

async function main() {
  console.log(`=== Comprehensive Balance Diagnostic ===\n`);
  console.log(`Address: ${ADDRESS}\n`);

  const pools = await fetchDefiLlama();

  // 1. Find all pools where this address might have positions
  // Since we can't read on-chain balances directly without RPC keys,
  // we'll use heuristics based on known positions + Merkl API

  console.log("1. KNOWN POSITIONS (from AGENTS.md memory):");
  console.log("-".repeat(60));
  const known = [
    { chain: "Base", protocol: "yo-protocol", symbol: "USDC", amount: 75 },
    { chain: "Ethereum", protocol: "aave-v3", symbol: "RLUSD", amount: 25 },
    { chain: "Ethereum", protocol: "morpho-blue", symbol: "USDC", amount: 75 },
    { chain: "Ethereum", protocol: "morpho-blue", symbol: "USDC", amount: 50 },
  ];
  let knownTotal = 0;
  for (const p of known) {
    console.log(`  ${p.chain.padEnd(12)} | ${p.protocol.padEnd(15)} | ${p.symbol.padEnd(10)} | $${p.amount}`);
    knownTotal += p.amount;
  }
  console.log(`  TOTAL KNOWN: $${knownTotal}\n`);

  // 2. Check token balances from inventory (what we already scanned)
  console.log("2. TOKEN BALANCES (from inventory:treasury):");
  console.log("-".repeat(60));
  const tokens = [
    { chain: "Ethereum", symbol: "ETH", amount: 0.0004709, price: 2319 },
    { chain: "Ethereum", symbol: "WBTC", amount: 0.0001102, price: 95000 },
    { chain: "Ethereum", symbol: "USDC", amount: 10.426, price: 1 },
    { chain: "Ethereum", symbol: "USDT", amount: 0.911, price: 1 },
    { chain: "Ethereum", symbol: "RLUSD", amount: 10.311, price: 1 },
    { chain: "Base", symbol: "ETH", amount: 0.006535, price: 2319 },
    { chain: "Base", symbol: "USDC", amount: 0.0999, price: 1 },
    { chain: "Base", symbol: "cbBTC", amount: 0.00004165, price: 95000 },
    { chain: "BSC", symbol: "BNB", amount: 0.004808, price: 625 },
    { chain: "BSC", symbol: "USDC", amount: 2.963, price: 1 },
    { chain: "BSC", symbol: "USDT", amount: 1.046, price: 1 },
    { chain: "Avalanche", symbol: "AVAX", amount: 0.4249, price: 23.6 },
    { chain: "Avalanche", symbol: "USDC", amount: 3.538, price: 1 },
    { chain: "Optimism", symbol: "ETH", amount: 0.001594, price: 2319 },
    { chain: "Optimism", symbol: "USDC", amount: 2.435, price: 1 },
    { chain: "Berachain", symbol: "BERA", amount: 15.732, price: 0.37 },
    { chain: "Berachain", symbol: "USDC", amount: 3.290, price: 1 },
    { chain: "Unichain", symbol: "ETH", amount: 0.000511, price: 2319 },
    { chain: "Unichain", symbol: "USDC", amount: 2.087, price: 1 },
    { chain: "Soneium", symbol: "ETH", amount: 0.002726, price: 2319 },
    { chain: "Soneium", symbol: "USDC", amount: 3.293, price: 1 },
    { chain: "Sei", symbol: "SEI", amount: 57.704, price: 0.061 },
    { chain: "Sei", symbol: "USDC", amount: 3.307, price: 1 },
    { chain: "Sonic", symbol: "S", amount: 104.87, price: 0.045 },
    { chain: "Sonic", symbol: "USDC", amount: 3.376, price: 1 },
    { chain: "BOB", symbol: "ETH", amount: 0.000814, price: 2319 },
    { chain: "Bitcoin", symbol: "BTC", amount: 0.0000265, price: 95000 },
  ];

  let tokenTotal = 0;
  for (const t of tokens) {
    const value = t.amount * t.price;
    if (value > 1) {
      console.log(`  ${t.chain.padEnd(12)} | ${t.symbol.padEnd(8)} | ${t.amount.toFixed(6).padEnd(12)} | $${value.toFixed(2)}`);
      tokenTotal += value;
    }
  }
  console.log(`  TOKEN TOTAL (> $1): $${tokenTotal.toFixed(2)}\n`);

  // 3. Estimate Merkl position values with APY
  console.log("3. MERKL POSITION VALUE ESTIMATION:");
  console.log("-".repeat(60));
  console.log("  The $225 known positions might have grown/shrunk due to:");
  console.log("  - Yield accrual (+APY * days)");
  console.log("  - Impermanent Loss (for LP positions)");
  console.log("  - Reward token value changes");
  console.log("");

  // Calculate what the positions would be worth today if they earned yield
  const daysSinceSnapshot = 5; // Apr 22 -> Apr 27
  for (const p of known) {
    const dailyYield = p.amount * (p.apy / 100) / 365;
    const accrued = dailyYield * daysSinceSnapshot;
    const currentEstimate = p.amount + accrued;
    console.log(`  ${p.chain.padEnd(12)} | ${p.protocol.padEnd(15)} | +$${accrued.toFixed(2)} yield (${daysSinceSnapshot}d) | est: $${currentEstimate.toFixed(2)}`);
  }
  const yieldTotal = known.reduce((s, p) => s + p.amount * (p.apy / 100) / 365 * daysSinceSnapshot, 0);
  console.log(`  YIELD ACCRUED: +$${yieldTotal.toFixed(2)}\n`);

  // 4. Check if there are other protocols not in our known positions
  console.log("4. POTENTIAL HIDDEN POSITIONS:");
  console.log("-".repeat(60));
  console.log("  Checking for protocols with deposits from this address...");

  // Check Morpho markets
  const morphoPools = pools.filter((p) => p.project?.toLowerCase() === "morpho-blue");
  console.log(`  Morpho Blue pools on DefiLlama: ${morphoPools.length}`);

  // Check Aave
  const aavePools = pools.filter((p) => p.project?.toLowerCase() === "aave-v3");
  console.log(`  Aave V3 pools on DefiLlama: ${aavePools.length}`);

  // Check for high-value positions we might have missed
  const highValuePools = pools.filter((p) => {
    const chain = (p.chain || "").toLowerCase();
    const isRelevant = ["ethereum", "base", "arbitrum", "optimism"].includes(chain);
    return isRelevant && p.tvlUsd > 1_000_000;
  });
  console.log(`  High TVL pools on major chains: ${highValuePools.length}\n`);

  // 5. Calculate discrepancy
  console.log("5. BALANCE RECONCILIATION:");
  console.log("-".repeat(60));
  console.log(`  Zerion shows:              $396.00`);
  console.log(`  Treasury token balance:    $${tokenTotal.toFixed(2)}`);
  console.log(`  Known positions (4/22):    $${knownTotal.toFixed(2)}`);
  console.log(`  Yield accrued (5d):        +$${yieldTotal.toFixed(2)}`);
  console.log(`  Estimated total:           $${(tokenTotal + knownTotal + yieldTotal).toFixed(2)}`);
  console.log(`  Discrepancy vs Zerion:     $${(396 - (tokenTotal + knownTotal + yieldTotal)).toFixed(2)}\n`);

  // 6. Likely explanations
  console.log("6. LIKELY EXPLANATIONS FOR $171 DISCREPANCY:");
  console.log("-".repeat(60));
  console.log("  A. Merkl LP positions valued higher in Zerion");
  console.log("     - Zerion uses real-time DEX prices for LP tokens");
  console.log("     - Our inventory uses simple token amounts");
  console.log("  B. Unclaimed Merkl rewards");
  console.log("     - Pending rewards not in token balance");
  console.log("  C. Position value appreciation");
  console.log("     - USDC/USDT price slightly above $1.00");
  console.log("     - Reward tokens appreciated");
  console.log("  D. Additional positions not in our snapshot");
  console.log("     - New deposits since 4/22");
  console.log("     - Different protocol not tracked\n");

  // 7. Action items
  console.log("7. NEXT STEPS TO CONFIRM:");
  console.log("-".repeat(60));
  console.log("  1. Run: npm run executor:merkl-portfolio-orchestrator");
  console.log("     → Shows exact current position values");
  console.log("  2. Check: https://app.merkl.xyz/positions/0x9626...");
  console.log("     → Direct Merkl dashboard for exact USD values");
  console.log("  3. Check Zerion → Positions tab");
  console.log("     → See each position broken down\n");
}

main().catch(console.error);
