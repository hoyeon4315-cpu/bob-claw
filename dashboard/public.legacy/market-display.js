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

function compactDeltaPct(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) < 0.005) return "~0%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function coverageDetail(reason) {
  return {
    dex_quote_observed: "",
    btc_spot_reference: "BTC 현물 기준",
    odos_chain_not_supported: "DEX 미지원",
    stable_quote_token_missing: "quote 토큰 필요",
    eligible_quote_not_run: "실측 대기",
    wrapped_btc_leg_not_sampled: "실측 대기",
    odos_quote_failed: "최근 quote 실패",
    input_is_quote_stable: "stable pair 제외",
  }[reason || ""] || "실측 대기";
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

export function chainPriceCaption(price, chain, market = {}) {
  const referencePrice = referenceMarketPrice(market);
  if (price && Number.isFinite(price.usd)) {
    return {
      value: chain === "bitcoin" ? `${price.ticker} ${compactMoney(price.usd)}` : compactMoney(price.usd),
      delta: chain === "bitcoin" ? "" : compactDeltaPct(price.deltaPct),
      note: "",
      stale: Boolean(price.stale),
      variant: "observed",
    };
  }
  if (chain === "bitcoin" || !referencePrice || !Number.isFinite(referencePrice.usd)) return null;
  return {
    value: compactMoney(referencePrice.usd),
    delta: `기준 ${referencePrice.ticker}`,
    note: coverageDetail(price?.coverageReason),
    stale: Boolean(referencePrice.stale),
    variant: "reference",
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
  if (status.gateway?.updateDetected) return "새 경로 변화가 보여서 흐름을 다시 확인하는 중";

  const coverage = marketCoverage(status.market);
  const reference = referenceMarketPrice(status.market);
  const parts = [];
  if (coverage.total > 0) parts.push(`체인 실측 ${coverage.observed}/${coverage.total}`);
  if (reference) parts.push(`${reference.ticker} 기준 ${compactMoney(reference.usd)}`);
  if (coverage.stale > 0) parts.push(`오래된 가격 ${coverage.stale}`);
  return parts.join(" · ") || "플로우맵에 들어올 최신 데이터를 기다리는 중";
}
