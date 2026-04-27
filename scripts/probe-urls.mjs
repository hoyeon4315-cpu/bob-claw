// Direct URL probe for Across and LiFi
const acrossUrl = new URL("https://app.across.to/api/suggested-fees");
acrossUrl.searchParams.set("token", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
acrossUrl.searchParams.set("inputAmount", "10000000");
acrossUrl.searchParams.set("originChainId", "8453");
acrossUrl.searchParams.set("destinationChainId", "1");

console.log("Across URL:", acrossUrl.toString());

const acrossRes = await fetch(acrossUrl.toString(), { headers: { Accept: "application/json" } });
console.log("Across status:", acrossRes.status);
const acrossBody = await acrossRes.text();
console.log("Across body:", acrossBody.slice(0, 500));

// LiFi uses new endpoint?
const lifiUrl1 = new URL("https://li.quest/v1/quote");
lifiUrl1.searchParams.set("fromChain", "8453");
lifiUrl1.searchParams.set("toChain", "1");
lifiUrl1.searchParams.set("fromToken", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
lifiUrl1.searchParams.set("toToken", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
lifiUrl1.searchParams.set("fromAmount", "10000000");

console.log("\nLiFi URL:", lifiUrl1.toString());

const lifiRes = await fetch(lifiUrl1.toString(), { headers: { Accept: "application/json" } });
console.log("LiFi status:", lifiRes.status);
const lifiBody = await lifiRes.text();
console.log("LiFi body:", lifiBody.slice(0, 500));
