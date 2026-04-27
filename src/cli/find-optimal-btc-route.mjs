import { parseArgs } from "node:util";
import { computeNetBtcApy, findBestRoute } from "../strategy/btc-roundtrip-router.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const { values } = parseArgs({
  options: {
    principal: { type: "string" },
    days: { type: "string" },
    write: { type: "boolean" },
  },
  allowPositionals: true,
});

const principalBtc = parseFloat(values.principal || "1.0");
const holdDays = parseInt(values.days || "30", 10);
const shouldWrite = values.write || false;

async function fetchDefiLlama() {
  const res = await fetch("https://yields.llama.fi/pools", { headers: { Accept: "application/json" } });
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : json;
}

const GATEWAY_CHAINS = new Set(["ethereum", "base", "bsc", "avalanche", "optimism", "berachain", "unichain", "soneium", "sei", "sonic"]);
// BOB L2 is not on DefiLlama but is a gateway destination

function normalizeChain(name) {
  const n = name.toLowerCase();
  if (n === "bob") return "bob l2";
  return n;
}

function isBtcOrStable(pool) {
  const sym = pool.symbol?.toLowerCase() || "";
  const isBtc = sym.includes("wbtc") || sym.includes("cbbtc") || sym.includes("tbtc") || sym.includes("sbtc");
  const isStable = pool.stablecoin === true;
  return isBtc || isStable;
}

async function main() {
  console.error(`Finding optimal BTC route for ${principalBtc} BTC (${holdDays} days)...\n`);

  const pools = await fetchDefiLlama();

  const safeProjects = new Set([
    "aave-v3", "compound-v3", "morpho", "morpho-blue",
    "aerodrome", "aerodrome-v1", "aerodrome-slipstream",
    "uniswap-v3", "uniswap-v4", "curve", "curve-dex", "balancer-v2",
    "beefy", "pendle", "gmx-v2", "moonwell", "superform",
    "yo-protocol", "berapaw", "lista-lending", "avant-avusd",
    "fluid-lending", "spark-savings", "ondo-yield-assets",
  ]);

  const opportunities = pools
    .filter((p) => {
      const chain = normalizeChain(p.chain || "");
      if (!GATEWAY_CHAINS.has(chain)) return false;
      if (!isBtcOrStable(p)) return false;
      if (!safeProjects.has(p.project?.toLowerCase())) return false;
      if (p.apy <= 0) return false;
      // Filter out obvious outliers and manipulation
      if (p.apy > 1000) return false; // Extreme outliers = data error or manipulation
      if (p.apy > 100 && p.tvlUsd < 2_000_000) return false; // High APY needs substantial TVL
      if (p.tvlUsd < 500_000) return false;
      return true;
    })
    .map((p) => ({
      chain: p.chain,
      chainId: p.chainId,
      protocol: p.project,
      symbol: p.symbol,
      pool: p.pool,
      apy: p.apy,
      apyBase: p.apyBase,
      apyReward: p.apyReward,
      tvlUsd: p.tvlUsd,
      isStable: p.stablecoin === true,
      rewardDominant: (p.apyReward || 0) > (p.apyBase || 0),
    }));

  console.error(`Scanned ${opportunities.length} viable opportunities across ${new Set(opportunities.map((o) => o.chain)).size} chains\n`);

  // Compute net BTC APY for all
  const withNet = opportunities.map((opp) => ({
    ...opp,
    netBtc: computeNetBtcApy(opp, principalBtc, holdDays),
  }));

  const viable = withNet.filter((o) => o.netBtc.viable).sort((a, b) => b.netBtc.netApy - a.netBtc.netApy);
  const unviable = withNet.filter((o) => !o.netBtc.viable).sort((a, b) => b.netBtc.netApy - a.netBtc.netApy);

  console.log("=== TOP 10 VIABLE OPPORTUNITIES (BTC round-trip) ===\n");
  for (const o of viable.slice(0, 10)) {
    const type = o.isStable ? "[STABLE]" : "[BTC]";
    const rewardTag = o.rewardDominant ? " (reward-heavy)" : "";
    console.log(
      `${type} ${o.chain.padEnd(12)} | ${o.protocol.padEnd(20)} | ${o.symbol.padEnd(15)} | ` +
      `APY: ${o.apy.toFixed(2)}%${rewardTag} | TVL: $${(o.tvlUsd/1e6).toFixed(2)}M | ` +
      `Net: ${o.netBtc.netApy.toFixed(2)}% | Break-even: ${o.netBtc.breakevenDays}d`
    );
  }

  if (unviable.length > 0) {
    console.log("\n=== TOP 5 UNVIABLE (gas/bridge too expensive) ===\n");
    for (const o of unviable.slice(0, 5)) {
      console.log(
        `${o.chain.padEnd(12)} | ${o.protocol.padEnd(20)} | ${o.symbol.padEnd(15)} | ` +
        `APY: ${o.apy.toFixed(2)}% | Net: ${o.netBtc.netApy.toFixed(2)}% | Break-even: ${o.netBtc.breakevenDays}d`
      );
    }
  }

  // Decision
  const best = viable[0];
  const decision = findBestRoute(opportunities, null, principalBtc, holdDays);

  console.log("\n=== OPTIMAL ROUTE DECISION ===\n");
  console.log(`Action: ${decision.action.toUpperCase()}`);
  if (decision.target) {
    const t = decision.target;
    console.log(`Target: ${t.chain} | ${t.protocol} | ${t.symbol}`);
    console.log(`Expected net APY: ${t.netBtc.netApy.toFixed(2)}%`);
    console.log(`Expected net yield: ${t.netBtc.netYieldBtc.toFixed(8)} BTC (${(t.netBtc.netYieldBtc * 95000).toFixed(2)} USD)`);
    console.log(`Break-even: ${t.netBtc.breakevenDays} days`);
    console.log(`Gateway+gas cost: ${t.netBtc.totalCostBtc.toFixed(8)} BTC`);
  }

  const result = {
    computedAt: new Date().toISOString(),
    principalBtc,
    holdDays,
    btcPriceUsd: 95000,
    viableCount: viable.length,
    unviableCount: unviable.length,
    top10: viable.slice(0, 10).map((o) => ({
      chain: o.chain,
      protocol: o.protocol,
      symbol: o.symbol,
      apy: o.apy,
      netApy: o.netBtc.netApy,
      netYieldBtc: o.netBtc.netYieldBtc,
      breakevenDays: o.netBtc.breakevenDays,
      tvlUsd: o.tvlUsd,
    })),
    decision,
  };

  if (shouldWrite) {
    const outPath = `data/opportunities/optimal-route-${Date.now()}.json`;
    await mkdir("data/opportunities", { recursive: true });
    await writeFile(outPath, JSON.stringify(result, null, 2));
    console.error(`\nWrote ${outPath}`);
  }

  console.log("\n" + JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
