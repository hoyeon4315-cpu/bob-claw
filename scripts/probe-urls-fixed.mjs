// Direct URL probe fixes
// Across: try 'amount' instead of 'inputAmount'
const acrossUrl = new URL("https://app.across.to/api/suggested-fees");
acrossUrl.searchParams.set("token", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
acrossUrl.searchParams.set("amount", "10000000");
acrossUrl.searchParams.set("originChainId", "8453");
acrossUrl.searchParams.set("destinationChainId", "1");

console.log("Across URL:", acrossUrl.toString());

const acrossRes = await fetch(acrossUrl.toString(), { headers: { Accept: "application/json" } });
console.log("Across status:", acrossRes.status);
const acrossBody = await acrossRes.text();
console.log("Across body:", acrossBody.slice(0, 800));

// LiFi: add fromAddress
const lifiUrl = new URL("https://li.quest/v1/quote");
lifiUrl.searchParams.set("fromChain", "8453");
lifiUrl.searchParams.set("toChain", "1");
lifiUrl.searchParams.set("fromToken", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
lifiUrl.searchParams.set("toToken", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
lifiUrl.searchParams.set("fromAmount", "10000000");
lifiUrl.searchParams.set("fromAddress", "0x96262bE63AA687563789225c2fE898c27a3b0AE4");

console.log("\nLiFi URL:", lifiUrl.toString());

const lifiRes = await fetch(lifiUrl.toString(), { headers: { Accept: "application/json" } });
console.log("LiFi status:", lifiRes.status);
const lifiBody = await lifiRes.text();
console.log("LiFi body:", lifiBody.slice(0, 800));
