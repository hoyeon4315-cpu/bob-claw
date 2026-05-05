const CURRENT_PROTOCOL_FRESHNESS = new Set(["fresh", "recent"]);
const PENDING_SIGNER_STAGES = new Set(["signed", "broadcasted"]);
const FINAL_SIGNER_STAGES = new Set(["confirmed", "reverted", "rejected", "error", "auto_ingest_error"]);
const ADAPTER_GAP_FAILURES = new Set(["no_reader_no_adapter", "missing_binding_kind"]);
const RECENT_SIGNER_WINDOW_MS = 15 * 60 * 1000;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function observedAtMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function roundUsd(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function roundedAbsDelta(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return roundUsd(Math.abs(left - right));
}

function signerLifecycleStage(record = {}) {
  return record?.lifecycle?.stage || null;
}

function signerTimestamp(record = {}) {
  return record?.timestamp || record?.observedAt || null;
}

function recentPendingSignerActions(records = [], generatedAt) {
  const generatedAtMs = observedAtMs(generatedAt);
  if (!Number.isFinite(generatedAtMs)) return [];
  return records.filter((record) => {
    const stage = signerLifecycleStage(record);
    if (!PENDING_SIGNER_STAGES.has(stage)) return false;
    const recordAtMs = observedAtMs(signerTimestamp(record));
    if (!Number.isFinite(recordAtMs)) return false;
    return generatedAtMs - recordAtMs <= RECENT_SIGNER_WINDOW_MS;
  });
}

function latestObservedAt(items = []) {
  const latest = items.reduce((best, item) => {
    const candidate = item?.observedAt || null;
    return observedAtMs(candidate) >= observedAtMs(best) ? candidate : best;
  }, null);
  return latest || null;
}

function pushViolation(invariantViolations, {
  code,
  severity,
  message,
  count = null,
  amountUsd = null,
  blocksAutomation = true,
  details = null,
}) {
  invariantViolations.push({
    code,
    severity,
    message,
    count: Number.isFinite(count) ? count : null,
    amountUsd: Number.isFinite(amountUsd) ? roundUsd(amountUsd) : null,
    blocksAutomation,
    details: details && typeof details === "object" ? details : null,
  });
}

export function buildReconciliationSummary({
  capitalSummary = null,
  protocolPositionMarks = null,
  merklActivePositions = null,
  signerAuditRecords = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const markItems = Array.isArray(protocolPositionMarks?.items) ? protocolPositionMarks.items : [];
  const positionItems = Array.isArray(merklActivePositions?.items) ? merklActivePositions.items : [];
  const pendingSignerActions = recentPendingSignerActions(signerAuditRecords, generatedAt);
  const adapterCoverageGapCount = markItems.filter((item) => ADAPTER_GAP_FAILURES.has(item?.failureKind)).length;
  const currentMarkItemsCount = markItems.filter((item) =>
    item?.event === "position_marked" &&
    CURRENT_PROTOCOL_FRESHNESS.has(item?.freshness) &&
    (item?.confidence === "verified_current" || item?.confidence === "verified_minimum")
  ).length;
  const currentPositionMarkCount = positionItems.filter((item) =>
    item?.markSource === "protocol_position_mark" &&
    CURRENT_PROTOCOL_FRESHNESS.has(item?.markFreshness) &&
    (item?.markConfidence === "verified_current" || item?.markConfidence === "verified_minimum")
  ).length;
  const currentProtocolMarkCount = Math.max(currentMarkItemsCount, currentPositionMarkCount);
  const protocolMarkIssueCount =
    Number(protocolPositionMarks?.failedPositionCount || 0) +
    Number(protocolPositionMarks?.stalePositionCount || 0) +
    Number(protocolPositionMarks?.expiredPositionCount || 0);
  const latestProtocolMarkObservedAt = latestObservedAt(markItems);
  const reconciliationGapUsd = [
    finiteNumber(capitalSummary?.referenceFullWalletGapUsd),
    finiteNumber(capitalSummary?.protocolTrackingGapUsd),
    finiteNumber(capitalSummary?.trackingGapUsd),
  ]
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((max, value) => Math.max(max, value), 0) || null;

  const invariantViolations = [];
  const formulaDeltaUsd = roundedAbsDelta(
    finiteNumber(capitalSummary?.currentTotalUsd),
    (finiteNumber(capitalSummary?.currentWalletUsd) ?? 0) + (finiteNumber(capitalSummary?.protocolDeployedUsd) ?? 0),
  );
  if (Number.isFinite(formulaDeltaUsd) && formulaDeltaUsd > 0.01) {
    pushViolation(invariantViolations, {
      code: "current_total_formula_mismatch",
      severity: "high",
      message: "Current total assets do not match wallet plus protocol deployed assets.",
      amountUsd: formulaDeltaUsd,
      details: {
        currentWalletUsd: finiteNumber(capitalSummary?.currentWalletUsd),
        protocolDeployedUsd: finiteNumber(capitalSummary?.protocolDeployedUsd),
        currentTotalUsd: finiteNumber(capitalSummary?.currentTotalUsd),
      },
    });
  }
  if (Number(capitalSummary?.walletScanErrorCount || 0) > 0) {
    pushViolation(invariantViolations, {
      code: "wallet_scan_errors",
      severity: "medium",
      message: "Wallet scan reported authoritative errors.",
      count: Number(capitalSummary?.walletScanErrorCount || 0),
      details: { walletSource: capitalSummary?.walletSource || null },
    });
  }
  if (capitalSummary?.walletCoverage && capitalSummary.walletCoverage !== "full_rpc") {
    pushViolation(invariantViolations, {
      code: "wallet_coverage_partial",
      severity: "medium",
      message: "Wallet scan has not proven complete token coverage for the address.",
      details: {
        walletCoverage: capitalSummary.walletCoverage,
        walletSource: capitalSummary.walletSource || null,
        walletObservedAt: capitalSummary.walletObservedAt || null,
      },
    });
  }
  if (Number(capitalSummary?.unmarkedProtocolPositionCount || 0) > 0) {
    pushViolation(invariantViolations, {
      code: "unmarked_protocol_positions",
      severity: "medium",
      message: "Some open protocol positions are not backed by current protocol marks.",
      count: Number(capitalSummary?.unmarkedProtocolPositionCount || 0),
    });
  }
  if (Number(capitalSummary?.protocolMarkFailedCount || 0) > 0) {
    pushViolation(invariantViolations, {
      code: "protocol_mark_failures",
      severity: "high",
      message: "One or more protocol position marks failed.",
      count: Number(capitalSummary?.protocolMarkFailedCount || 0),
      details: {
        failureKinds: [...new Set(markItems.map((item) => item?.failureKind).filter(Boolean))],
      },
    });
  }
  if (Number(capitalSummary?.protocolMarkStaleCount || 0) > 0 || Number(capitalSummary?.protocolMarkExpiredCount || 0) > 0) {
    pushViolation(invariantViolations, {
      code: "protocol_marks_not_current",
      severity: "medium",
      message: "Some protocol position marks are stale or expired.",
      count: Number(capitalSummary?.protocolMarkStaleCount || 0) + Number(capitalSummary?.protocolMarkExpiredCount || 0),
      details: {
        staleCount: Number(capitalSummary?.protocolMarkStaleCount || 0),
        expiredCount: Number(capitalSummary?.protocolMarkExpiredCount || 0),
      },
    });
  }
  if (Number.isFinite(reconciliationGapUsd) && reconciliationGapUsd > 1) {
    pushViolation(invariantViolations, {
      code: "reconciliation_gap",
      severity: "medium",
      message: "External or derived references disagree with tracked assets.",
      amountUsd: reconciliationGapUsd,
      details: {
        referenceFullWalletGapUsd: finiteNumber(capitalSummary?.referenceFullWalletGapUsd),
        protocolTrackingGapUsd: finiteNumber(capitalSummary?.protocolTrackingGapUsd),
      },
    });
  }
  if (capitalSummary?.accountingWarning) {
    pushViolation(invariantViolations, {
      code: "accounting_warning",
      severity: "high",
      message: "Automation plan estimate materially differs from tracked assets.",
      details: { warning: capitalSummary.accountingWarning },
    });
  }
  if (adapterCoverageGapCount > 0) {
    pushViolation(invariantViolations, {
      code: "adapter_coverage_gap",
      severity: "medium",
      message: "Tracked protocol positions still need reader or adapter coverage.",
      count: adapterCoverageGapCount,
      details: {
        failureKinds: [...new Set(markItems
          .filter((item) => ADAPTER_GAP_FAILURES.has(item?.failureKind))
          .map((item) => item.failureKind))],
      },
    });
  }
  if (pendingSignerActions.length > 0) {
    pushViolation(invariantViolations, {
      code: "pending_signer_activity",
      severity: "low",
      message: "Recent signer activity may still settle balances or positions.",
      count: pendingSignerActions.length,
      blocksAutomation: false,
      details: {
        stages: [...new Set(pendingSignerActions.map((record) => signerLifecycleStage(record)).filter(Boolean))],
      },
    });
  }

  const highSeverityCount = invariantViolations.filter((item) => item.severity === "high").length;
  const mediumSeverityCount = invariantViolations.filter((item) => item.severity === "medium").length;
  const lowSeverityCount = invariantViolations.filter((item) => item.severity === "low").length;
  const systemConfidence =
    highSeverityCount > 0
      ? "low"
      : mediumSeverityCount > 0 || lowSeverityCount > 0
        ? "medium"
        : "high";
  const protocolMarkCoverageState =
    positionItems.length === 0
      ? "not_applicable"
      : adapterCoverageGapCount > 0
        ? "needs_adapter"
        : protocolMarkIssueCount > 0 || Number(capitalSummary?.unmarkedProtocolPositionCount || 0) > 0
          ? "degraded"
          : currentProtocolMarkCount > 0
            ? "covered"
            : "missing";
  const autoExecutionSafe =
    systemConfidence === "high" &&
    pendingSignerActions.length === 0 &&
    protocolMarkCoverageState === "covered" &&
    capitalSummary?.assetConfidence === "verified_current";
  const finalSignerActionCount = signerAuditRecords.filter((record) => FINAL_SIGNER_STAGES.has(signerLifecycleStage(record))).length;

  return {
    systemConfidence,
    autoExecutionSafe,
    reconciliationGapUsd,
    invariantViolations,
    invariantViolationCount: invariantViolations.length,
    pendingSignerActionCount: pendingSignerActions.length,
    finalSignerActionCount,
    currentProtocolMarkCount,
    protocolMarkIssueCount,
    adapterCoverageGapCount,
    protocolMarkCoverageState,
    latestProtocolMarkObservedAt,
  };
}
