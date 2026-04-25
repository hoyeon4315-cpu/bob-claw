function latestByObservedAt(records = []) {
  return [...records]
    .filter((record) => record?.observedAt)
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())
    .at(-1) || null;
}

function normalizeSymbol(value = "") {
  return String(value || "").toLowerCase().replace(/\.oft$/u, "");
}

function inventoryItem(entry = {}, family) {
  const symbol = entry.ticker || entry.asset || entry.symbol || entry.name || "asset";
  const amount = Number(entry.actualDecimal);
  const usd = Number(entry.estimatedUsd);
  return {
    sym: normalizeSymbol(symbol),
    name: symbol,
    chain: entry.chain || null,
    amount: Number.isFinite(amount) ? amount : 0,
    usd: Number.isFinite(usd) ? usd : 0,
    family,
    status: entry.status || null,
  };
}

export function buildTreasuryHoldingsSlice(records = [], { generatedAt = new Date().toISOString() } = {}) {
  const latest = latestByObservedAt(records);
  if (!latest) {
    return {
      schemaVersion: 1,
      generatedAt,
      observedAt: null,
      pending: true,
      totalUsd: null,
      activeChainCount: 0,
      items: [],
      protocolApr: {},
    };
  }

  const items = [
    ...(latest.native || []).map((entry) => inventoryItem(entry, "native")),
    ...(latest.tokens || []).map((entry) => inventoryItem(entry, "token")),
  ]
    .filter((item) => item.usd > 0 || item.amount > 0)
    .sort((a, b) => (b.usd || 0) - (a.usd || 0));

  return {
    schemaVersion: 1,
    generatedAt,
    observedAt: latest.observedAt || null,
    pending: false,
    totalUsd: Number.isFinite(latest.summary?.estimatedWalletUsd) ? latest.summary.estimatedWalletUsd : items.reduce((sum, item) => sum + item.usd, 0),
    activeChainCount: latest.summary?.activeChainCount ?? latest.activeChains?.length ?? 0,
    supportedChainCount: latest.summary?.supportedChainCount ?? latest.supportedChains?.length ?? 0,
    refillRequiredCount:
      (latest.summary?.nativeRefillRequiredCount ?? 0) + (latest.summary?.tokenRefillRequiredCount ?? 0),
    items,
    protocolApr: {},
  };
}
