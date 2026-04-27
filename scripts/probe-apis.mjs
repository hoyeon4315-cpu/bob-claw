// Quick probe: real Merkl + DefiLlama API call to verify schema
const merklUrl = "https://api.merkl.xyz/v4/opportunities/?chainIds=8453&limit=5";
const defillamaUrl = "https://yields.llama.fi/pools";

async function probe() {
  console.log("=== Probing Merkl API ===");
  try {
    const mr = await fetch(merklUrl, { headers: { Accept: "application/json" } });
    console.log("Merkl status:", mr.status);
    const mj = await mr.json();
    console.log("Merkl keys:", Object.keys(mj));
    if (Array.isArray(mj)) {
      console.log("Merkl is array, length:", mj.length);
      if (mj[0]) console.log("First item keys:", Object.keys(mj[0]));
    } else if (mj.data && Array.isArray(mj.data)) {
      console.log("Merkl data array length:", mj.data.length);
      if (mj.data[0]) console.log("First data item keys:", Object.keys(mj.data[0]));
    } else {
      console.log("Merkl sample:", JSON.stringify(mj).slice(0, 500));
    }
  } catch (e) {
    console.error("Merkl error:", e.message);
  }

  console.log("\n=== Probing DefiLlama Yields API ===");
  try {
    const dr = await fetch(defillamaUrl, { headers: { Accept: "application/json" } });
    console.log("DefiLlama status:", dr.status);
    const dj = await dr.json();
    if (Array.isArray(dj.data)) {
      console.log("DefiLlama data array length:", dj.data.length);
      if (dj.data[0]) console.log("First item keys:", Object.keys(dj.data[0]));
    } else if (Array.isArray(dj)) {
      console.log("DefiLlama is array, length:", dj.length);
      if (dj[0]) console.log("First item keys:", Object.keys(dj[0]));
    } else {
      console.log("DefiLlama sample:", JSON.stringify(dj).slice(0, 500));
    }
  } catch (e) {
    console.error("DefiLlama error:", e.message);
  }
}

probe();
