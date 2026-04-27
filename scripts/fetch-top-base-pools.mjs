import { writeFile, mkdir } from "node:fs/promises";

const url = "https://yields.llama.fi/pools";
const res = await fetch(url, { headers: { Accept: "application/json" } });
const json = await res.json();
const data = Array.isArray(json.data) ? json.data : json;

const basePools = data
  .filter((p) => p.chain?.toLowerCase() === "base" && p.apy > 0 && p.tvlUsd > 100000)
  .sort((a, b) => b.apy - a.apy)
  .slice(0, 20);

console.log("Top 20 Base pools by APY:");
for (const p of basePools) {
  console.log(
    `${p.apy.toFixed(2)}% APY | TVL $${(p.tvlUsd / 1e6).toFixed(2)}M | ${p.project} | ${p.symbol} | ${p.pool}`
  );
}

await mkdir("data/opportunities", { recursive: true });
await writeFile("data/opportunities/top-base-pools.json", JSON.stringify(basePools, null, 2));
console.log("\nSaved to data/opportunities/top-base-pools.json");
