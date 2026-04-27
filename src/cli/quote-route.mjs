import { parseArgs } from "node:util";
import { fetchRouteQuotes, pickCheapestRoute } from "../strategy/route-cost-discovery.mjs";

const { values } = parseArgs({
  options: {
    "src-chain": { type: "string" },
    "dst-chain": { type: "string" },
    "src-token": { type: "string" },
    "dst-token": { type: "string" },
    amount: { type: "string" },
    ticker: { type: "string" },
    providers: { type: "string" },
    "from-address": { type: "string" },
  },
  allowPositionals: true,
});

// Defaults: Base USDC → Ethereum USDC, 10 USDC
const srcChain = values["src-chain"] || "base";
const dstChain = values["dst-chain"] || "ethereum";
const srcChainId = srcChain === "base" ? 8453 : srcChain === "ethereum" ? 1 : srcChain;
const dstChainId = dstChain === "ethereum" ? 1 : dstChain === "base" ? 8453 : dstChain;
const amount = values.amount || "10000000"; // 10 USDC (6 decimals)
const ticker = values.ticker || "usdc";
const srcToken = values["src-token"] || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const dstToken = values["dst-token"] || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const fromAddress = values["from-address"] || "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const providers = (values.providers || "across,lifi").split(",").map((s) => s.trim());

async function main() {
  console.error(`Quoting route: ${srcChain} → ${dstChain}, ${ticker}, amount=${amount}`);
  console.error(`Providers: ${providers.join(", ")}`);

  const result = await fetchRouteQuotes(
    {
      srcChain,
      dstChain,
      srcAsset: srcToken,
      dstAsset: dstToken,
      amount,
      srcChainId,
      dstChainId,
      tokenTicker: ticker,
      fromAddress,
    },
    { providers, fetchFn: globalThis.fetch, timeoutMs: 15000 },
  );

  const picked = pickCheapestRoute({ quotes: result.quotes, constraints: { assetCategory: "stablecoin" } });

  const out = {
    requestedAt: new Date().toISOString(),
    route: { srcChain, dstChain, srcChainId, dstChainId, ticker, amount },
    fromCache: result.fromCache,
    quotes: result.quotes,
    errors: result.errors,
    cheapest: picked.cheapest,
    eligibleCount: picked.eligibleCount,
    maxAllowedCostBps: picked.maxAllowedCostBps,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
