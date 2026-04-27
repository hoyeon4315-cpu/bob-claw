import { writeFile, mkdir } from "node:fs/promises";

const url = "https://yields.llama.fi/pools";
const res = await fetch(url, { headers: { Accept: "application/json" } });
const json = await res.json();
const data = Array.isArray(json.data) ? json.data : json;

const SAFE_PROJECTS = new Set([
  "aave-v3", "compound-v3", "morpho", "morpho-blue",
  "aerodrome", "aerodrome-v1", "aerodrome-slipstream",
  "uniswap-v3", "uniswap-v4", "curve", "balancer-v2",
  "beefy", "pendle", "gmx-v2", "moonwell",
]);

const safePools = data
  .filter((p) => {
    const chain = p.chain?.toLowerCase();
    const isBase = chain === "base";
    const isSafeProject = SAFE_PROJECTS.has(p.project?.toLowerCase());
    const isStable = p.stablecoin === true;
    const highTvl = p.tvlUsd > 5_000_000;
    const positiveApy = p.apy > 1;
    return isBase && isSafeProject && isStable && highTvl && positiveApy;
  })
  .sort((a, b) => b.apy - a.apy)
  .slice(0, 15);

console.log("Safe Base stablecoin pools (TVL > $5M):");
for (const p of safePools) {
  console.log(
    `${p.apy.toFixed(2)}% APY | TVL $${(p.tvlUsd / 1e6).toFixed(2)}M | ${p.project} | ${p.symbol} | ${p.pool}`
  );
}

// Also analyze bridge cost threshold
console.log("\n=== Bridge Cost Threshold Analysis ===");
const amounts = [10, 50, 100, 500, 1000, 5000, 10000];
const acrossFixedFee = 0.334; // $0.334 from earlier quote (10 USDC)
const lifiFeeBps = 25; // 0.25%

for (const amt of amounts) {
  const acrossBps = (acrossFixedFee / amt) * 10000;
  const lifiFee = amt * (lifiFeeBps / 10000);
  const lifiBps = lifiFeeBps;
  // Break-even: need at least this APY for 14 days to cover bridge
  const minApy14d = ((acrossFixedFee + 0.12) / amt) * (365 / 14) * 100;
  const minApy14dLifi = ((lifiFee + 0.12) / amt) * (365 / 14) * 100;
  console.log(
    `$${amt.toString().padStart(5)} | Across ${acrossBps.toFixed(0)} bps | LiFi ${lifiBps} bps | Break-even APY (Across): ${minApy14d.toFixed(1)}% | (LiFi): ${minApy14dLifi.toFixed(1)}%`
  );
}

await mkdir("data/opportunities", { recursive: true });
await writeFile("data/opportunities/safe-base-pools.json", JSON.stringify(safePools, null, 2));
console.log("\nSaved to data/opportunities/safe-base-pools.json");
