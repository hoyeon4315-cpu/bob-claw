// Pendle Market Snapshot Normalizer.
//
// Pure function. Takes Pendle /v2/markets/all response and normalizes
// into the partial `market` shape evaluatePendlePtLbtcAdapter() consumes.

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function decimalToBps(decimal) {
  if (typeof decimal !== "number" || !Number.isFinite(decimal)) return null;
  return Math.round(decimal * 10_000);
}

function pickMarketByAddress(markets, address) {
  if (!Array.isArray(markets)) return null;
  const a = String(address).toLowerCase();
  return markets.find((m) => m && String(m.address).toLowerCase() === a) || null;
}

function pickMarketByUnderlying(markets, underlyingSymbol) {
  if (!Array.isArray(markets)) return null;
  return markets.find((m) =>
    m && String(m.underlyingAssetSymbol || "").toLowerCase() === underlyingSymbol.toLowerCase(),
  ) || null;
}

export function normalizePendleSnapshot({ response, marketAddress, underlyingSymbol, chainId }) {
  const markets = response?.results || [];
  const m = marketAddress
    ? pickMarketByAddress(markets, marketAddress)
    : underlyingSymbol
      ? pickMarketByUnderlying(markets, underlyingSymbol)
      : null;

  const details = m?.details || {};
  const impliedApy = num(details.impliedApy) ?? num(details.aggregatedApy) ?? num(m?.impliedApy);
  const underlyingApy = num(details.underlyingApy) ?? num(m?.underlyingApy);
  const tvlUsd = num(details.totalTvl) ?? num(m?.tvl?.usd);
  const expiry = m?.expiry || null;

  const market = {
    ptImpliedApyBps: decimalToBps(impliedApy),
    ptUnderlyingApyBps: decimalToBps(underlyingApy),
    ptTvlUsd: tvlUsd,
    ptExpiry: expiry,
    ptMaturityDays: expiry
      ? Math.max(0, Math.ceil((new Date(expiry) - Date.now()) / 86_400_000))
      : null,
  };

  const missing = [];
  if (!m) missing.push("market_metadata");
  if (impliedApy == null) missing.push("implied_apy");
  if (underlyingApy == null) missing.push("underlying_apy");
  if (tvlUsd == null) missing.push("tvl");
  if (!expiry) missing.push("expiry");

  return Object.freeze({
    schemaVersion: 1,
    marketAddress: m?.address || marketAddress || null,
    chainId: chainId || null,
    market: Object.freeze(market),
    partial: true,
    missing: Object.freeze(missing),
  });
}
