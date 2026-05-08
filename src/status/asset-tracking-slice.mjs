function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundUsd(value) {
  const numeric = finiteNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100) / 100;
}

function blocker(code, message, details = {}) {
  return { code, message, details };
}

function positiveGap(left, right) {
  const l = finiteNumber(left);
  const r = finiteNumber(right);
  if (!Number.isFinite(l) || !Number.isFinite(r)) return null;
  const gap = roundUsd(l - r);
  return Number.isFinite(gap) && gap > 0 ? gap : null;
}

function protocolIssueCount(capitalSummary = {}) {
  return (
    Number(capitalSummary.protocolMarkIssueCount || 0) +
    Number(capitalSummary.unmarkedProtocolPositionCount || 0) +
    Number(capitalSummary.protocolMarkFailedCount || 0) +
    Number(capitalSummary.protocolMarkStaleCount || 0) +
    Number(capitalSummary.protocolMarkExpiredCount || 0)
  );
}

function resolveCoverageState({ blockers = [], riskReady = false } = {}) {
  if (riskReady) return "risk_ready";
  if (blockers.some((item) => item.code === "external_unclassified_reference" || item.code === "reference_full_wallet_gap")) {
    return "reconciliation_gap";
  }
  if (blockers.some((item) => item.code === "protocol_position_gap" || item.code === "movement_in_flight")) {
    return "protocol_or_movement_gap";
  }
  if (blockers.some((item) => item.code === "wallet_scan_error")) {
    return "wallet_scan_gap";
  }
  if (blockers.some((item) => item.code === "wallet_coverage_partial")) {
    return "verified_known_assets_only";
  }
  return "verified_known_assets_only";
}

function observedAtMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function itemFreshnessIsStale(item = {}) {
  return ["stale", "expired", "failed"].includes(String(item.freshness || item.markFreshness || "").toLowerCase());
}

function priceFreshnessIsStale(item = {}) {
  return ["stale", "expired", "failed"].includes(String(item.priceFreshness || "").toLowerCase());
}

function hasFreshnessMetadata(item = {}) {
  return item.freshness !== null && item.freshness !== undefined && item.freshness !== "";
}

function hasPriceSourceMetadata(item = {}) {
  return item.priceSource !== null && item.priceSource !== undefined && item.priceSource !== "";
}

function ratio(count, total) {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return count / total;
}

function oldestObservedAt(items = []) {
  return items
    .filter((item) => Number(item.usd || 0) > 0)
    .map((item) => item.sourceObservedAt || item.markObservedAt || item.lastObservedAt || null)
    .filter(Boolean)
    .sort()[0] || null;
}

function sourceAgeMinutes(observedAt, generatedAt) {
  const observed = observedAtMs(observedAt);
  const generated = observedAtMs(generatedAt);
  if (observed === null || generated === null) return null;
  return (generated - observed) / 60_000;
}

function assetTrackingVerdict({
  riskReady,
  walletScanErrorCount,
  protocolIssues,
  unknownAssetBalanceCount,
  staleItemCount,
  stalePriceItemCount,
  missingFreshnessMetadataCount,
  missingPriceSourceCount,
  divergenceBlockCount,
}) {
  if (
    walletScanErrorCount > 0 ||
    protocolIssues > 0 ||
    unknownAssetBalanceCount > 0 ||
    missingFreshnessMetadataCount > 0 ||
    missingPriceSourceCount > 0 ||
    divergenceBlockCount > 0
  ) return "red";
  if (!riskReady || staleItemCount > 0 || stalePriceItemCount > 0) return "yellow";
  return "green";
}

export function buildAssetTrackingSlice({
  capitalSummary = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const summary = capitalSummary || {};
  const verifiedKnownUsd = roundUsd(
    finiteNumber(summary.currentTotalUsd) ??
      finiteNumber(summary.verifiedMinimumUsd) ??
      finiteNumber(summary.totalUsd),
  );
  const walletUsd = roundUsd(summary.currentWalletUsd ?? summary.walletUsd);
  const protocolUsd = roundUsd(summary.protocolDeployedUsd ?? summary.deployedUsd);
  const externalReferenceUsd = roundUsd(summary.externalWalletUsd ?? summary.fullWalletUsd);
  const externalUnclassifiedUsd = roundUsd(summary.unclassifiedUsd);
  const referenceGapUsd = roundUsd(
    finiteNumber(summary.referenceFullWalletGapUsd) ??
      positiveGap(externalReferenceUsd, verifiedKnownUsd),
  );
  const walletCoverage = summary.walletCoverage || null;
  const walletScanErrorCount = Number(summary.walletScanErrorCount || 0);
  const pendingSignerActionCount = Number(summary.pendingSignerActionCount || 0);
  const unknownAssetBalanceCount = Number(summary.unknownAssetBalanceCount || 0);
  const assetUniverseUnknownTargetCount = Number(summary.assetUniverseUnknownTargetCount || summary.assetUniverse?.unknownTargetCount || 0);
  const blockers = [];
  const walletItems = Array.isArray(summary.walletItems) ? summary.walletItems : [];
  const positionItems = Array.isArray(summary.positionItems) ? summary.positionItems : [];
  const allItems = [...walletItems, ...positionItems];
  const totalAssetCount = allItems.length;
  const freshnessMetadataCount = allItems.filter(hasFreshnessMetadata).length;
  const priceSourceMetadataCount = allItems.filter(hasPriceSourceMetadata).length;
  const divergenceWarnCount = allItems.filter((item) => item.priceDivergenceStatus === "warn").length;
  const divergenceBlockCount = allItems.filter((item) => item.priceDivergenceStatus === "block").length;
  const missingFreshnessMetadataCount = Math.max(0, totalAssetCount - freshnessMetadataCount);
  const missingPriceSourceCount = Math.max(0, totalAssetCount - priceSourceMetadataCount);
  const staleItemCount = Number(summary.staleItemCount ?? allItems.filter(itemFreshnessIsStale).length);
  const stalePriceItemCount = Number(summary.stalePriceItemCount ?? allItems.filter(priceFreshnessIsStale).length);
  const failedProtocolMarkCount = Number(summary.failedProtocolMarkCount ?? summary.protocolMarkFailedCount ?? 0);
  const doubleCountPreventedCount = Number(summary.doubleCountPreventedCount || 0);
  const oldestMaterialSourceObservedAt = summary.oldestMaterialSourceObservedAt || oldestObservedAt(allItems);
  const oldestMaterialSourceAgeMinutes = sourceAgeMinutes(oldestMaterialSourceObservedAt, generatedAt);

  if (walletCoverage !== "full_rpc") {
    blockers.push(blocker("wallet_coverage_partial", "Wallet scan has not proven full-token coverage for this address.", {
      walletCoverage,
      walletSource: summary.walletSource || null,
      walletObservedAt: summary.walletObservedAt || null,
    }));
  }
  if (walletScanErrorCount > 0) {
    blockers.push(blocker("wallet_scan_error", "At least one authoritative wallet scan failed.", {
      count: walletScanErrorCount,
      errors: Array.isArray(summary.walletScanErrors) ? summary.walletScanErrors.slice(0, 5) : [],
    }));
  }
  if (unknownAssetBalanceCount > 0) {
    blockers.push(blocker("unknown_asset_universe_gap", "Transaction-derived asset universe contains token targets that are not committed to the registry or protocol-reader covered.", {
      unknownTargetCount: assetUniverseUnknownTargetCount,
      unknownAssetBalanceCount,
      unknownTargets: Array.isArray(summary.assetUniverse?.unknownTargets) ? summary.assetUniverse.unknownTargets.slice(0, 5) : [],
      unknownAssetBalances: Array.isArray(summary.unknownAssetBalances) ? summary.unknownAssetBalances.slice(0, 5) : [],
    }));
  }
  const protocolIssues = protocolIssueCount(summary);
  if (protocolIssues > 0) {
    blockers.push(blocker("protocol_position_gap", "At least one active protocol position is missing a current verified mark.", {
      count: protocolIssues,
      unmarkedPositionCount: Number(summary.unmarkedProtocolPositionCount || 0),
      failedMarkCount: Number(summary.protocolMarkFailedCount || 0),
      staleMarkCount: Number(summary.protocolMarkStaleCount || 0),
      expiredMarkCount: Number(summary.protocolMarkExpiredCount || 0),
    }));
  }
  if (pendingSignerActionCount > 0) {
    blockers.push(blocker("movement_in_flight", "Recent signer activity has not fully reconciled into wallet/protocol balances.", {
      count: pendingSignerActionCount,
    }));
  }
  if (staleItemCount > 0 || stalePriceItemCount > 0) {
    blockers.push(blocker("stale_material_asset_source", "At least one material wallet or protocol asset source is stale even though the dashboard was regenerated.", {
      staleItemCount,
      stalePriceItemCount,
      oldestMaterialSourceObservedAt,
      oldestMaterialSourceAgeMinutes,
    }));
  }
  if (missingFreshnessMetadataCount > 0 || missingPriceSourceCount > 0) {
    blockers.push(blocker("asset_metadata_coverage_gap", "Every tracked asset must expose freshness and price-source metadata before the dashboard can be green.", {
      totalAssetCount,
      missingFreshnessMetadataCount,
      missingPriceSourceCount,
      freshnessCoveragePct: ratio(freshnessMetadataCount, totalAssetCount),
      priceSourceCoveragePct: ratio(priceSourceMetadataCount, totalAssetCount),
    }));
  }
  if (divergenceBlockCount > 0) {
    blockers.push(blocker("price_divergence_block", "At least one tracked asset has blocked price-source divergence and is excluded from exact capital.", {
      divergenceBlockCount,
    }));
  }
  if (Number.isFinite(externalUnclassifiedUsd) && externalUnclassifiedUsd > 0) {
    blockers.push(blocker("external_unclassified_reference", "External portfolio reference includes unclassified value that cannot be used as exact capital.", {
      provider: summary.fullWalletProvider || null,
      usd: externalUnclassifiedUsd,
    }));
  }
  if (Number.isFinite(referenceGapUsd) && referenceGapUsd > 1) {
    blockers.push(blocker("reference_full_wallet_gap", "External reference is higher than verified known assets.", {
      provider: summary.fullWalletProvider || null,
      usd: referenceGapUsd,
    }));
  }

  const riskReady = blockers.length === 0 && walletCoverage === "full_rpc" && Number.isFinite(verifiedKnownUsd);
  const exactTotalUsd = riskReady ? verifiedKnownUsd : null;
  const coverageState = resolveCoverageState({ blockers, riskReady });
  const unexplainedGapUsd = Number.isFinite(referenceGapUsd)
    ? referenceGapUsd
    : Number.isFinite(externalUnclassifiedUsd)
      ? externalUnclassifiedUsd
      : null;

  return {
    schemaVersion: 1,
    generatedAt,
    coverageState,
    verdict: assetTrackingVerdict({
      riskReady,
      walletScanErrorCount,
      protocolIssues,
      unknownAssetBalanceCount,
      staleItemCount,
      stalePriceItemCount,
      missingFreshnessMetadataCount,
      missingPriceSourceCount,
      divergenceBlockCount,
    }),
    coverage: walletCoverage || "pending",
    dashboardHeadline: riskReady ? "Exact tracked assets" : "Verified known assets only",
    riskReady,
    exactTotalUsd,
    verifiedKnownUsd,
    riskUsableUsd: riskReady ? verifiedKnownUsd : 0,
    walletUsd,
    protocolUsd,
    walletCoverage,
    walletSource: summary.walletSource || null,
    walletObservedAt: summary.walletObservedAt || null,
    assetUniverse: summary.assetUniverse || null,
    unknownAssetBalanceCount,
    totalAssetCount,
    freshnessMetadataCount,
    freshnessCoveragePct: ratio(freshnessMetadataCount, totalAssetCount),
    priceSourceMetadataCount,
    priceSourceCoveragePct: ratio(priceSourceMetadataCount, totalAssetCount),
    divergenceWarnCount,
    divergenceBlockCount,
    missingFreshnessMetadataCount,
    missingPriceSourceCount,
    staleItemCount,
    stalePriceItemCount,
    failedProtocolMarkCount,
    doubleCountPreventedCount,
    oldestMaterialSourceObservedAt,
    oldestMaterialSourceAgeMinutes,
    assetUniverseUnknownTargetCount,
    externalReferenceUsd,
    externalProvider: summary.fullWalletProvider || null,
    externalUnclassifiedUsd,
    unexplainedGapUsd,
    blockerCount: blockers.length,
    blockers,
  };
}
