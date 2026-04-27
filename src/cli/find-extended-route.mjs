import { parseArgs } from "node:util";
import { computeExtendedNetBtcApy, rankAllChains } from "../strategy/extended-chain-router.mjs";
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

const GATEWAY_11 = new Set([
  "ethereum", "base", "bsc", "avalanche", "optimism",
  "berachain", "unichain", "soneium", "sei", "sonic", "bob l2"
]);

async function main() {
  console.error(`Scanning ALL 114 chains for optimal BTC route (${principalBtc} BTC, ${holdDays} days)...\n`);

  const res = await fetch("https://yields.llama.fi/pools", { headers: { Accept: "application/json" } });
  const json = await res.json();
  const data = Array.isArray(json.data) ? json.data : json;

  function isBtcOrStable(pool) {
    const sym = (pool.symbol || "").toLowerCase();
    return sym.includes("btc") || sym.includes("wbtc") || sym.includes("cbbtc") || pool.stablecoin === true;
  }

  // Filter: reasonable opportunities
  const opportunities = data
    .filter((p) => {
      if (!isBtcOrStable(p)) return false;
      if (p.apy <= 0.5) return false;
      if (p.tvlUsd < 500_000) return false;
      if (p.apy > 1000) return false; // outlier
      if (p.apy > 100 && p.tvlUsd < 2_000_000) return false;
      return true;
    })
    .map((p) => ({
      chain: p.chain,
      protocol: p.project,
      symbol: p.symbol,
      pool: p.pool,
      apy: p.apy,
      tvlUsd: p.tvlUsd,
      isStable: p.stablecoin === true,
    }));

  const ranked = rankAllChains(opportunities, principalBtc, holdDays);
  const viable = ranked.filter((o) => o.netBtc.viable);
  const gatewayViable = viable.filter((o) => GATEWAY_11.has(o.chain?.toLowerCase().trim()));
  const nonGatewayViable = viable.filter((o) => !GATEWAY_11.has(o.chain?.toLowerCase().trim()));

  console.log(`=== TOP 20 OPPORTUNITIES (ALL 114 CHAINS) ===\n`);
  console.log(`Total viable: ${viable.length} | Gateway: ${gatewayViable.length} | Non-Gateway: ${nonGatewayViable.length}\n`);

  for (const o of viable.slice(0, 20)) {
    const chain = o.chain?.toLowerCase().trim() || "";
    const isGw = GATEWAY_11.has(chain);
    const tag = isGw ? "[GATEWAY]" : "[MANUAL]";
    const routeType = o.netBtc.routeType === "post_gateway_manual_bridge" ? "+manual bridge" : "";
    const bridgeCost = o.netBtc.totalBridgeCostBtc ? ` | bridge: ${o.netBtc.totalBridgeCostBtc.toFixed(6)} BTC` : "";
    
    console.log(
      `${tag.padEnd(10)} ${o.chain.padEnd(12)} | ${o.protocol.padEnd(18)} | ${o.symbol.padEnd(15)} | ` +
      `APY: ${o.apy.toFixed(2).padEnd(8)}% | Net: ${o.netBtc.netApy.toFixed(2).padEnd(8)}% | ` +
      `BE: ${o.netBtc.breakevenDays.toString().padStart(3)}d | TVL: $${(o.tvlUsd/1e6).toFixed(2)}M${bridgeCost}`
    );
    if (o.netBtc.manualBridgeNotes) {
      console.log(`           └─ Bridge: ${o.netBtc.manualBridgeNotes}`);
    }
  }

  // Show top non-Gateway specifically
  if (nonGatewayViable.length > 0) {
    console.log("\n=== TOP 10 NON-GATEWAY CHAINS (Manual Bridge Required) ===\n");
    for (const o of nonGatewayViable.slice(0, 10)) {
      console.log(
        `${o.chain.padEnd(12)} | ${o.protocol.padEnd(18)} | ${o.symbol.padEnd(15)} | ` +
        `APY: ${o.apy.toFixed(2)}% | Net: ${o.netBtc.netApy.toFixed(2)}% | ` +
        `Bridge: ${o.netBtc.totalBridgeCostBtc?.toFixed(6) || 0} BTC | ${o.netBtc.manualBridgeNotes || ""}`
      );
    }
  }

  // Decision
  const best = viable[0];
  console.log("\n=== OPTIMAL ROUTE ===\n");
  if (best) {
    const isGw = GATEWAY_11.has(best.chain?.toLowerCase().trim());
    console.log(`Action: ENTER`);
    console.log(`Target: ${best.chain} | ${best.protocol} | ${best.symbol}`);
    console.log(`Route: ${isGw ? "Gateway Direct" : "Bitcoin L1 → Gateway → Base → Manual Bridge → " + best.chain + " → Manual Bridge → Base → Gateway → Bitcoin L1"}`);
    console.log(`Expected net APY: ${best.netBtc.netApy.toFixed(2)}%`);
    console.log(`Expected net yield: ${best.netBtc.netYieldBtc.toFixed(8)} BTC ($${(best.netBtc.netYieldBtc * 95000).toFixed(2)})`);
    console.log(`Total cost: ${best.netBtc.totalCostBtc.toFixed(8)} BTC`);
    console.log(`Break-even: ${best.netBtc.breakevenDays} days`);
    if (best.netBtc.manualBridgeNotes) {
      console.log(`⚠️  Bridge notes: ${best.netBtc.manualBridgeNotes}`);
    }
  }

  const result = {
    computedAt: new Date().toISOString(),
    principalBtc,
    holdDays,
    summary: {
      totalOpportunities: opportunities.length,
      viableCount: viable.length,
      gatewayViable: gatewayViable.length,
      nonGatewayViable: nonGatewayViable.length,
    },
    top20: viable.slice(0, 20).map((o) => ({
      chain: o.chain,
      protocol: o.protocol,
      symbol: o.symbol,
      apy: o.apy,
      netApy: o.netBtc.netApy,
      netYieldBtc: o.netBtc.netYieldBtc,
      totalCostBtc: o.netBtc.totalCostBtc,
      breakevenDays: o.netBtc.breakevenDays,
      tvlUsd: o.tvlUsd,
      routeType: o.netBtc.routeType,
      isGateway: GATEWAY_11.has(o.chain?.toLowerCase().trim()),
      manualBridgeNotes: o.netBtc.manualBridgeNotes,
    })),
  };

  if (shouldWrite) {
    const outPath = `data/opportunities/extended-route-${Date.now()}.json`;
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
