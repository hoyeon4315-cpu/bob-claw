// Scan ALL chains for BTC/stable yields, not just Gateway 11
const url = "https://yields.llama.fi/pools";
const res = await fetch(url, { headers: { Accept: "application/json" } });
const json = await res.json();
const data = Array.isArray(json.data) ? json.data : json;

const GATEWAY_11 = new Set([
  "ethereum", "bob", "bob l2", "base", "bsc", "binance",
  "avalanche", "unichain", "berachain", "optimism",
  "soneium", "sei", "sonic",
]);

function normalize(name) {
  return (name || "").toLowerCase().trim();
}

function isBtcOrStable(pool) {
  const sym = (pool.symbol || "").toLowerCase();
  const isBtc = sym.includes("btc") || sym.includes("wbtc") || sym.includes("cbbtc") || sym.includes("tbtc") || sym.includes("sbtc");
  const isStable = pool.stablecoin === true;
  return isBtc || isStable;
}

// Group by chain
const byChain = new Map();
for (const p of data) {
  const chain = normalize(p.chain);
  if (!byChain.has(chain)) byChain.set(chain, []);
  byChain.get(chain).push(p);
}

console.log("=== ALL CHAINS: BTC/Stable Yield Opportunities ===\n");
console.log(`Total chains with data: ${byChain.size}\n`);

const results = [];

for (const [chain, pools] of byChain) {
  const bestBtc = pools
    .filter((p) => isBtcOrStable(p) && p.apy > 0.5 && p.tvlUsd > 500_000)
    .sort((a, b) => b.apy - a.apy)[0];

  if (!bestBtc) continue;

  const isGateway = GATEWAY_11.has(chain);
  const tag = isGateway ? "[GATEWAY]" : "[NON-GATEWAY]";
  const totalTvl = pools.reduce((s, p) => s + (p.tvlUsd || 0), 0);

  results.push({
    chain,
    isGateway,
    bestApy: bestBtc.apy,
    bestProject: bestBtc.project,
    bestSymbol: bestBtc.symbol,
    bestTvl: bestBtc.tvlUsd,
    totalPools: pools.length,
    totalTvl,
  });
}

// Sort by best APY
results.sort((a, b) => b.bestApy - a.bestApy);

console.log("Top opportunities by chain:\n");
console.log("Chain".padEnd(15) + " | " + "Type".padEnd(12) + " | " + "Best APY".padEnd(10) + " | " + "Project".padEnd(18) + " | " + "Symbol".padEnd(15) + " | " + "TVL".padEnd(10));
console.log("-".repeat(110));

for (const r of results.slice(0, 30)) {
  const tag = r.isGateway ? "GATEWAY" : "OTHER";
  console.log(
    `${r.chain.padEnd(15)} | ${tag.padEnd(12)} | ${r.bestApy.toFixed(2).padEnd(10)}% | ${r.bestProject.padEnd(18)} | ${r.bestSymbol.padEnd(15)} | $${(r.bestTvl/1e6).toFixed(2)}M`
  );
}

// NON-GATEWAY chains specifically
console.log("\n\n=== NON-GATEWAY Chains with High Yield ===\n");
const nonGateway = results.filter((r) => !r.isGateway).sort((a, b) => b.bestApy - a.bestApy);

for (const r of nonGateway.slice(0, 15)) {
  console.log(
    `${r.chain.padEnd(15)} | ${r.bestApy.toFixed(2)}% | ${r.bestProject} | ${r.bestSymbol} | TVL $${(r.bestTvl/1e6).toFixed(2)}M`
  );
}

// Save
import { writeFile, mkdir } from "node:fs/promises";
await mkdir("data/opportunities", { recursive: true });
await writeFile("data/opportunities/all-chains-scan.json", JSON.stringify(results, null, 2));
console.log("\nSaved to data/opportunities/all-chains-scan.json");
