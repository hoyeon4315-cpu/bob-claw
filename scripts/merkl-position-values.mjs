// Direct Merkl API query for position values
const ADDRESS = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";

async function fetchMerklPositions() {
  // Try multiple Merkl API endpoints
  const urls = [
    `https://api.merkl.xyz/v4/opportunities/?chainId=8453&items=50`,
    `https://api.merkl.xyz/v4/campaigns/?chainId=1&items=50`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await res.json();
      console.log(`\n=== ${url} ===`);
      if (Array.isArray(data)) {
        console.log(`Found ${data.length} items`);
        // Look for positions related to our address
        // Merkl API doesn't have a direct /positions/{address} endpoint
        // in v4, so we need to check differently
      }
    } catch (e) {
      console.error(`Error: ${e.message}`);
    }
  }
}

// Alternative: check data files
import { readFile } from "node:fs/promises";

async function checkDataFiles() {
  const files = [
    "data/treasury/pending-whitelist.jsonl",
    "data/treasury/inbound-events.jsonl",
    "data/opportunities/scan-",
  ];

  console.log("\n=== Checking data files ===");
  for (const pattern of files) {
    try {
      if (pattern.endsWith(".jsonl")) {
        const content = await readFile(pattern, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        console.log(`${pattern}: ${lines.length} entries`);
        if (lines.length > 0) {
          const last = JSON.parse(lines[lines.length - 1]);
          console.log(`  Last entry: ${JSON.stringify(last).slice(0, 200)}`);
        }
      }
    } catch (e) {
      console.log(`${pattern}: not found or error`);
    }
  }
}

// Check for any portfolio state files
async function checkPortfolioState() {
  try {
    const state = await readFile("data/merkl-portfolio-state.json", "utf8");
    const parsed = JSON.parse(state);
    console.log("\n=== Merkl Portfolio State ===");
    console.log(JSON.stringify(parsed, null, 2).slice(0, 1000));
  } catch (e) {
    console.log("\nNo merkl-portfolio-state.json found");
  }
}

await fetchMerklPositions();
await checkDataFiles();
await checkPortfolioState();

// Manual calculation based on known positions
console.log("\n=== MANUAL POSITION VALUE CALCULATION ===");
console.log("Address: " + ADDRESS);
console.log("\nKnown positions (from Operator Memory):");
console.log("1. Base YO Protocol USDC: $75 (est. current: $75-80)");
console.log("2. Ethereum Aave Horizon RLUSD: $25 (est. current: $25-27)");
console.log("3. Ethereum Morpho Clearstar USDC: $75 (est. current: $75-78)");
console.log("4. Ethereum Morpho Steakhouse USDC: $50 (est. current: $50-52)");
console.log("\nToken balances (from inventory): ~$119");
console.log("Position total (4/22 snapshot): $225");
console.log("Estimated current (with 5d yield): $225-235");
console.log("Token + Positions: $344-354");
console.log("\nZerion shows: $396");
console.log("Gap: $42-52");
console.log("\nPossible sources of gap:");
console.log("- Reward tokens not counted (e.g., AERO, MORPHO, BGT)");
console.log("- Position value > snapshot (yield accrued)");
console.log("- Unclaimed rewards pending");
console.log("- Additional small positions not in snapshot");
