function compactMoney(value) {
  if (!Number.isFinite(value)) return null;
  if (value >= 1000) {
    const compact = value / 1000;
    const digits = compact >= 100 ? 0 : 1;
    return `$${compact.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: digits })}k`;
  }
  if (value >= 1) return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}`;
}

export function marketCoverage(market = {}) {
  const prices = market?.chainWbtcPrices || [];
  const nonBitcoin = prices.filter((item) => item?.chain !== "bitcoin");
  const observed = nonBitcoin.filter((item) => Number.isFinite(item?.usd)).length;
  const stale = nonBitcoin.filter((item) => Number.isFinite(item?.usd) && Boolean(item?.stale)).length;
  return {
    total: nonBitcoin.length,
    observed,
    missing: Math.max(0, nonBitcoin.length - observed),
    stale,
  };
}

export function referenceMarketPrice(market = {}) {
  if (!Number.isFinite(market?.wbtcUsd)) return null;
  const ageMinutes = Number.isFinite(market?.ageMinutes) ? market.ageMinutes : null;
  const staleMinutes = Number.isFinite(market?.chainPriceStaleMinutes) ? market.chainPriceStaleMinutes : null;
  return {
    ticker: "wBTC",
    usd: market.wbtcUsd,
    stale: Number.isFinite(ageMinutes) && Number.isFinite(staleMinutes) ? ageMinutes > staleMinutes : false,
  };
}

export function chainPriceExtremes(prices = []) {
  const valid = (prices || []).filter((item) => Number.isFinite(item?.usd));
  if (valid.length < 2) return new Map();

  const highest = Math.max(...valid.map((item) => item.usd));
  const lowest = Math.min(...valid.map((item) => item.usd));
  if (highest === lowest) return new Map();

  const classes = new Map();
  for (const item of valid) {
    if (item.usd === highest) classes.set(item.chain, "price-high");
    if (item.usd === lowest) classes.set(item.chain, "price-low");
  }
  return classes;
}

export function routeSublineText(status = {}) {
  if (status.gateway?.updateDetected) return "새 경로 변화 확인 중";

  const coverage = marketCoverage(status.market);
  const reference = referenceMarketPrice(status.market);
  const parts = [];
  if (coverage.total > 0) parts.push(`체인 실측 ${coverage.observed}/${coverage.total}`);
  if (reference) parts.push(`기준 ${reference.ticker} ${compactMoney(reference.usd)}`);
  if (coverage.stale > 0) parts.push(`stale ${coverage.stale}`);
  return parts.join(" · ");
}

