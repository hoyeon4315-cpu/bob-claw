export const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
export const WBTC_OFT_TOKEN = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
export const ETHEREUM_WBTC_TOKEN = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
export const UNI_BTC_TOKEN = "0x236f8c0a61dA474dB21B693fB2ea7AAB0c803894";
export const SOLVBTC_TOKEN = "0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f";

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
    [SOLVBTC_TOKEN, { ticker: "solvBTC", family: "wrapped_btc", icon: "btc", decimals: 18, priceKey: "btc" }],
    ["0x2170Ed0880ac9A755fd29B2688956BD959F933F8", { ticker: "ETH", family: "native_or_wrapped", icon: "eth", decimals: 18, priceKey: "ethereum" }],
    ["0x45804880De22913dAFE09f4980848ECE6EcbAf78", { ticker: "PAXG", family: "other", icon: "paxg", decimals: 18, priceKey: "paxg" }],
    ["0x68749665FF8D2d112Fa859AA293F07A622782F38", { ticker: "XAUT", family: "other", icon: "xaut", decimals: 6, priceKey: "xaut" }],
  ].map(([token, metadata]) => [normalizeToken(token), metadata]),
);

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

export function unitsToDecimal(units, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  const value = BigInt(units || 0);
  return Number(value) / 10 ** decimals;
}
