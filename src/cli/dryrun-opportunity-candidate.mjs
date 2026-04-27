import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const { values } = parseArgs({
  options: {
    pool: { type: "string" },
    principal: { type: "string" },
    chain: { type: "string" },
    "entry-gas-usd": { type: "string" },
    "exit-gas-usd": { type: "string" },
    "bridge-cost-bps": { type: "string" },
    write: { type: "boolean" },
  },
  allowPositionals: true,
});

const pool = values.pool;
const principalUsd = parseFloat(values.principal || "1000");
const chain = values.chain || "base";
const entryGasUsd = parseFloat(values["entry-gas-usd"] || "0.10");
const exitGasUsd = parseFloat(values["exit-gas-usd"] || "0.10");
const bridgeCostBps = parseFloat(values["bridge-cost-bps"] || "0");
const shouldWrite = values.write || false;

const CHAIN_GAS_ESTIMATES = {
  base: { entry: 0.06, exit: 0.06 },
  ethereum: { entry: 5.0, exit: 3.0 },
  optimism: { entry: 0.15, exit: 0.15 },
  arbitrum: { entry: 0.30, exit: 0.30 },
  avalanche: { entry: 0.10, exit: 0.10 },
  bsc: { entry: 0.05, exit: 0.05 },
  polygon: { entry: 0.05, exit: 0.05 },
};

async function fetchChart(pool) {
  const url = `https://yields.llama.fi/chart/${encodeURIComponent(pool)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`DefiLlama chart ${res.status}`);
  const json = await res.json();
  const data = Array.isArray(json.data) ? json.data : json;
  if (!Array.isArray(data)) throw new Error("Unexpected chart format");
  return data;
}

function simulateDryrun(dataPoints, principal, days) {
  // Take last N days
  const window = dataPoints.slice(-days);
  if (window.length < days) {
    return { ok: false, error: `only ${window.length} data points available, need ${days}` };
  }

  const apys = window.map((d) => d.apy ?? 0).filter((a) => a > 0);
  const avgApy = apys.reduce((a, b) => a + b, 0) / apys.length;
  const minApy = Math.min(...apys);
  const maxApy = Math.max(...apys);

  // Simple daily compounding: P * (1 + r/n)^n - P
  // For short periods, simple interest is close enough
  const dailyRate = avgApy / 100 / 365;
  const grossProfit = principal * dailyRate * days;

  return {
    ok: true,
    days,
    principal,
    avgApy,
    minApy,
    maxApy,
    grossProfitUsd: grossProfit,
    dailyRates: window.map((d) => ({
      date: d.timestamp,
      apy: d.apy,
      tvlUsd: d.tvlUsd,
    })),
  };
}

async function main() {
  if (!pool) {
    console.error("Usage: node src/cli/dryrun-opportunity-candidate.mjs --pool=<pool-id> [--principal=1000] [--chain=base] [--write]");
    process.exit(1);
  }

  console.error(`Shadow dryrun: pool=${pool}, principal=$${principalUsd}, chain=${chain}, days=14`);

  const chart = await fetchChart(pool);
  const gas = CHAIN_GAS_ESTIMATES[chain.toLowerCase()] || { entry: entryGasUsd, exit: exitGasUsd };
  const sim = simulateDryrun(chart, principalUsd, 14);

  if (!sim.ok) {
    console.error(sim.error);
    process.exit(1);
  }

  const bridgeCostUsd = principalUsd * (bridgeCostBps / 10000);
  const totalCostUsd = gas.entry + gas.exit + bridgeCostUsd;
  const netProfitUsd = sim.grossProfitUsd - totalCostUsd;
  const netApy = (netProfitUsd / principalUsd) * (365 / 14) * 100;
  const roi14d = (netProfitUsd / principalUsd) * 100;

  const result = {
    dryrunAt: new Date().toISOString(),
    pool,
    chain,
    principalUsd,
    periodDays: 14,
    apy: {
      avg: Number(sim.avgApy.toFixed(4)),
      min: Number(sim.minApy.toFixed(4)),
      max: Number(sim.maxApy.toFixed(4)),
    },
    grossProfitUsd: Number(sim.grossProfitUsd.toFixed(6)),
    costs: {
      entryGasUsd: gas.entry,
      exitGasUsd: gas.exit,
      bridgeCostUsd: Number(bridgeCostUsd.toFixed(6)),
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
    },
    netProfitUsd: Number(netProfitUsd.toFixed(6)),
    roi14dPct: Number(roi14d.toFixed(4)),
    netApyPct: Number(netApy.toFixed(4)),
    recommendation: netProfitUsd > 0 ? "positive_ev" : "negative_ev",
  };

  if (shouldWrite) {
    const outPath = `data/dryruns/dryrun-${Date.now()}.json`;
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(result, null, 2));
    console.error(`Wrote ${outPath}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
