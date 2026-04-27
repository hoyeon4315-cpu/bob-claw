// Probe: does Merkl have BOB L2 opportunities?
async function probeMerklBob() {
  const url = "https://api.merkl.xyz/v4/opportunities/?chainId=60808&items=50";
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    console.log("=== Merkl BOB L2 (chainId=60808) ===");
    if (!Array.isArray(data) || data.length === 0) {
      console.log("No opportunities found on Merkl for BOB L2");
      return;
    }
    console.log(`Found ${data.length} opportunities`);
    const btcRelated = data.filter((o) => {
      const name = (o.name || "").toLowerCase();
      const sym = (o.symbol || "").toLowerCase();
      return name.includes("btc") || name.includes("wbtc") || sym.includes("btc");
    });
    console.log(`BTC-related: ${btcRelated.length}`);
    for (const o of btcRelated.slice(0, 10)) {
      console.log(`  ${o.apr}% | ${o.name} | TVL ${o.tvl} | status ${o.status}`);
    }
  } catch (e) {
    console.error("Merkl BOB L2 error:", e.message);
  }
}

// Probe: does DefiLlama have Sei yields?
async function probeDefiLlamaSei() {
  const url = "https://yields.llama.fi/pools";
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : json;
    const seiPools = data.filter((p) => p.chain?.toLowerCase() === "sei" && p.apy > 0);
    console.log("\n=== DefiLlama Sei ===");
    console.log(`Found ${seiPools.length} pools`);
    const btcOrStable = seiPools.filter((p) => {
      const sym = p.symbol?.toLowerCase() || "";
      return sym.includes("btc") || sym.includes("wbtc") || p.stablecoin === true;
    });
    console.log(`BTC or stable: ${btcOrStable.length}`);
    for (const p of btcOrStable.slice(0, 10)) {
      console.log(`  ${p.apy.toFixed(2)}% | ${p.project} | ${p.symbol} | TVL $${(p.tvlUsd/1e6).toFixed(2)}M`);
    }
  } catch (e) {
    console.error("DefiLlama Sei error:", e.message);
  }
}

// Probe: does DefiLlama have BOB L2 yields?
async function probeDefiLlamaBob() {
  const url = "https://yields.llama.fi/pools";
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : json;
    const bobPools = data.filter((p) => {
      const c = p.chain?.toLowerCase() || "";
      return c === "bob" || c === "bob l2";
    });
    console.log("\n=== DefiLlama BOB L2 ===");
    console.log(`Found ${bobPools.length} pools`);
    for (const p of bobPools.slice(0, 10)) {
      console.log(`  ${p.apy.toFixed(2)}% | ${p.project} | ${p.symbol} | TVL $${(p.tvlUsd/1e6).toFixed(2)}M`);
    }
  } catch (e) {
    console.error("DefiLlama BOB L2 error:", e.message);
  }
}

await probeMerklBob();
await probeDefiLlamaSei();
await probeDefiLlamaBob();
