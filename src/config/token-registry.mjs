// Token registry: per-chain ERC20 metadata.
// Source of truth replacing realtime-portfolio.mjs hardcoded KNOWN_TOKENS.

export const WBTC_OFT_ADDRESS = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
export const ETHEREUM_WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
export const UNI_BTC_ADDRESS = "0x236f8c0a61dA474dB21B693fB2ea7AAB0c803894";
export const SOLVBTC_ADDRESS = "0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f";
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
    { symbol: "alphaForexV2", address: "0x153bd1ABE60104bD46AA05a27fA12D1346D64A57", decimals: 18 },
    { symbol: "steakUSDT", address: "0xBEEF003C68896c7D2c3C60D363e8d71a49Ab2Bf9", decimals: 18 },
    { symbol: "aHorRwaRLUSD", address: "0xE3190143Eb552456F88464662f0c0C4aC67A77eB", decimals: 18 },
    { symbol: "eRLUSD-7", address: "0xaF5372792a29dC6b296d6FFD4AA3386aff8f9BB2", decimals: 18 },
    { symbol: "bbqUSDT", address: "0xbeeff07d991C04CD640DE9F15C08ba59c4FEDEb7", decimals: 18 },
    { symbol: "gtusdtf", address: "0x79FD640000F8563A866322483524a4b48f1Ed702", decimals: 18 },
  ],
  base: [
    { symbol: "USDC",  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "wBTC",  address: "0x1ceA84203673764244E05693e42E6Ace62bD9ad4", decimals: 8 },
    { symbol: "AERO",  address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    { symbol: "WETH",  address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    { symbol: "mwUSDC", address: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca", decimals: 18 },
    { symbol: "steakUSDC", address: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183", decimals: 18 },
    { symbol: "apxUSD", address: "0x6aE9CF67d57E49c55F900933f5dcFC4B63461d6E", decimals: 18 },
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
    { symbol: "aAvaUSDC", address: "0x625E7708f30cA75bfd92586e17077590C60eb4cD", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WAVAX",    address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18 },
  ],
  sonic: [
    { symbol: "USDC",     address: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", decimals: 6 },
    { symbol: "aSonUSDC", address: "0x578eE1cA3a8E1B54554Da1Bf7C583506C4Cd11c6", decimals: 6 },
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
    { symbol: "eUSDC-1",  address: "0x6eAe95ee783e4D862867C4e0E4c3f4B95AA682Ba", decimals: 6 },
  ],
  bera: [
    { symbol: "USDC",     address: "0x549943e04f40284185054145c6E4e9568C1D3241", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WBERA",    address: "0x6969696969696969696969696969696969696969", decimals: 18 },
    { symbol: "dUSDC.e",  address: "0x444868B6e8079ac2c55eea115250f92C2b2c4D14", decimals: 6 },
  ],
  berachain: [
    { symbol: "USDC",     address: "0x549943e04f40284185054145c6E4e9568C1D3241", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WBERA",    address: "0x6969696969696969696969696969696969696969", decimals: 18 },
    { symbol: "dUSDC.e",  address: "0x444868B6e8079ac2c55eea115250f92C2b2c4D14", decimals: 6 },
  ],
  optimism: [
    { symbol: "USDC",     address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    { symbol: "aOptUSDCn", address: "0x38d693cE1dF5AaDF7bC62595A37D667aD57922e5", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WETH",     address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    { symbol: "gtusdcp",  address: "0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59", decimals: 18 },
  ],
  soneium: [
    { symbol: "USDC",     address: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369", decimals: 6 },
    { symbol: "wBTC.OFT", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
    { symbol: "WETH",     address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    { symbol: "aSoneUSDCe", address: "0xb2C9E934A55B58D20496A5019F8722a96d8A44d8", decimals: 6 },
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
