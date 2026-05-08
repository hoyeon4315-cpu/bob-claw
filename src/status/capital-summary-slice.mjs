import { buildReconciliationSummary } from "./reconciliation-loop.mjs";

function positionAssetSymbol(position = {}) {
  const pair = Array.isArray(position.pair) ? position.pair : [];
  return String(pair[0] || "position").toLowerCase();
}

function priceSourceForPosition(position = {}) {
  const existing = position.priceSource;
  if (existing && typeof existing === "object") return existing;
  const observedAt = position.priceObservedAt || position.markObservedAt || position.lastObservedAt || null;
  return {
    name: String(existing || position.markSource || "protocol_position_mark"),
    type: "protocol_position_mark",
    observedAt,
    divergencePct: finiteNumber(position.priceDivergencePct) ?? 0,
  };
}

function deployedPositionItem(position = {}) {
  const usd = finiteNumber(position.valueUsd) ??
    finiteNumber(position.markUsd) ??
    finiteNumber(position.currentValueUsd) ??
    finiteNumber(position.positionValueUsd) ??
    finiteNumber(position.capUsd);
  const entryUsd = finiteNumber(position.capUsd);
  const symbol = positionAssetSymbol(position);
  return {
    sym: symbol,
    name: position.label || `Position ${position.opportunityId || ""}`.trim(),
    chain: position.chain || null,
    protocol: position.protocol || null,
    amount: null,
    usd: Number.isFinite(usd) ? usd : 0,
    entryUsd,
    family: "position",
    status: "deployed",
    opportunityId: position.opportunityId || null,
    lastObservedAt: position.lastObservedAt || null,
    markSource: position.markSource || null,
    markFreshness: position.markFreshness || null,
    markConfidence: position.markConfidence || null,
    markObservedAt: position.markObservedAt || null,
    markFailureKind: position.markFailureKind || null,
    markFailureMessage: position.markFailureMessage || null,
    source: "protocol_position_mark",
    sourceObservedAt: position.markObservedAt || position.lastObservedAt || null,
    priceSource: priceSourceForPosition(position),
    priceObservedAt: position.priceObservedAt || position.markObservedAt || position.lastObservedAt || null,
    priceFreshness: position.priceFreshness || position.markFreshness || null,
    priceDivergenceStatus: position.priceDivergenceStatus || null,
    freshness: position.freshness || position.markFreshness || null,
    confidence: position.confidence || position.markConfidence || null,
    countedInWalletTotal: false,
  };
}

function roundUsd(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function scanErrorItem(error = {}) {
  return {
    kind: error.kind || null,
    provider: error.provider || null,
    chain: error.chain || null,
    token: error.token || null,
    message: error.message || null,
  };
}

function isAuthoritativeScanError(error = {}) {
  return error?.kind !== "external_portfolio";
}

function positiveRoundedDelta(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const delta = roundUsd(left - right);
  return Number.isFinite(delta) && delta > 0 ? delta : null;
}

function isCurrentProtocolMark(item = {}) {
  if (item.markSource !== "protocol_position_mark") return false;
  return (
    item.markConfidence === "verified_current" ||
    item.markFreshness === "fresh" ||
    item.markFreshness === "recent"
  );
}

export function buildCapitalSummarySlice({
  walletHoldings = null,
  merklActivePositions = null,
  protocolPositionMarks = null,
  executorEstimatedAssetValueUsd = null,
  signerAuditRecords = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const walletItems = Array.isArray(walletHoldings?.items) ? walletHoldings.items : [];
  const positionItems = (merklActivePositions?.items || []).map(deployedPositionItem);
  const unmarkedProtocolPositionCount = positionItems.filter(
    (item) => (Number(item.usd) || 0) > 0 && !isCurrentProtocolMark(item),
  ).length;
  const protocolMarkFailedCount = Number(protocolPositionMarks?.failedPositionCount || 0);
  const protocolMarkStaleCount = Number(protocolPositionMarks?.stalePositionCount || 0);
  const protocolMarkExpiredCount = Number(protocolPositionMarks?.expiredPositionCount || 0);
  const protocolMarkNeedsReconciliation =
    protocolPositionMarks &&
    (
      protocolPositionMarks.confidence !== "verified_current" ||
      protocolMarkFailedCount > 0 ||
      protocolMarkStaleCount > 0 ||
      protocolMarkExpiredCount > 0
    );
  const everyProtocolPositionMarked = unmarkedProtocolPositionCount === 0 && !protocolMarkNeedsReconciliation;
  const walletUsd = Number.isFinite(walletHoldings?.totalUsd)
    ? walletHoldings.totalUsd
    : walletItems.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  const deployedUsd = positionItems.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  const accountedUsd = walletUsd + deployedUsd;
  const rawFullWalletUsd = finiteNumber(walletHoldings?.fullWalletUsd);
  const rawWalletCoverage = walletHoldings?.walletCoverage || null;
  const fullWalletStale = walletHoldings?.fullWalletStale === true;
  const hasCurrentExternalReference = rawWalletCoverage === "full_external" && !fullWalletStale && Number.isFinite(rawFullWalletUsd);
  const fullWalletUsd = hasCurrentExternalReference ? rawFullWalletUsd : null;
  const walletCoverage = hasCurrentExternalReference
    ? rawWalletCoverage
    : rawWalletCoverage === "full_external_stale"
      ? "partial_supported"
      : rawWalletCoverage;
  const walletScanErrors = Array.isArray(walletHoldings?.scanErrors)
    ? walletHoldings.scanErrors.filter(isAuthoritativeScanError).slice(0, 5).map(scanErrorItem)
    : [];
  const walletScanErrorCount = Array.isArray(walletHoldings?.scanErrors)
    ? walletScanErrors.length
    : walletHoldings?.scanErrorCount ?? 0;
  const unknownAssetBalanceCount = Number(walletHoldings?.unknownAssetBalanceCount || 0);
  const assetUniverseUnknownTargetCount = Number(walletHoldings?.assetUniverse?.unknownTargetCount || 0);
  const displayWalletUsd = walletUsd;
  const displayTotalUsd = displayWalletUsd + deployedUsd;
  const currentWalletUsd = displayWalletUsd;
  const protocolDeployedUsd = deployedUsd;
  const currentTotalUsd = displayTotalUsd;
  const displayTotalUsdSource = walletCoverage === "full_external"
    ? "supported_wallet_plus_positions_external_reference"
    : walletCoverage === "full_external_stale"
      ? "supported_wallet_plus_positions_cached_external_reference"
      : "partial_supported_wallet_plus_positions";
  const walletCoverageNotExact = walletCoverage !== "full_rpc";
  const capitalPlanRefillRequiredUsd = Number.isFinite(executorEstimatedAssetValueUsd)
    ? roundUsd(executorEstimatedAssetValueUsd)
    : null;
  const executorEstimatedTotalUsd = null;
  const executorEstimateDeltaUsd = null;
  const referenceFullWalletGapUsd = positiveRoundedDelta(fullWalletUsd, currentTotalUsd);
  const planGapUsd = null;
  const protocolTrackingGapUsd = null;
  const estimatedUntrackedProtocolUsd = Number.isFinite(protocolTrackingGapUsd) && protocolTrackingGapUsd > 0
    ? protocolTrackingGapUsd
    : null;
  const estimatedProtocolDeployedUsd = Number.isFinite(estimatedUntrackedProtocolUsd)
    ? roundUsd(protocolDeployedUsd + estimatedUntrackedProtocolUsd)
    : roundUsd(protocolDeployedUsd);
  const estimatedCurrentTotalUsd = Number.isFinite(estimatedUntrackedProtocolUsd)
    ? roundUsd(currentWalletUsd + estimatedProtocolDeployedUsd)
    : roundUsd(currentTotalUsd);
  const estimatedTotalUsdSource = Number.isFinite(estimatedUntrackedProtocolUsd)
    ? "automation_estimate_with_verified_wallet_floor"
    : "verified_wallet_plus_tracked_protocols";
  const trackingGapSource = Number.isFinite(protocolTrackingGapUsd) && protocolTrackingGapUsd > 0
    ? "automation_estimate_minus_verified_assets"
    : null;
  const warningThresholdUsd = Math.max(10, accountedUsd * 0.1);
  const accountingWarning = Number.isFinite(executorEstimateDeltaUsd) && Math.abs(executorEstimateDeltaUsd) > warningThresholdUsd
    ? "automation_plan_estimate_differs_from_wallet_scan"
    : null;
  const needsReconciliation =
    walletCoverageNotExact ||
    walletScanErrorCount > 0 ||
    unknownAssetBalanceCount > 0 ||
    unmarkedProtocolPositionCount > 0 ||
    protocolMarkNeedsReconciliation ||
    (Number.isFinite(referenceFullWalletGapUsd) && referenceFullWalletGapUsd > 1) ||
    Boolean(accountingWarning);
  const assetConfidence = needsReconciliation ? "verified_minimum" : "verified_current";
  const reconciliationState = needsReconciliation
    ? walletCoverageNotExact && unmarkedProtocolPositionCount === 0 && !protocolMarkNeedsReconciliation && walletScanErrorCount === 0 && !accountingWarning
      ? "needs_full_wallet_coverage"
      : (unmarkedProtocolPositionCount > 0 || protocolMarkNeedsReconciliation) && walletScanErrorCount === 0 && !accountingWarning
      ? "needs_protocol_position_marks"
      : "needs_reconciliation"
    : "reconciled";
  const assetFormula = everyProtocolPositionMarked
    ? "current_wallet_plus_marked_protocol_positions"
    : "current_wallet_plus_tracked_protocol_positions";
  const baseSummary = {
    schemaVersion: 1,
    generatedAt,
    walletUsd,
    deployedUsd,
    accountedUsd,
    executorEstimatedTotalUsd,
    executorEstimateDeltaUsd,
    capitalPlanRefillRequiredUsd,
    accountingWarning,
    totalUsd: accountedUsd,
    totalUsdSource: "accounted_wallet_plus_positions",
    displayWalletUsd,
    displayTotalUsd: roundUsd(displayTotalUsd),
    displayTotalUsdSource,
    currentWalletUsd,
    protocolDeployedUsd: roundUsd(protocolDeployedUsd),
    currentTotalUsd: roundUsd(currentTotalUsd),
    verifiedMinimumUsd: roundUsd(currentTotalUsd),
    estimatedUntrackedProtocolUsd,
    estimatedProtocolDeployedUsd,
    estimatedCurrentTotalUsd,
    estimatedTotalUsdSource,
    assetFormula,
    assetConfidence,
    assetHeadline: assetConfidence === "verified_minimum" ? "Verified minimum assets" : "Current total assets",
    estimatedAssetHeadline: Number.isFinite(estimatedUntrackedProtocolUsd)
      ? "Estimated total assets"
      : assetConfidence === "verified_minimum"
        ? "Verified minimum assets"
        : "Current total assets",
    reconciliationState,
    unmarkedProtocolPositionCount,
    protocolMarkFailedCount,
    protocolMarkStaleCount,
    protocolMarkExpiredCount,
    staleItemCount: Number(walletHoldings?.staleItemCount || 0) + positionItems.filter((item) => ["stale", "expired", "failed"].includes(String(item.markFreshness || "").toLowerCase())).length,
    stalePriceItemCount: Number(walletHoldings?.stalePriceItemCount || 0) + positionItems.filter((item) => ["stale", "expired", "failed"].includes(String(item.priceFreshness || "").toLowerCase())).length,
    failedProtocolMarkCount: protocolMarkFailedCount,
    doubleCountPreventedCount: Number(walletHoldings?.doubleCountPreventedCount || 0),
    oldestMaterialSourceObservedAt: [walletHoldings?.oldestMaterialSourceObservedAt, protocolPositionMarks?.oldestMaterialSourceObservedAt]
      .filter(Boolean)
      .sort()[0] || null,
    assetTrackingTotals: walletHoldings?.totals || null,
    referenceFullWalletGapUsd,
    planGapUsd,
    protocolTrackingGapUsd,
    trackingGapUsd: protocolTrackingGapUsd,
    trackingGapSource,
    itemizedSupportedWalletUsd: finiteNumber(walletHoldings?.itemizedSupportedWalletUsd),
    walletCoverage,
    fullWalletUsd,
    fullWalletObservedAt: hasCurrentExternalReference ? walletHoldings?.fullWalletObservedAt || null : null,
    fullWalletProvider: hasCurrentExternalReference ? walletHoldings?.fullWalletProvider || null : null,
    fullWalletStale: false,
    walletSource: walletHoldings?.source || null,
    walletObservedAt: walletHoldings?.observedAt || null,
    walletScanErrorCount,
    walletScanErrors,
    assetUniverse: walletHoldings?.assetUniverse || null,
    assetUniverseUnknownTargetCount,
    unknownAssetBalanceCount,
    unknownAssetBalances: (walletHoldings?.unknownAssetBalances || []).slice(0, 10),
    externalWalletUsd: hasCurrentExternalReference ? walletHoldings?.externalWalletUsd ?? null : null,
    unclassifiedUsd: hasCurrentExternalReference ? walletHoldings?.unclassifiedUsd ?? null : null,
    walletItemCount: walletItems.length,
    activePositionCount: positionItems.length,
    walletItems,
    positionItems,
  };
  const reconciliation = buildReconciliationSummary({
    capitalSummary: baseSummary,
    protocolPositionMarks,
    merklActivePositions,
    signerAuditRecords,
    generatedAt,
  });
  return {
    ...baseSummary,
    ...reconciliation,
  };
}
