export const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
export const WBTC_OFT_TOKEN = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
export const ETHEREUM_WBTC_TOKEN = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
export const UNI_BTC_TOKEN = "0x236f8c0a61dA474dB21B693fB2ea7AAB0c803894";

const NATIVE_ASSETS = {
  bitcoin: { ticker: "BTC", family: "btc", icon: "btc", decimals: 8, priceKey: "btc" },
  avalanche: { ticker: "AVAX", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "avalanche" },
  base: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  bera: { ticker: "BERA", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "bera" },
  bob: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  bsc: { ticker: "BNB", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "bsc" },
  ethereum: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  soneium: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  sonic: { ticker: "S", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "sonic" },
  unichain: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
};

const TOKEN_DEFINITIONS = new Map(
  [
    [WBTC_OFT_TOKEN, { ticker: "wBTC.OFT", family: "wrapped_btc", icon: "wbtc", decimals: 8, priceKey: "btc" }],
    [ETHEREUM_WBTC_TOKEN, { ticker: "WBTC", family: "wrapped_btc", icon: "wbtc", decimals: 8, priceKey: "wbtc" }],
    [UNI_BTC_TOKEN, { ticker: "uniBTC", family: "wrapped_btc", icon: "btc", decimals: 8, priceKey: "btc" }],
    ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", { ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 6, priceKey: "usd_stable" }],
    ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", { ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 6, priceKey: "usd_stable" }],
    ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", { ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 18, priceKey: "usd_stable" }],
    ["0x55d398326f99059fF775485246999027B3197955", { ticker: "USDT", family: "stablecoin", icon: "usdt", decimals: 18, priceKey: "usd_stable" }],
    ["0xdAC17F958D2ee523a2206206994597C13D831ec7", { ticker: "USDT", family: "stablecoin", icon: "usdt", decimals: 6, priceKey: "usd_stable" }],
    ["0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", { ticker: "solvBTC", family: "wrapped_btc", icon: "btc", decimals: null, priceKey: "btc" }],
    ["0x2170Ed0880ac9A755fd29B2688956BD959F933F8", { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" }],
    ["0x45804880De22913dAFE09f4980848ECE6EcbAf78", { ticker: "PAXG", family: "other", icon: "paxg", decimals: 18, priceKey: "paxg" }],
    ["0x68749665FF8D2d112Fa859AA293F07A622782F38", { ticker: "XAUT", family: "other", icon: "xaut", decimals: 6, priceKey: "xaut" }],
  ].map(([token, metadata]) => [normalizeToken(token), metadata]),
);

export const BTC_FAMILY_TOKENS = new Set([ZERO_TOKEN, WBTC_OFT_TOKEN, ETHEREUM_WBTC_TOKEN, UNI_BTC_TOKEN].map(normalizeToken));

export function normalizeToken(token) {
  return String(token || "").toLowerCase();
}

export function isZeroToken(token) {
  return normalizeToken(token) === normalizeToken(ZERO_TOKEN);
}

export function tokenAsset(chain, token, overrides = {}) {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return { ticker: "?", family: "unknown", icon: "unknown", decimals: null, priceKey: null, chain, token };
  }

  if (isZeroToken(normalized)) {
    return {
      ...(NATIVE_ASSETS[chain] || { ticker: "Native", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: null }),
      chain,
      token,
      isNative: true,
      ...overrides,
    };
  }

  return {
    ...(TOKEN_DEFINITIONS.get(normalized) || { ticker: "Token", family: "other", icon: "token", decimals: null, priceKey: null }),
    chain,
    token,
    isNative: false,
    ...overrides,
  };
}

export function routeAsset(route) {
  const src = tokenAsset(route.srcChain, route.srcToken);
  const dst = tokenAsset(route.dstChain, route.dstToken);
  return {
    ticker: src.ticker === dst.ticker ? src.ticker : `${src.ticker}->${dst.ticker}`,
    family: src.family === dst.family ? src.family : `${src.family}_to_${dst.family}`,
    icon: src.icon,
    src,
    dst,
  };
}

export function assetPairKey(route) {
  const asset = routeAsset(route);
  return asset.ticker;
}

export function isBtcFamilyRoute(route) {
  return BTC_FAMILY_TOKENS.has(normalizeToken(route.srcToken)) && BTC_FAMILY_TOKENS.has(normalizeToken(route.dstToken));
}

export function unitsToDecimal(units, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  const value = BigInt(units || 0);
  return Number(value) / 10 ** decimals;
}
