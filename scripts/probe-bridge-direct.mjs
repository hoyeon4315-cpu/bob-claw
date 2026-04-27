import { fetchAcrossQuote } from "../src/executor/bridges/across-wrapper.mjs";
import { fetchLiFiQuote } from "../src/executor/bridges/lifi-wrapper.mjs";

async function test() {
  console.log("=== Direct Across test ===");
  const across = await fetchAcrossQuote({
    srcChain: "base",
    dstChain: "ethereum",
    tokenTicker: "usdc",
    amount: 10000000,
    srcChainId: 8453,
    dstChainId: 1,
  });
  console.log(across);

  console.log("\n=== Direct LiFi test ===");
  const lifi = await fetchLiFiQuote({
    srcChain: 8453,
    dstChain: 1,
    srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    dstToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    amount: 10000000,
    fromAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
  });
  console.log(lifi);
}

test();
