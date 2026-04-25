function compactTickerList(items = [], limit = 4) {
  const tickers = [...new Set((items || []).filter(Boolean))];
  if (tickers.length <= limit) return tickers.join(", ") || "none";
  return `${tickers.slice(0, limit).join(", ")} +${tickers.length - limit}`;
}

export function buildWatchlistDisplay(summary) {
  const observed = summary?.observedTickers || [];
  const missing = summary?.missingTickers || [];
  const unknown = summary?.unknownAssets || [];

  return {
    badge: `${observed.length} live · ${missing.length} watch`,
    observedText: compactTickerList(observed, 5),
    missingText: compactTickerList(missing, 4),
    unknownText: unknown.length ? compactTickerList(unknown.map((item) => `${item.chain}:${item.token}`), 2) : "none",
  };
}
