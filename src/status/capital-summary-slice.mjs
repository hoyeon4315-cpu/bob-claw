function positionAssetSymbol(position = {}) {
  const pair = Array.isArray(position.pair) ? position.pair : [];
  return String(pair[0] || "position").toLowerCase();
}

function deployedPositionItem(position = {}) {
  const usd = Number(position.capUsd);
  const symbol = positionAssetSymbol(position);
  return {
    sym: symbol,
    name: position.label || `Position ${position.opportunityId || ""}`.trim(),
    chain: position.chain || null,
    protocol: position.protocol || null,
    amount: null,
    usd: Number.isFinite(usd) ? usd : 0,
    family: "position",
    status: "deployed",
    opportunityId: position.opportunityId || null,
    lastObservedAt: position.lastObservedAt || null,
  };
}

export function buildCapitalSummarySlice({
  walletHoldings = null,
  merklActivePositions = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const walletItems = Array.isArray(walletHoldings?.items) ? walletHoldings.items : [];
  const positionItems = (merklActivePositions?.items || []).map(deployedPositionItem);
  const walletUsd = Number.isFinite(walletHoldings?.totalUsd)
    ? walletHoldings.totalUsd
    : walletItems.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  const deployedUsd = positionItems.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  return {
    schemaVersion: 1,
    generatedAt,
    walletUsd,
    deployedUsd,
    totalUsd: walletUsd + deployedUsd,
    walletSource: walletHoldings?.source || null,
    walletObservedAt: walletHoldings?.observedAt || null,
    walletScanErrorCount: walletHoldings?.scanErrorCount ?? 0,
    externalWalletUsd: walletHoldings?.externalWalletUsd ?? null,
    unclassifiedUsd: walletHoldings?.unclassifiedUsd ?? null,
    walletItemCount: walletItems.length,
    activePositionCount: positionItems.length,
    walletItems,
    positionItems,
  };
}
