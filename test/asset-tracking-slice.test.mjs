import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAssetTrackingSlice } from "../src/status/asset-tracking-slice.mjs";

test("asset tracking treats partial wallet coverage as verified known value, not exact total", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 244.08,
      protocolDeployedUsd: 66.73,
      currentTotalUsd: 310.81,
      walletCoverage: "partial_supported",
      walletSource: "whole_wallet_inventory",
      walletObservedAt: "2026-05-05T22:00:00.000Z",
      walletScanErrorCount: 0,
      walletItemCount: 39,
      activePositionCount: 1,
      protocolMarkIssueCount: 0,
      pendingSignerActionCount: 0,
      referenceFullWalletGapUsd: null,
      unclassifiedUsd: null,
    },
    generatedAt: "2026-05-05T22:01:00.000Z",
  });

  assert.equal(slice.coverageState, "verified_known_assets_only");
  assert.equal(slice.exactTotalUsd, null);
  assert.equal(slice.verifiedKnownUsd, 310.81);
  assert.equal(slice.riskReady, false);
  assert.equal(slice.riskUsableUsd, 0);
  assert.equal(slice.blockers.some((item) => item.code === "wallet_coverage_partial"), true);
  assert.equal(slice.dashboardHeadline, "Verified known assets only");
});

test("asset tracking never promotes external unclassified reference value to exact capital", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 290.57,
      protocolDeployedUsd: 0,
      currentTotalUsd: 290.57,
      walletCoverage: "full_external",
      fullWalletUsd: 462.51,
      externalWalletUsd: 462.51,
      unclassifiedUsd: 171.94,
      fullWalletProvider: "zerion",
      referenceFullWalletGapUsd: 171.94,
      walletScanErrorCount: 0,
      protocolMarkIssueCount: 0,
      pendingSignerActionCount: 0,
    },
    generatedAt: "2026-05-05T22:01:00.000Z",
  });

  assert.equal(slice.coverageState, "reconciliation_gap");
  assert.equal(slice.exactTotalUsd, null);
  assert.equal(slice.verifiedKnownUsd, 290.57);
  assert.equal(slice.externalReferenceUsd, 462.51);
  assert.equal(slice.externalUnclassifiedUsd, 171.94);
  assert.equal(slice.unexplainedGapUsd, 171.94);
  assert.equal(slice.riskReady, false);
  assert.equal(slice.blockers.some((item) => item.code === "external_unclassified_reference"), true);
});

test("asset tracking marks exact total risk-ready only when all coverage inputs are authoritative", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 200,
      protocolDeployedUsd: 50,
      currentTotalUsd: 250,
      walletCoverage: "full_rpc",
      walletSource: "whole_wallet_inventory",
      walletObservedAt: "2026-05-05T22:00:00.000Z",
      walletScanErrorCount: 0,
      protocolMarkIssueCount: 0,
      unmarkedProtocolPositionCount: 0,
      protocolMarkFailedCount: 0,
      protocolMarkStaleCount: 0,
      protocolMarkExpiredCount: 0,
      pendingSignerActionCount: 0,
      referenceFullWalletGapUsd: null,
      unclassifiedUsd: null,
    },
    generatedAt: "2026-05-05T22:01:00.000Z",
  });

  assert.equal(slice.coverageState, "risk_ready");
  assert.equal(slice.exactTotalUsd, 250);
  assert.equal(slice.verifiedKnownUsd, 250);
  assert.equal(slice.riskReady, true);
  assert.equal(slice.riskUsableUsd, 250);
  assert.deepEqual(slice.blockers, []);
  assert.equal(slice.dashboardHeadline, "Exact tracked assets");
});

test("asset tracking blocks risk readiness for protocol mark or signer gaps", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 200,
      protocolDeployedUsd: 50,
      currentTotalUsd: 250,
      walletCoverage: "full_rpc",
      walletScanErrorCount: 0,
      protocolMarkIssueCount: 1,
      unmarkedProtocolPositionCount: 1,
      pendingSignerActionCount: 2,
    },
    generatedAt: "2026-05-05T22:01:00.000Z",
  });

  assert.equal(slice.coverageState, "protocol_or_movement_gap");
  assert.equal(slice.exactTotalUsd, null);
  assert.equal(slice.riskReady, false);
  assert.equal(slice.blockers.some((item) => item.code === "protocol_position_gap"), true);
  assert.equal(slice.blockers.some((item) => item.code === "movement_in_flight"), true);
});
