import { parseArgs } from "node:util";
import { buildDiversifiedPortfolio, formatPortfolioReport } from "../strategy/portfolio-allocator.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const { values } = parseArgs({
  options: {
    capital: { type: "string" },
    count: { type: "string" },
    write: { type: "boolean" },
  },
  allowPositionals: true,
});

const totalCapitalBtc = parseFloat(values.capital || "1.0");
const targetCount = parseInt(values.count || "5", 10);
const shouldWrite = values.write || false;

async function fetchDefiLlama() {
  const res = await fetch("https://yields.llama.fi/pools", { headers: { Accept: "application/json" } });
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : json;
}

async function main() {
  console.error(`Building diversified portfolio for ${totalCapitalBtc} BTC...\n`);

  const data = await fetchDefiLlama();

  function isBtcOrStable(pool) {
    const sym = (pool.symbol || "").toLowerCase();
    return sym.includes("btc") || sym.includes("wbtc") || sym.includes("cbbtc") || pool.stablecoin === true;
  }

  const opportunities = data
    .filter((p) => {
      if (!isBtcOrStable(p)) return false;
      if (p.apy <= 0.5) return false;
      if (p.tvlUsd < 500_000) return false;
      if (p.apy > 1000) return false;
      if (p.apy > 100 && p.tvlUsd < 2_000_000) return false;
      return true;
    })
    .map((p) => ({
      chain: p.chain,
      protocol: p.project,
      symbol: p.symbol,
      pool: p.pool,
      apy: p.apy,
      apyBase: p.apyBase,
      apyReward: p.apyReward,
      tvlUsd: p.tvlUsd,
      isStable: p.stablecoin === true,
    }));

  const portfolio = buildDiversifiedPortfolio({
    opportunities,
    totalCapitalBtc,
    targetOpportunityCount: targetCount,
  });

  console.log(formatPortfolioReport(portfolio));

  if (shouldWrite) {
    const outPath = `data/opportunities/portfolio-${Date.now()}.json`;
    await mkdir("data/opportunities", { recursive: true });
    await writeFile(outPath, JSON.stringify(portfolio, null, 2));
    console.error(`\nWrote ${outPath}`);
  }

  // Also print JSON for piping
  console.log("\n" + JSON.stringify(portfolio, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
