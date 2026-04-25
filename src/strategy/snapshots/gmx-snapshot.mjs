// GMX Market Snapshot Normalizer.
//
// Pure function. Takes GMX /markets/info response and normalizes
// into the partial `market` shape evaluateGmxBasisAdapter() consumes.

function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bpsFromRate(rateStr) {
  if (!rateStr) return null;
  const n = Number(rateStr);
  if (!Number.isFinite(n)) return null;
  // GMX reports rates as 1e30 scaled integers in string form.
  // Normalize to basis points (1 bps = 0.0001 = 1e-4).
  // If the value looks like a raw 1e30 integer, divide accordingly.
  if (n > 1e20) return num(n / 1e30 * 10_000);
  return num(n * 10_000);
}

function pickMarketByToken(markets, indexTokenAddress) {
  if (!Array.isArray(markets)) return null;
  const a = String(indexTokenAddress).toLowerCase();
  return markets.find((m) => m && String(m.indexToken).toLowerCase() === a,
  ) || null;
}

export function normalizeGmxSnapshot({ response, indexTokenAddress, marketName }) {
  const markets = response?.markets || [];
  const m = indexTokenAddress
    ? pickMarketByToken(markets, indexTokenAddress)
    : marketName
      ? markets.find((m) => m && String(m.name).toLowerCase().includes(marketName.toLowerCase()))
      : null;

  const fundingRate = bpsFromRate(m?.fundingRateLong || m?.fundingRateShort);
  const borrowRate = bpsFromRate(m?.borrowingRateLong || m?.borrowingRateShort);
  const oiLong = num(m?.openInterestLong);
  const oiShort = num(m?.openInterestShort);
  const liquidity = num(m?.availableLiquidityLong || m?.availableLiquidityShort);

  const market = {
    fundingRateBps: fundingRate,
    borrowRateBps: borrowRate,
    openInterestLong: oiLong,
    openInterestShort: oiShort,
    availableLiquidity: liquidity,
  };

  const missing = [];
  if (!m) missing.push("market_metadata");
  if (fundingRate == null) missing.push("funding_rate");
  if (borrowRate == null) missing.push("borrow_rate");
  if (oiLong == null) missing.push("open_interest_long");
  if (oiShort == null) missing.push("open_interest_short");
  if (liquidity == null) missing.push("liquidity");

  return Object.freeze({
    schemaVersion: 1,
    marketToken: m?.marketToken || null,
    marketName: m?.name || marketName || null,
    market: Object.freeze(market),
    partial: true,
    missing: Object.freeze(missing),
  });
}
