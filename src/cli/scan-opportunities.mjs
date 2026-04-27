import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const { values } = parseArgs({
  options: {
    chain: { type: "string" },
    limit: { type: "string" },
    write: { type: "boolean" },
  },
  allowPositionals: true,
});

const chainId = values.chain || "8453"; // Base default
const limit = parseInt(values.limit || "50", 10);
const shouldWrite = values.write || false;

async function fetchMerkl(chainId, limit) {
  const url = `https://api.merkl.xyz/v4/opportunities/?chainId=${encodeURIComponent(chainId)}&items=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Merkl ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("Merkl response not array");
  return data.map((o) => ({
    source: "merkl",
    chainId: o.chainId,
    identifier: o.identifier || o.campaignId,
    name: o.name,
    type: o.type,
    status: o.status,
    tvl: o.tvl ?? 0,
    apr: o.apr ?? 0,
    dailyRewards: o.dailyRewards ?? 0,
    depositUrl: o.depositUrl || null,
    action: o.action || null,
    underlyingTokens: o.underlyingTokens || [],
    raw: o,
  }));
}

async function fetchDefiLlama() {
  const url = "https://yields.llama.fi/pools";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`DefiLlama ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const data = Array.isArray(json.data) ? json.data : json;
  if (!Array.isArray(data)) throw new Error("DefiLlama response not array");
  return data.map((o) => ({
    source: "defillama",
    chain: o.chain,
    project: o.project,
    symbol: o.symbol,
    pool: o.pool,
    tvlUsd: o.tvlUsd ?? 0,
    apy: o.apy ?? 0,
    apyBase: o.apyBase ?? 0,
    apyReward: o.apyReward ?? 0,
    rewardTokens: o.rewardTokens || [],
    underlyingTokens: o.underlyingTokens || [],
    stablecoin: o.stablecoin || false,
    ilRisk: o.ilRisk || null,
    raw: o,
  }));
}

async function main() {
  console.error(`Scanning opportunities for chainId=${chainId} ...`);

  const [merkl, defillama] = await Promise.all([
    fetchMerkl(chainId, limit).catch((e) => {
      console.error("Merkl fetch failed:", e.message);
      return [];
    }),
    fetchDefiLlama().catch((e) => {
      console.error("DefiLlama fetch failed:", e.message);
      return [];
    }),
  ]);

  // Filter DefiLlama to matching chain names for Base
  const chainNameMap = {
    "8453": ["Base"],
    "1": ["Ethereum"],
    "56": ["BSC", "Binance"],
    "43114": ["Avalanche"],
    "137": ["Polygon"],
    "10": ["Optimism"],
    "42161": ["Arbitrum"],
    "81457": ["Blast"],
    "534352": ["Scroll"],
    "59144": ["Linea"],
    "5000": ["Mantle"],
  };
  const names = chainNameMap[chainId] || [chainId];
  const defillamaFiltered = defillama.filter((o) =>
    names.some((n) => o.chain?.toLowerCase() === n.toLowerCase())
  );

  const result = {
    scannedAt: new Date().toISOString(),
    chainId,
    merkl: { count: merkl.length, opportunities: merkl },
    defillama: { count: defillamaFiltered.length, opportunities: defillamaFiltered },
    combinedCount: merkl.length + defillamaFiltered.length,
  };

  if (shouldWrite) {
    const outPath = `data/opportunities/scan-${Date.now()}.json`;
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
