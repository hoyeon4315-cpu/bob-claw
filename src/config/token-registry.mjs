// Token registry: per-chain ERC20 metadata.
// Source of truth replacing realtime-portfolio.mjs hardcoded KNOWN_TOKENS.
//
// PR-only additions: AGENTS.md forbids automated whitelisting. The
// sync CLI may stage candidates into data/treasury/pending-whitelist.jsonl
// but only this committed file is consulted at runtime.

export const TOKEN_REGISTRY = Object.freeze({
  ethereum: [
    { symbol: "USDC",  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "USDT",  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    { symbol: "RLUSD", address: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", decimals: 18 },
    { symbol: "WBTC",  address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
    { symbol: "WETH",  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  ],
  base: [
    { symbol: "USDC",  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "wBTC",  address: "0x1ceA84203673764244E05693e42E6Ace62bD9ad4", decimals: 8 },
    { symbol: "AERO",  address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    { symbol: "WETH",  address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
  bsc: [
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "ETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
    { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
  ],
  avalanche: [
    { symbol: "USDC",     address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WAVAX",    address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18 },
  ],
  sonic: [
    { symbol: "USDC",     address: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "wS",       address: "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38", decimals: 18 },
  ],
  bob: [
    { symbol: "oUSDT",    address: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WETH",     address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
  unichain: [
    { symbol: "USDC",     address: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WETH",     address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
  bera: [
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WBERA",    address: "0x6969696969696969696969696969696969696969", decimals: 18 },
  ],
  berachain: [
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WBERA",    address: "0x6969696969696969696969696969696969696969", decimals: 18 },
  ],
  optimism: [
    { symbol: "USDC",     address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WETH",     address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
  soneium: [
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WETH",     address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
  sei: [
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
  ],
});

export function getTokensForChain(chain) {
  return TOKEN_REGISTRY[chain] || [];
}

export function listChains() {
  return Object.keys(TOKEN_REGISTRY);
}

export function findToken(chain, addressOrSymbol) {
  const tokens = TOKEN_REGISTRY[chain] || [];
  if (!addressOrSymbol) return null;
  const lower = addressOrSymbol.toLowerCase();
  return (
    tokens.find((t) => t.address.toLowerCase() === lower) ||
    tokens.find((t) => t.symbol.toLowerCase() === lower) ||
    null
  );
}
