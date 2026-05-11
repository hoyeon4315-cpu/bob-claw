export const ZERO_TOKEN = "******************************************";
export const WBTC_OFT_TOKEN = "******************************************";
export const ETHEREUM_WBTC_TOKEN = "******************************************";
export const UNI_BTC_TOKEN = "******************************************";
export const SOLVBTC_TOKEN = "******************************************";

import { TOKEN_REGISTRY } from "../config/token-registry.mjs";

export const WRAPPED_NATIVE_TOKENS = Object.freeze({
  avalanche: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
  base: "0x4200000000000000000000000000000000000006",
  bera: "0x6969696969696969696969696969696969696969",
  bob: "0x4200000000000000000000000000000000000006",
  bsc: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  optimism: "0x4200000000000000000000000000000000000006",
  soneium: "0x4200000000000000000000000000000000000006",
  sonic: "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38",
  unichain: "0x4200000000000000000000000000000000000006",
});

const NATIVE_ASSETS = {
  bitcoin: { ticker: "BTC", family: "btc", icon: "btc", decimals: 8, priceKey: "btc" },
  avalanche: { ticker: "AVAX", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "avalanche" },
  base: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  bera: { ticker: "BERA", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "bera" },
  bob: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  bsc: { ticker: "BNB", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "bsc" },
  ethereum: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  optimism: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  sei: { ticker: "SEI", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "sei" },
  soneium: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  sonic: { ticker: "S", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "sonic" },
  unichain: { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
};

const KNOWN_TOKEN_DEFINITIONS = Object.freeze([
  { token: WBTC_OFT_TOKEN, ticker: "wBTC.OFT", family: "wrapped_btc", icon: "wbtc", decimals: 8, priceKey: "btc" },
  { token: ETHEREUM_WBTC_TOKEN, ticker: "WBTC", family: "wrapped_btc", icon: "wbtc", decimals: 8, priceKey: "wbtc" },
  { token: UNI_BTC_TOKEN, ticker: "uniBTC", family: "wrapped_btc", icon: "btc", decimals: 8, priceKey: "btc" },
  { token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", ticker: "cbBTC", family: "wrapped_btc", icon: "btc", decimals: 8, priceKey: "btc" },
  { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 6, priceKey: "usd_stable" },
  { token: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", ticker: "oUSDT", family: "stablecoin", icon: "usdt", decimals: 6, priceKey: "usd_stable" },
  { token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 6, priceKey: "usd_stable" },
  { token: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 6, priceKey: "usd_stable" },
  { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 6, priceKey: "usd_stable" },
  { token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 6, priceKey: "usd_stable" },
  { token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 18, priceKey: "usd_stable" },
  { token: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", ticker: "USDC", family: "stablecoin", icon: "usdc", decimals: 6, priceKey: "usd_stable" },
  { token: "0x55d398326f99059fF775485246999027B3197955", ticker: "USDT", family: "stablecoin", icon: "usdt", decimals: 18, priceKey: "usd_stable" },
  { token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", ticker: "USDT", family: "stablecoin", icon: "usdt", decimals: 6, priceKey: "usd_stable" },
  { token: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", ticker: "RLUSD", family: "stablecoin", icon: "usdc", decimals: 18, priceKey: "usd_stable" },
  { token: SOLVBTC_TOKEN, ticker: "solvBTC", family: "wrapped_btc", icon: "btc", decimals: 18, priceKey: "btc" },
  { token: WRAPPED_NATIVE_TOKENS.base, ticker: "WETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  { token: WRAPPED_NATIVE_TOKENS.avalanche, ticker: "WAVAX", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "avalanche" },
  { token: WRAPPED_NATIVE_TOKENS.bera, ticker: "WBERA", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "bera" },
  { token: WRAPPED_NATIVE_TOKENS.bsc, ticker: "WBNB", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "bsc" },
  { token: WRAPPED_NATIVE_TOKENS.ethereum, ticker: "WETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  { token: WRAPPED_NATIVE_TOKENS.optimism, ticker: "WETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  { token: WRAPPED_NATIVE_TOKENS.sonic, ticker: "wS", family: "native_or_wrapped", icon: "native", decimals: 18, priceKey: "sonic" },
  { token: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" },
  { token: "0x45804880De22913dAFE09f4980848ECE6EcbAf78", ticker: "PAXG", family: "other", icon: "paxg", decimals: 18, priceKey: "paxg" },
  { token: "0x68749665FF8D2d112Fa859AA293F07A622782F38", ticker: "XAUT", family: "other", icon: "xaut", decimals: 6, priceKey: "xaut" },
]);

function guessFamilyFromSymbol(symbol = "") {
  const s = String(symbol).toLowerCase();
  if (s.includes("btc") || s === "cbbtc" || s === "unibtc" || s === "solvbtc") return "wrapped_btc";
  if (s === "usdc" || s === "usdt" || s === "ousdt" || s === "rlusd" || s === "usds") return "stablecoin";
  if (s === "weth" || s === "eth") return "native_or_wrapped";
  if (s.includes("bnb") || s === "wbnb") return "native_or_wrapped";
  if (s.includes("avax") || s === "wavax") return "native_or_wrapped";
  if (s === "paxg" || s === "xaut") return "other";
  return "other";
}

function guessIconFromSymbol(symbol = "") {
  const s = String(symbol).toLowerCase();
  if (s.includes("btc")) return "btc";
  if (s === "usdc") return "usdc";
  if (s === "usdt") return "usdt";
  if (s === "rlusd") return "usdc";
  if (s === "weth" || s === "eth") return "eth";
  if (s.includes("bnb")) return "native";
  if (s.includes("avax")) return "native";
  if (s === "paxg") return "paxg";
  if (s === "xaut") return "xaut";
  return "token";
}

function guessPriceKeyFromSymbol(symbol = "") {
  const s = String(symbol).toLowerCase();
  if (s.includes("btc") || s === "cbbtc" || s === "unibtc" || s === "solvbtc") return "btc";
  if (s === "usdc" || s === "usdt" || s === "ousdt" || s === "rlusd" || s === "usds") return "usd_stable";
  if (s === "weth" || s === "eth") return "ethereum";
  if (s.includes("bnb")) return "bsc";
  if (s.includes("avax")) return "avalanche";
  if (s === "paxg") return "paxg";
  if (s === "xaut") return "xaut";
  return null;
}

function buildTokenDefinitions() {
  const map = new Map();
  for (const item of KNOWN_TOKEN_DEFINITIONS) {
    const key = normalizeToken(item.token);
    if (!key || isZeroToken(item.token)) continue;
    map.set(key, { ...item, token: undefined });
  }
  for (const tokens of Object.values(TOKEN_REGISTRY || {})) {
    for (const t of tokens || []) {
      if (!t.address) continue;
      const key = normalizeToken(t.address);
      if (map.has(key)) continue;
      map.set(key, {
        ticker: t.symbol,
        family: guessFamilyFromSymbol(t.symbol),
        icon: guessIconFromSymbol(t.symbol),
        decimals: t.decimals,
        priceKey: guessPriceKeyFromSymbol(t.symbol),
      });
    }
  }
  return map;
}

const TOKEN_DEFINITIONS = buildTokenDefinitions();

export const BTC_FAMILY_TOKENS = new Set(
  [
    ZERO_TOKEN,
    ...[...TOKEN_DEFINITIONS.entries()]
      .filter(([, metadata]) => metadata.family === "wrapped_btc")
      .map(([token]) => token),
  ].map(normalizeToken),
);

const WATCH_SOURCES = Object.freeze({
  gatewayApi: {
    kind: "gateway_api",
    label: "BOB Gateway API overview",
    url: "https://docs.gobob.xyz/api-reference/overview",
  },
  bobRepo: {
    kind: "bob_github",
    label: "bob-collective/bob",
    url: "https://github.com/bob-collective/bob",
  },
  xverseEarn: {
    kind: "official_blog",
    label: "BOB introduces 1-click Bitcoin DeFi to Xverse Earn",
    url: "https://www.gobob.xyz/blog/bob-introduces-1-click-bitcoin-defi-to-xverse-earn",
  },
  pellSpotlight: {
    kind: "official_blog",
    label: "BOB Ecosystem Spotlight #02 - Pell",
    url: "https://blog.gobob.xyz/posts/bob-ecosystem-spotlight-02----pell",
  },
  btcToWbtc: {
    kind: "official_blog",
    label: "BOB launches 1-Click native BTC <-> wBTC.OFT transfers",
    url: "https://www.gobob.xyz/blog/btc-to-wbtc",
  },
  btcOpportunities: {
    kind: "official_blog",
    label: "Latest Bitcoin DeFi opportunities on BOB - November 2025",
    url: "https://www.gobob.xyz/blog/latest-bitcoin-defi-opportunities-on-bob-november-2025",
  },
  hybridYield: {
    kind: "official_blog",
    label: "BOB launches hybrid BTC yield products",
    url: "https://www.gobob.xyz/es/blog/bob-launches-hybrid-btc-yield-products-ushering-in-a-new-era-of-bitcoin-defi",
  },
});

export const BTC_WATCHLIST = Object.freeze(
  [
    { ticker: "BTC", chain: "bitcoin", token: ZERO_TOKEN, status: "observed_live", source: WATCH_SOURCES.gatewayApi },
    { ticker: "wBTC.OFT", token: WBTC_OFT_TOKEN, status: "observed_live", source: WATCH_SOURCES.btcToWbtc },
    { ticker: "WBTC", chain: "ethereum", token: ETHEREUM_WBTC_TOKEN, status: "observed_live", source: WATCH_SOURCES.pellSpotlight },
    { ticker: "uniBTC", chain: "bob", token: UNI_BTC_TOKEN, status: "observed_live", source: WATCH_SOURCES.xverseEarn },
    { ticker: "solvBTC", chain: "base", token: SOLVBTC_TOKEN, status: "observed_live", source: WATCH_SOURCES.xverseEarn },
    { ticker: "xSolvBTC", chain: "bob", token: null, status: "ecosystem_watch", source: WATCH_SOURCES.btcToWbtc },
    { ticker: "tBTC", chain: "bob", token: null, status: "ecosystem_watch", source: WATCH_SOURCES.pellSpotlight },
    { ticker: "FBTC", chain: "bob", token: null, status: "ecosystem_watch", source: WATCH_SOURCES.btcOpportunities },
    { ticker: "LBTC", chain: "bob", token: null, status: "ecosystem_watch", source: WATCH_SOURCES.hybridYield },
    { ticker: "SolvBTC.BBN", chain: "bob", token: null, status: "ecosystem_watch", source: WATCH_SOURCES.pellSpotlight },
  ].map((item) => ({
    ...item,
    token: item.token ? normalizeToken(item.token) : null,
    matchTicker: String(item.ticker || "").toLowerCase(),
  })),
);

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

export function isBtcLikeAsset(asset) {
  return asset?.family === "btc" || asset?.family === "wrapped_btc";
}

export function gatewayBtcSettlementTokenForChain(chain) {
  return String(chain || "").toLowerCase() === "ethereum"
    ? ETHEREUM_WBTC_TOKEN
    : WBTC_OFT_TOKEN;
}

export function isEthLikeAsset(asset) {
  return asset?.priceKey === "ethereum" && (asset?.ticker === "ETH" || asset?.family === "native_or_wrapped");
}

export function assetPairKey(route) {
  const asset = routeAsset(route);
  return asset.ticker;
}

export function isBtcFamilyRoute(route) {
  return isBtcLikeAsset(tokenAsset(route?.srcChain, route?.srcToken)) && isBtcLikeAsset(tokenAsset(route?.dstChain, route?.dstToken));
}

export function isEthFamilyRoute(route) {
  return isEthLikeAsset(tokenAsset(route?.srcChain, route?.srcToken)) && isEthLikeAsset(tokenAsset(route?.dstChain, route?.dstToken));
}

export function classifyGatewayAssetUniverse(routes = []) {
  const observedAssets = new Map();

  for (const route of routes || []) {
    for (const [chain, token] of [
      [route?.srcChain, route?.srcToken],
      [route?.dstChain, route?.dstToken],
    ]) {
      const key = `${chain}:${normalizeToken(token)}`;
      if (observedAssets.has(key)) continue;
      const asset = tokenAsset(chain, token);
      observedAssets.set(key, {
        chain,
        token,
        ticker: asset.ticker,
        family: asset.family,
        isKnown: asset.family !== "other" || asset.ticker !== "Token" || isZeroToken(token),
      });
    }
  }

  const observed = [...observedAssets.values()].sort(
    (left, right) =>
      String(left.chain).localeCompare(String(right.chain)) ||
      String(left.ticker).localeCompare(String(right.ticker)) ||
      String(left.token).localeCompare(String(right.token)),
  );

  const observedBtcLikeAssets = observed.filter((asset) => isBtcLikeAsset(asset));
  const unknownAssets = observed.filter((asset) => !asset.isKnown && !isZeroToken(asset.token));
  const watchlistObserved = [];
  const watchlistMissing = [];

  for (const item of BTC_WATCHLIST) {
    const matched = observed.find((asset) => {
      if (item.chain && asset.chain !== item.chain) return false;
      if (item.token && normalizeToken(asset.token) !== item.token) return false;
      if (!item.token && String(asset.ticker || "").toLowerCase() !== item.matchTicker) return false;
      return true;
    });

    const record = {
      ticker: item.ticker,
      chain: item.chain || null,
      token: item.token,
      status: item.status,
      source: item.source || null,
    };

    if (matched) {
      watchlistObserved.push({
        ...record,
        observedToken: matched.token,
        observedFamily: matched.family,
      });
    } else {
      watchlistMissing.push(record);
    }
  }

  return {
    observedAssets: observed,
    observedBtcLikeAssets,
    unknownAssets,
    watchlistObserved,
    watchlistMissing,
  };
}

export function listKnownTokenDefinitions() {
  return KNOWN_TOKEN_DEFINITIONS.map((item) => ({ ...item }));
}

export function unitsToDecimal(units, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  const value = BigInt(units || 0);
  return Number(value) / 10 ** decimals;
}
