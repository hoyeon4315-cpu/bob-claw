import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCapitalForensicsReport } from "../src/audit/capital-forensics.mjs";

test("capital forensics prefers latest full-rpc inventory for current NAV", () => {
  const report = buildCapitalForensicsReport({
    baselineUsd: 450,
    now: "2026-05-06T00:00:00.000Z",
    inventoryRecords: [
      {
        observedAt: "2026-05-05T00:00:00.000Z",
        totalUsd: 362,
        totals: { tokenUsd: 295, protocolUsd: 67, totalUsd: 362 },
        summary: { walletCoverage: "partial_supported", scanErrorCount: 5, unknownAssetBalanceCount: 0 },
        source: "live_scan",
      },
      {
        observedAt: "2026-05-05T00:01:00.000Z",
        totalUsd: 370,
        totals: { tokenUsd: 303, protocolUsd: 67, totalUsd: 370 },
        summary: { walletCoverage: "full_rpc", scanErrorCount: 0, unknownAssetBalanceCount: 0 },
        source: "live_scan",
      },
    ],
    receiptRecords: [],
  });

  assert.equal(report.current.observedAt, "2026-05-05T00:01:00.000Z");
  assert.equal(report.current.totalUsd, 370);
  assert.equal(report.current.walletCoverage, "full_rpc");
  assert.equal(report.baseline.deltaFromCurrentUsd, 80);
  assert.equal(report.confidence.currentNav, "verified_current");
});

test("capital forensics separates external portfolio peaks from local peaks", () => {
  const report = buildCapitalForensicsReport({
    now: "2026-05-06T00:00:00.000Z",
    inventoryRecords: [
      {
        observedAt: "2026-04-20T00:00:00.000Z",
        totalUsd: 390,
        totals: { totalUsd: 390 },
        summary: { walletCoverage: "partial_supported", scanErrorCount: 0 },
        source: "live_scan",
      },
      {
        observedAt: "2026-04-28T00:00:00.000Z",
        totalUsd: 700,
        totals: { totalUsd: 700 },
        summary: {
          walletCoverage: "full_external",
          scanErrorCount: 1,
          externalTotalPortfolioUsd: 700,
          externalUnclassifiedUsd: 525,
        },
        source: "live_scan_with_external_portfolio",
      },
    ],
    receiptRecords: [],
  });

  assert.equal(report.history.maxLocalInventory.totalUsd, 390);
  assert.equal(report.history.maxExternalReference.totalUsd, 700);
  assert.equal(report.history.externalReferenceWarning, "external_reference_not_current_nav");
});

test("capital forensics excludes protocol share double-count rows from clean local peak", () => {
  const report = buildCapitalForensicsReport({
    now: "2026-05-06T00:00:00.000Z",
    inventoryRecords: [
      {
        observedAt: "2026-05-05T00:00:00.000Z",
        totalUsd: 437,
        totals: { tokenUsd: 370, protocolUsd: 67, totalUsd: 437 },
        summary: { walletCoverage: "full_rpc", scanErrorCount: 0 },
        tokenBalances: [{
          ticker: "yoUSD",
          estimatedUsd: 67,
          trackingStatus: "protocol_reader_covered",
        }],
        protocolPositions: [{
          symbol: "yoUSD",
          estimatedUsd: 67,
        }],
      },
      {
        observedAt: "2026-05-05T00:01:00.000Z",
        totalUsd: 370,
        totals: { tokenUsd: 303, protocolUsd: 67, totalUsd: 370 },
        summary: { walletCoverage: "full_rpc", scanErrorCount: 0 },
        tokenBalances: [{
          ticker: "yoUSD",
          estimatedUsd: 67,
          trackingStatus: "protocol_reader_covered",
          countedInWalletTotal: false,
        }],
        protocolPositions: [{
          symbol: "yoUSD",
          estimatedUsd: 67,
        }],
      },
    ],
    receiptRecords: [],
  });

  assert.equal(report.history.maxLocalInventory.totalUsd, 370);
  assert.equal(report.history.excludedDoubleCountInventoryCount, 1);
});

test("capital forensics summarizes receipt costs without treating them as deposits", () => {
  const report = buildCapitalForensicsReport({
    now: "2026-05-06T00:00:00.000Z",
    inventoryRecords: [{
      observedAt: "2026-05-05T00:01:00.000Z",
      totalUsd: 370,
      totals: { tokenUsd: 303, protocolUsd: 67, totalUsd: 370 },
      summary: { walletCoverage: "full_rpc", scanErrorCount: 0, unknownAssetBalanceCount: 0 },
    }],
    receiptRecords: [
      {
        observedAt: "2026-05-01T00:00:00.000Z",
        kind: "token_dex_experiment",
        chain: "ethereum",
        reconciliationStatus: "reconciled",
        realized: { realizedNetPnlUsd: -10, receiptGasUsd: 4 },
      },
      {
        observedAt: "2026-05-01T00:01:00.000Z",
        kind: "erc4626_protocol_canary",
        chain: "base",
        reconciliationStatus: "reconciled",
        realized: { realizedNetPnlUsd: -2, receiptGasUsd: 2 },
      },
    ],
  });

  assert.equal(report.receipts.summary.realizedNetPnlUsd, -12);
  assert.equal(report.receipts.summary.totalReceiptGasUsd, 6);
  assert.equal(report.receipts.topKinds[0].kind, "token_dex_experiment");
  assert.equal(report.accountingCaveats.includes("receipt_ledger_is_cumulative_execution_cost_not_external_deposit_ledger"), true);
});
