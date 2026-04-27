// Probe DefiLlama chart API
const pool = "747c1d2a-c668-4682-b9f9-296708a3dd90"; // WETH-Base Aerodrome
const url = `https://yields.llama.fi/chart/${pool}`;

console.log("Fetching:", url);
const res = await fetch(url, { headers: { Accept: "application/json" } });
console.log("Status:", res.status);
const data = await res.json();

if (Array.isArray(data.data)) {
  console.log("Data points:", data.data.length);
  console.log("First:", JSON.stringify(data.data[0]).slice(0, 300));
  console.log("Last:", JSON.stringify(data.data[data.data.length - 1]).slice(0, 300));
} else if (Array.isArray(data)) {
  console.log("Data points:", data.length);
  console.log("First:", JSON.stringify(data[0]).slice(0, 300));
  console.log("Last:", JSON.stringify(data[data.length - 1]).slice(0, 300));
} else {
  console.log("Unexpected:", JSON.stringify(data).slice(0, 500));
}
