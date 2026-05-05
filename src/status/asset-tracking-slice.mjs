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
    assetUniverseUnknownTargetCount,
    externalReferenceUsd,
    externalProvider: summary.fullWalletProvider || null,
    externalUnclassifiedUsd,
    unexplainedGapUsd,
    blockerCount: blockers.length,
    blockers,
  };
}
