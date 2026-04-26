import {
  ZERO_TOKEN,
  isBtcLikeAsset,
  isEthLikeAsset,
  isZeroToken,
  normalizeToken,
  tokenAsset,
} from "../assets/tokens.mjs";

export const ASSET_CLASSES = Object.freeze({
  BTC_LIKE: "btc_like",
  ETH_LIKE: "eth_like",
  STABLE: "stable",
  TOKENIZED_GOLD: "tokenized_gold",
  TOKENIZED_RESERVE: "tokenized_reserve",
  OTHER_BLUECHIP: "other_bluechip",
  GOVERNANCE: "governance",
  UNKNOWN: "unknown",
});

const GOVERNANCE_SYMBOLS = new Set(["AAVE", "AERO", "ARB", "BGT", "EIGEN", "ENA", "ETHFI", "OP", "PENDLE", "UNI"]);
const RESERVE_SYMBOLS = new Set(["BUIDL", "OUSG", "USDY", "USTB"]);
const BLUECHIP_SYMBOLS = new Set(["LINK"]);

function assetKnown(asset = {}) {
  if (asset.isNative || isZeroToken(asset.token)) return true;
  if (asset.family && asset.family !== "other") return true;
  if (asset.ticker && asset.ticker !== "Token") return true;
  return false;
}

function upperTicker(asset = {}) {
  return String(asset.ticker || "").toUpperCase();
}

function compactMetadata(metadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null),
  );
}

function classifyKnownAsset(asset = {}) {
  const ticker = upperTicker(asset);
  if (isBtcLikeAsset(asset)) return ASSET_CLASSES.BTC_LIKE;
  if (isEthLikeAsset(asset)) return ASSET_CLASSES.ETH_LIKE;
  if (asset.family === "stablecoin" || asset.priceKey === "usd_stable") return ASSET_CLASSES.STABLE;
  if (asset.priceKey === "paxg" || asset.priceKey === "xaut" || /^XAU|PAXG|XAUT$/u.test(ticker)) {
    return ASSET_CLASSES.TOKENIZED_GOLD;
  }
  if (RESERVE_SYMBOLS.has(ticker)) return ASSET_CLASSES.TOKENIZED_RESERVE;
  if (GOVERNANCE_SYMBOLS.has(ticker)) return ASSET_CLASSES.GOVERNANCE;
  if (BLUECHIP_SYMBOLS.has(ticker)) return ASSET_CLASSES.OTHER_BLUECHIP;
  if (asset.isNative && asset.family === "native_or_wrapped") return ASSET_CLASSES.OTHER_BLUECHIP;
  return ASSET_CLASSES.UNKNOWN;
}

export function classifyInboundAsset({
  chain,
  token = ZERO_TOKEN,
  metadata = {},
} = {}) {
  const normalizedToken = normalizeToken(token || ZERO_TOKEN);
  const baseAsset = tokenAsset(chain, normalizedToken);
  const knownBeforeMetadata = assetKnown(baseAsset);
  const asset = knownBeforeMetadata ? tokenAsset(chain, normalizedToken, metadata) : baseAsset;
  const known = assetKnown(asset);
  const assetClass = known ? classifyKnownAsset({ ...asset, token: normalizedToken }) : ASSET_CLASSES.UNKNOWN;
  const manualReviewRequired = assetClass === ASSET_CLASSES.UNKNOWN || assetClass === ASSET_CLASSES.GOVERNANCE;
  return {
    schemaVersion: 1,
    chain,
    token: normalizedToken,
    ticker: asset.ticker,
    family: asset.family,
    decimals: asset.decimals,
    priceKey: asset.priceKey,
    isNative: Boolean(asset.isNative),
    isKnown: known && assetClass !== ASSET_CLASSES.UNKNOWN,
    assetClass,
    routeAllowed: !manualReviewRequired,
    manualReviewRequired,
    reviewReason: manualReviewRequired
      ? assetClass === ASSET_CLASSES.GOVERNANCE
        ? "governance_token_auto_routing_disabled"
        : "unknown_token_not_whitelisted"
      : null,
  };
}

export function classifyInboundEvent(event = {}) {
  return classifyInboundAsset({
    chain: event.chain,
    token: event.token || ZERO_TOKEN,
    metadata: compactMetadata({
      ticker: event.ticker || event.asset,
      decimals: event.decimals,
      priceKey: event.priceKey,
      family: event.family,
    }),
  });
}
