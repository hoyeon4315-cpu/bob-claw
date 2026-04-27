// Scan wBTC/BTC yield opportunities across all 11 BOB Gateway destinations
// Returns: chain → [opportunities with wBTC/BTC/cbBTC yield]

const GATEWAY_DESTINATIONS = [
  { chain: "Ethereum", chainId: 1, native: "ETH" },
  { chain: "BOB L2", chainId: 60808, native: "ETH" },
  { chain: "Base", chainId: 8453, native: "ETH" },
  { chain: "BNB", chainId: 56, native: "BNB" },
  { chain: "Avalanche", chainId: 43114, native: "AVAX" },
  { chain: "Unichain", chainId: 130, native: "ETH" },
  { chain: "Berachain", chainId: 80094, native: "BERA" },
  { chain: "Optimism", chainId: 10, native: "ETH" },
  { chain: "Soneium", chainId: 1868, native: "ETH" },
  { chain: "Sei", chainId: 1329, native: "SEI" },
  { chain: "Sonic", chainId: 146, native: "S" },
];

const BTC_SYMBOLS = new Set(["wbtc", "wbtc.oft", "cbbtc", "tbtc", "sbtc", "btc", "bitcoin"]);

async function fetchDefiLlama() {
  const res = await fetch("https://yields.llama.fi/pools", { headers: { Accept: "application/json" } });
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : json;
}

function normalizeChain(name) {
  const n = name.toLowerCase();
  if (n === "bob") return "bob l2";
  return n;
}

function isBtcPool(pool) {
  const sym = pool.symbol?.toLowerCase() || "";
  const underlying = (pool.underlyingTokens || []).map((t) => (t?.toLowerCase ? t.toLowerCase() : ""));
  // Check if symbol contains BTC
  if (BTC_SYMBOLS.has(sym)) return true;
  if (sym.includes("wbtc")) return true;
  if (sym.includes("cbbtc")) return true;
  if (sym.includes("tbtc")) return true;
  if (sym.includes("sbtc")) return true;
  // Check underlying tokens
  for (const u of underlying) {
    if (u.includes("btc")) return true;
  }
  return false;
}

function mapChainName(defillamaChain) {
  const n = defillamaChain.toLowerCase();
  const mapping = {
    "ethereum": "Ethereum",
    "base": "Base",
    "bsc": "BNB",
    "binance": "BNB",
    "avalanche": "Avalanche",
    "optimism": "Optimism",
    "arbitrum": "Arbitrum", // not gateway but for ref
    "sonic": "Sonic",
    "sei": "Sei",
    "berachain": "Berachain",
    "soneium": "Soneium",
    "unichain": "Unichain",
  };
  return mapping[n] || defillamaChain;
}

const pools = await fetchDefiLlama();

console.log("=== BTC-family Yield Opportunities (all chains) ===\n");

for (const dest of GATEWAY_DESTINATIONS) {
  const chainPools = pools.filter((p) => {
    const mapped = mapChainName(p.chain || "");
    return mapped.toLowerCase() === dest.chain.toLowerCase() && isBtcPool(p) && p.apy > 0.5 && p.tvlUsd > 500_000;
  }).sort((a, b) => b.apy - a.apy);

  if (chainPools.length === 0) continue;

  console.log(`\n${dest.chain} (chainId=${dest.chainId})`);
  console.log("-".repeat(80));
  for (const p of chainPools.slice(0, 10)) {
    const rewardStr = p.apyReward > 0 ? ` (+${p.apyReward.toFixed(2)}% reward)` : "";
    console.log(
      `  ${p.apy.toFixed(2)}% APY${rewardStr} | TVL $${(p.tvlUsd/1e6).toFixed(2)}M | ${p.project} | ${p.symbol} | ${p.pool}`
    );
  }
}

// Also check: any non-BTC pool with very high APY that could be BTC→token→yield→BTC triangular
console.log("\n\n=== High APY Stablecoin Pools (potential triangular route via BTC→stable→yield→BTC) ===\n");
for (const dest of GATEWAY_DESTINATIONS) {
  const chainPools = pools.filter((p) => {
    const mapped = mapChainName(p.chain || "");
    return mapped.toLowerCase() === dest.chain.toLowerCase() && p.stablecoin === true && p.apy > 3 && p.tvlUsd > 5_000_000;
  }).sort((a, b) => b.apy - a.apy);

  if (chainPools.length === 0) continue;

  console.log(`\n${dest.chain}`);
  console.log("-".repeat(80));
  for (const p of chainPools.slice(0, 5)) {
    console.log(
      `  ${p.apy.toFixed(2)}% APY | TVL $${(p.tvlUsd/1e6).toFixed(2)}M | ${p.project} | ${p.symbol}`
    );
  }
}
