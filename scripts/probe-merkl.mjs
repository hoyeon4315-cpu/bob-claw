// Quick probe: real Merkl API variations
async function probeMerkl() {
  const urls = [
    "https://api.merkl.xyz/v4/opportunities/",
    "https://api.merkl.xyz/v4/opportunities/?chainId=8453",
    "https://api.merkl.xyz/v4/opportunities/?chainId=8453&items=5",
    "https://api.merkl.xyz/v3/opportunities/?chainId=8453",
    "https://api.merkl.xyz/v4/campaigns/?chainId=8453",
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json();
      console.log(`\n[${r.status}] ${url}`);
      if (Array.isArray(j)) {
        console.log("  array length:", j.length);
        if (j[0]) console.log("  first keys:", Object.keys(j[0]).slice(0, 10));
      } else if (j.data && Array.isArray(j.data)) {
        console.log("  data array length:", j.data.length);
        if (j.data[0]) console.log("  first keys:", Object.keys(j.data[0]).slice(0, 10));
      } else {
        console.log("  keys:", Object.keys(j));
        console.log("  sample:", JSON.stringify(j).slice(0, 300));
      }
    } catch (e) {
      console.log(`\n[ERR] ${url}: ${e.message}`);
    }
  }
}

probeMerkl();
