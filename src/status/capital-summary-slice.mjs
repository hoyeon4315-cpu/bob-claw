import { buildReconciliationSummary } from "./reconciliation-loop.mjs";

export const ACCOUNTING_PROVENANCE = Object.freeze({
  TOTAL_ACCOUNTED_WALLET_PLUS_POSITIONS: "accounted_wallet_plus_positions",
  DISPLAY_SUPPORTED_WALLET_PLUS_POSITIONS_EXTERNAL_REFERENCE: "supported_wallet_plus_positions_external_reference",
  DISPLAY_SUPPORTED_WALLET_PLUS_POSITIONS_CACHED_EXTERNAL_REFERENCE: "supported_wallet_plus_positions_cached_external_reference",
  DISPLAY_PARTIAL_SUPPORTED_WALLET_PLUS_POSITIONS: "partial_supported_wallet_plus_positions",
  ESTIMATED_AUTOMATION_WITH_VERIFIED_WALLET_FLOOR: "automation_estimate_with_verified_wallet_floor",
  ESTIMATED_VERIFIED_WALLET_PLUS_TRACKED_PROTOCOLS: "verified_wallet_plus_tracked_protocols",
  TRACKING_AUTOMATION_ESTIMATE_MINUS_VERIFIED_ASSETS: "automation_estimate_minus_verified_assets",
});

export const ASSET_FORMULA = Object.freeze({
  CURRENT_WALLET_PLUS_MARKED_PROTOCOL_POSITIONS: "current_wallet_plus_marked_protocol_positions",
  CURRENT_WALLET_PLUS_TRACKED_PROTOCOL_POSITIONS: "current_wallet_plus_tracked_protocol_positions",
});

export const CLAIM_LABEL = Object.freeze({
  VERIFIED: "Verified",
  INFERRED: "Inferred",
  UNVERIFIED: "Unverified",
  CONTRADICTED: "Contradicted",
});

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
  const rawUsd = finiteNumber(position.valueUsd) ??
    finiteNumber(position.markUsd) ??
    finiteNumber(position.currentValueUsd) ??
    finiteNumber(position.positionValueUsd);
  const entryUsd = finiteNumber(position.capUsd);
  const symbol = positionAssetSymbol(position);
  const observedAt = position.markObservedAt || position.lastObservedAt || null;
  const hasMarkFailure = Boolean(position.markFailureKind || position.markFailureMessage);
  const markFreshness = position.markFreshness || (hasMarkFailure ? "failed" : observedAt ? "fresh" : null);
  const markConfidence = position.markConfidence || (hasMarkFailure ? "adapter_missing" : Number.isFinite(rawUsd) && rawUsd <= 0 ? "verified_current" : null);
  const hasCurrentMark =
    position.markSource === "protocol_position_mark" &&
    (markConfidence === "verified_current" || markFreshness === "fresh" || markFreshness === "recent");
  const zeroResidual = Number.isFinite(rawUsd) && rawUsd <= 0 && !hasMarkFailure;
  const usd = hasCurrentMark || zeroResidual ? rawUsd : null;
  const staleReferenceUsd = !Number.isFinite(usd) && Number.isFinite(rawUsd) && rawUsd > 0 ? rawUsd : null;
  const unverifiedEntryUsd = !Number.isFinite(usd) && Number.isFinite(entryUsd) && entryUsd > 0 ? entryUsd : null;
  return {
    sym: symbol,
    name: position.label || `Position ${position.opportunityId || ""}`.trim(),
    chain: position.chain || null,
    protocol: position.protocol || null,
    amount: null,
    usd: Number.isFinite(usd) ? usd : null,
    entryUsd,
    staleReferenceUsd,
    unverifiedEntryUsd,
    valuationState: Number.isFinite(usd)
      ? "verified_current"
      : hasMarkFailure
        ? "mark_failed"
        : staleReferenceUsd != null
          ? "stale_reference"
          : unverifiedEntryUsd != null
            ? "entry_only"
            : "unpriced",
    family: "position",
    status: "deployed",
    opportunityId: position.opportunityId || null,
    lastObservedAt: position.lastObservedAt || null,
    markSource: position.markSource || null,
    markFreshness,
    markConfidence,
    markObservedAt: position.markObservedAt || null,
    markFailureKind: position.markFailureKind || null,
    markFailureMessage: position.markFailureMessage || null,
    source: "protocol_position_mark",
    sourceObservedAt: position.markObservedAt || position.lastObservedAt || null,
    priceSource: priceSourceForPosition(position),
    priceObservedAt: position.priceObservedAt || position.markObservedAt || position.lastObservedAt || null,
    priceFreshness: position.priceFreshness || markFreshness,
    priceDivergenceStatus: position.priceDivergenceStatus || "ok",
    freshness: position.freshness || markFreshness,
    confidence: position.confidence || markConfidence,
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
    (item) => !isCurrentProtocolMark(item),
  ).length;
  const unverifiedProtocolEntryUsd = roundUsd(positionItems.reduce((sum, item) => {
    if (isCurrentProtocolMark(item)) return sum;
    return sum + (Number(item.unverifiedEntryUsd) || 0);
  }, 0));
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
    ? ACCOUNTING_PROVENANCE.DISPLAY_SUPPORTED_WALLET_PLUS_POSITIONS_EXTERNAL_REFERENCE
    : walletCoverage === "full_external_stale"
      ? ACCOUNTING_PROVENANCE.DISPLAY_SUPPORTED_WALLET_PLUS_POSITIONS_CACHED_EXTERNAL_REFERENCE
      : ACCOUNTING_PROVENANCE.DISPLAY_PARTIAL_SUPPORTED_WALLET_PLUS_POSITIONS;
  const walletCoverageNotExact = walletCoverage !== "full_rpc";
  const capitalPlanRefillRequiredUsd = Number.isFinite(executorEstimatedAssetValueUsd)
    ? roundUsd(executorEstimatedAssetValueUsd)
    : null;
  const executorEstimatedTotalUsd = walletCoverage === "full_rpc"
    ? finiteNumber(executorEstimatedAssetValueUsd)
    : null;
  const executorEstimateDeltaUsd = positiveRoundedDelta(executorEstimatedTotalUsd, currentTotalUsd);
  const referenceFullWalletGapUsd = positiveRoundedDelta(fullWalletUsd, currentTotalUsd);
  const planGapUsd = null;
  const protocolTrackingGapUsd = executorEstimateDeltaUsd;
  const estimatedUntrackedProtocolUsd = Number.isFinite(protocolTrackingGapUsd) && protocolTrackingGapUsd > 0
    ? protocolTrackingGapUsd
    : Number.isFinite(unverifiedProtocolEntryUsd) && unverifiedProtocolEntryUsd > 0
      ? unverifiedProtocolEntryUsd
      : null;
  const estimatedProtocolDeployedUsd = Number.isFinite(estimatedUntrackedProtocolUsd)
    ? roundUsd(protocolDeployedUsd + estimatedUntrackedProtocolUsd)
    : roundUsd(protocolDeployedUsd);
  const estimatedCurrentTotalUsd = Number.isFinite(estimatedUntrackedProtocolUsd)
    ? roundUsd(currentWalletUsd + estimatedProtocolDeployedUsd)
    : roundUsd(currentTotalUsd);
  const estimatedTotalUsdSource = Number.isFinite(estimatedUntrackedProtocolUsd)
    ? ACCOUNTING_PROVENANCE.ESTIMATED_AUTOMATION_WITH_VERIFIED_WALLET_FLOOR
    : ACCOUNTING_PROVENANCE.ESTIMATED_VERIFIED_WALLET_PLUS_TRACKED_PROTOCOLS;
  const trackingGapSource = Number.isFinite(protocolTrackingGapUsd) && protocolTrackingGapUsd > 0
    ? ACCOUNTING_PROVENANCE.TRACKING_AUTOMATION_ESTIMATE_MINUS_VERIFIED_ASSETS
    : null;
  const accountingWarning = null;
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
    ? ASSET_FORMULA.CURRENT_WALLET_PLUS_MARKED_PROTOCOL_POSITIONS
    : ASSET_FORMULA.CURRENT_WALLET_PLUS_TRACKED_PROTOCOL_POSITIONS;
  const assetClaimLabel = accountingWarning
    ? CLAIM_LABEL.CONTRADICTED
    : Number.isFinite(protocolTrackingGapUsd) && protocolTrackingGapUsd > 0
      ? CLAIM_LABEL.INFERRED
      : assetConfidence === "verified_current"
        ? CLAIM_LABEL.VERIFIED
        : CLAIM_LABEL.UNVERIFIED;
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
    totalUsdSource: ACCOUNTING_PROVENANCE.TOTAL_ACCOUNTED_WALLET_PLUS_POSITIONS,
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
    assetClaimLabel,
    assetConfidence,
    assetHeadline: assetConfidence === "verified_minimum" ? "Verified minimum assets" : "Current total assets",
    estimatedAssetHeadline: Number.isFinite(estimatedUntrackedProtocolUsd)
      ? "Estimated total assets"
      : assetConfidence === "verified_minimum"
        ? "Verified minimum assets"
        : "Current total assets",
    reconciliationState,
    unmarkedProtocolPositionCount,
    unverifiedProtocolEntryUsd,
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
