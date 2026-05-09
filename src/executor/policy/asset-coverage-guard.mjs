function finiteCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizedText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const EXPLICIT_NEW_EXPOSURE_INTENT_TYPES = new Set([
  "deposit",
  "erc4626_deposit",
  "supply",
  "stake",
  "mint",
  "open_position",
  "increase_position",
  "tiny_live_canary",
]);

function isExitLikeIntent(intent = {}) {
  const candidates = [
    intent.intentType,
    intent.kind,
    intent.mode,
    intent.executionReason,
    intent.intentId,
    intent.metadata?.exposureAction,
    intent.metadata?.executionReason,
  ].map(normalizedText);

  return candidates.some((value) =>
    value === "risk_unwind" ||
    value.includes("emergency_unwind") ||
    value.includes("unwind") ||
    value.includes("redeem") ||
    value.includes("withdraw") ||
    value.includes("exit") ||
    value.includes("close_position") ||
    value.includes("decrease"),
  );
}

function isOpeningOrIncreasingIntent(intent = {}) {
  const exposureAction = normalizedText(intent.metadata?.exposureAction || intent.exposureAction);
  if (["open", "entry", "enter", "increase", "deposit", "supply", "stake", "mint"].includes(exposureAction)) {
    return true;
  }
  if (isExitLikeIntent(intent)) return false;
  return EXPLICIT_NEW_EXPOSURE_INTENT_TYPES.has(normalizedText(intent.intentType || intent.kind));
}

function resolveAssetCoverage({ intent = {}, riskContext = null } = {}) {
  return (
    riskContext?.assetCoverage ||
    riskContext?.walletHoldings?.assetCoverage ||
    riskContext?.walletHoldings?.summary ||
    intent.metadata?.assetCoverage ||
    intent.metadata?.assetUniverse ||
    null
  );
}

function coverageGaps(assetCoverage = null, intent = {}) {
  const gaps = [
    ...compactArray(assetCoverage?.gaps),
    ...compactArray(assetCoverage?.coverageGaps),
    ...compactArray(assetCoverage?.unknownAssets),
    ...compactArray(assetCoverage?.unknownTargets),
    ...compactArray(assetCoverage?.unknownAssetBalances),
    ...compactArray(intent.metadata?.assetCoverageGaps),
    ...compactArray(intent.metadata?.unknownAssets),
    ...compactArray(intent.metadata?.unknownAssetBalances),
  ];
  const unknownCount =
    finiteCount(assetCoverage?.unknownAssetBalanceCount) +
    finiteCount(assetCoverage?.unknownTargetCount) +
    finiteCount(assetCoverage?.assetUniverseUnknownTargetCount) +
    finiteCount(intent.metadata?.unknownAssetBalanceCount) +
    finiteCount(intent.metadata?.assetUniverseUnknownTargetCount);

  if (assetCoverage?.ok === false || assetCoverage?.status === "needs_review") {
    gaps.push({
      kind: "asset_coverage_status",
      status: assetCoverage.status || "needs_review",
    });
  }
  if (unknownCount > 0) {
    gaps.push({
      kind: "unknown_asset_count",
      unknownCount,
    });
  }
  return gaps;
}

export function evaluateAssetCoverageGuard({
  intent = {},
  riskContext = null,
  now = new Date().toISOString(),
} = {}) {
  const assetCoverage = resolveAssetCoverage({ intent, riskContext });
  const gaps = coverageGaps(assetCoverage, intent);
  const exitLike = isExitLikeIntent(intent);
  const openingOrIncreasing = isOpeningOrIncreasingIntent(intent);
  const missingCoverage = !assetCoverage && openingOrIncreasing && !exitLike;
  const hasGaps = gaps.length > 0 || missingCoverage;
  const blocksNewExposure = hasGaps && openingOrIncreasing && !exitLike;

  return {
    policy: "asset_coverage_guard",
    observedAt: now,
    decision: blocksNewExposure ? "BLOCK" : "ALLOW",
    blockers: blocksNewExposure
      ? [missingCoverage ? "asset_coverage_missing_for_new_exposure" : "asset_coverage_gap_blocks_new_exposure"]
      : [],
    warnings: hasGaps && exitLike ? ["asset_coverage_gap_exit_unwind_redeem_only"] : [],
    evidence: {
      status: assetCoverage?.status || null,
      gapCount: gaps.length,
      missingCoverage,
      exitLike,
      openingOrIncreasing,
      gaps: gaps.slice(0, 10),
    },
  };
}
