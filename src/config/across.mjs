// Across Protocol v3 configuration.
//
// Canonical values sourced from Across docs (api.across.to, UMA
// universal SpokePool registry). Changing any of these requires a
// committed diff citing the new reference.
//
// Purpose: first non-Gateway cross-chain bridge lane. Activated by the
// treasury planner only when BOB Gateway is disabled AND the action's
// asset/chain pair is supported here.

export const ACROSS_API_BASE = "https://app.across.to/api/";

// SpokePool per-chain addresses. These are the contracts that accept
// `deposit()` (source side) and pay out on destination. Public
// deployments are canonical and stable; an upgrade triggers a new
// address and MUST be handled by a committed diff.
export const ACROSS_SPOKE_POOLS = Object.freeze({
  ethereum: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
  optimism: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
  polygon: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
  arbitrum: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
  base: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
  unichain: "0xa88FEF8d70B8b0f3f9D6F739dB52c63dA3e1CA04",
});

// Supported token registry per chain. Keys are lower-case tickers so
// the planner can match treasury action.ticker uniformly. Contracts
// are chain-canonical addresses — verify before flipping live.
export const ACROSS_SUPPORTED_TOKENS = Object.freeze({
  ethereum: Object.freeze({
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    wbtc: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  }),
  base: Object.freeze({
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    weth: "0x4200000000000000000000000000000000000006",
    cbbtc: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  }),
  optimism: Object.freeze({
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    weth: "0x4200000000000000000000000000000000000006",
    wbtc: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
  }),
  arbitrum: Object.freeze({
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    wbtc: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  }),
  polygon: Object.freeze({
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    weth: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    wbtc: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
  }),
  unichain: Object.freeze({
    usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    weth: "0x4200000000000000000000000000000000000006",
  }),
});

// Config-only caps. Per-tx USD cap mirrors the Gateway per-tx
// `perTxUsd` default so we do not silently unlock more risk when
// switching providers. Raising requires a committed diff.
export const ACROSS_DEFAULT_POLICY = Object.freeze({
  enabled: true,
  apiBase: ACROSS_API_BASE,
  perTxMaxUsd: 500,
  quoteTimeoutMs: 15_000,
  minFillDeadlineSeconds: 120,
  fillDeadlineBufferSeconds: 600,
  maxRelayerFeePct: 0.01,
});

export function acrossSpokePool(chain) {
  return ACROSS_SPOKE_POOLS[String(chain || "").toLowerCase()] || null;
}

export function acrossTokenAddress(chain, ticker) {
  const chainTokens = ACROSS_SUPPORTED_TOKENS[String(chain || "").toLowerCase()] || null;
  if (!chainTokens) return null;
  return chainTokens[String(ticker || "").toLowerCase()] || null;
}

export function acrossTickerForToken(chain, tokenAddress) {
  const chainTokens = ACROSS_SUPPORTED_TOKENS[String(chain || "").toLowerCase()] || null;
  if (!chainTokens || !tokenAddress) return null;
  const needle = String(tokenAddress).toLowerCase();
  for (const [ticker, addr] of Object.entries(chainTokens)) {
    if (String(addr).toLowerCase() === needle) return ticker;
  }
  return null;
}

export function acrossSupportsPair({ srcChain, dstChain, ticker } = {}) {
  const normalizedTicker = String(ticker || "").toLowerCase();
  const src = acrossTokenAddress(srcChain, normalizedTicker);
  const dst = acrossTokenAddress(dstChain, normalizedTicker);
  if (!src || !dst) return false;
  if (!acrossSpokePool(srcChain) || !acrossSpokePool(dstChain)) return false;
  return true;
}
