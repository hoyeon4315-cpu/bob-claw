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

test("asset tracking blocks risk readiness for tx-derived unknown asset universe gaps", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 200,
      protocolDeployedUsd: 0,
      currentTotalUsd: 200,
      walletCoverage: "full_rpc",
      walletScanErrorCount: 0,
      protocolMarkIssueCount: 0,
      pendingSignerActionCount: 0,
      assetUniverseUnknownTargetCount: 1,
      unknownAssetBalanceCount: 1,
      assetUniverse: {
        unknownTargets: [{ chain: "base", token: "0x1234567890123456789012345678901234567890" }],
      },
      unknownAssetBalances: [{ chain: "base", token: "0x1234567890123456789012345678901234567890" }],
    },
  });

  assert.equal(slice.riskReady, false);
  assert.equal(slice.exactTotalUsd, null);
  assert.equal(slice.blockers.some((item) => item.code === "unknown_asset_universe_gap"), true);
});

test("asset tracking verdict uses oldest material source freshness, not generatedAt alone", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 200,
      protocolDeployedUsd: 50,
      currentTotalUsd: 250,
      walletCoverage: "full_rpc",
      walletScanErrorCount: 0,
      protocolMarkIssueCount: 0,
      pendingSignerActionCount: 0,
      walletItems: [
        {
          sym: "usdc",
          usd: 200,
          family: "token",
          sourceObservedAt: "2026-05-05T22:00:00.000Z",
          priceObservedAt: "2026-05-05T22:00:00.000Z",
          priceSource: { name: "chainlink:usd_stable" },
          freshness: "fresh",
          priceFreshness: "fresh",
        },
      ],
      positionItems: [
        {
          sym: "yousd",
          usd: 50,
          family: "protocol",
          sourceObservedAt: "2026-05-05T20:00:00.000Z",
          priceObservedAt: "2026-05-05T20:00:00.000Z",
          priceSource: { name: "chainlink:usd_stable" },
          freshness: "stale",
          priceFreshness: "stale",
        },
      ],
    },
    generatedAt: "2026-05-05T22:01:00.000Z",
  });

  assert.equal(slice.oldestMaterialSourceObservedAt, "2026-05-05T20:00:00.000Z");
  assert.equal(slice.staleItemCount, 1);
  assert.equal(slice.stalePriceItemCount, 1);
  assert.equal(slice.verdict, "yellow");
  assert.equal(slice.blockers.some((item) => item.code === "stale_material_asset_source"), true);
});

test("asset tracking exposes freshness, price source, and divergence coverage over all items", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 210,
      protocolDeployedUsd: 0,
      currentTotalUsd: 210,
      walletCoverage: "full_rpc",
      walletScanErrorCount: 0,
      protocolMarkIssueCount: 0,
      pendingSignerActionCount: 0,
      walletItems: [
        {
          sym: "eth",
          usd: 100,
          freshness: "fresh",
          priceFreshness: "fresh",
          priceSource: { name: "chainlink" },
          priceDivergenceStatus: "ok",
          sourceObservedAt: "2026-05-08T00:00:00.000Z",
        },
        {
          sym: "usdc",
          usd: 100,
          freshness: "fresh",
          priceFreshness: "fresh",
          priceSource: { name: "chainlink" },
          priceDivergenceStatus: "warn",
          sourceObservedAt: "2026-05-08T00:00:00.000Z",
        },
        {
          sym: "unknown",
          usd: 10,
          freshness: "fresh",
          priceFreshness: "missing",
          priceSource: null,
          priceDivergenceStatus: "block",
          sourceObservedAt: "2026-05-08T00:00:00.000Z",
        },
      ],
    },
    generatedAt: "2026-05-08T00:01:00.000Z",
  });

  assert.equal(slice.totalAssetCount, 3);
  assert.equal(slice.freshnessCoveragePct, 1);
  assert.equal(slice.priceSourceCoveragePct, 2 / 3);
  assert.equal(slice.divergenceWarnCount, 1);
  assert.equal(slice.divergenceBlockCount, 1);
  assert.equal(slice.missingPriceSourceCount, 1);
});

test("asset tracking cannot be green when tracked asset metadata coverage is incomplete", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 100,
      protocolDeployedUsd: 0,
      currentTotalUsd: 100,
      walletCoverage: "full_rpc",
      walletScanErrorCount: 0,
      protocolMarkIssueCount: 0,
      pendingSignerActionCount: 0,
      walletItems: [
        {
          sym: "usdc",
          usd: 100,
        },
      ],
    },
    generatedAt: "2026-05-08T00:01:00.000Z",
  });

  assert.equal(slice.verdict, "red");
  assert.equal(slice.riskReady, false);
  assert.equal(slice.missingFreshnessMetadataCount, 1);
  assert.equal(slice.missingPriceSourceCount, 1);
  assert.equal(slice.blockers.some((item) => item.code === "asset_metadata_coverage_gap"), true);
});

test("asset tracking exposes pending whitelist queue separately from live unknown balances", () => {
  const slice = buildAssetTrackingSlice({
    capitalSummary: {
      currentWalletUsd: 100,
      protocolDeployedUsd: 0,
      currentTotalUsd: 100,
      walletCoverage: "full_rpc",
      walletScanErrorCount: 0,
      protocolMarkIssueCount: 0,
      pendingSignerActionCount: 0,
      unknownAssetBalanceCount: 0,
    },
    pendingWhitelistRecords: [
      { chain: "base", token: "0x1111111111111111111111111111111111111111", reason: "manual_review" },
      { chain: "ethereum", token: "0x2222222222222222222222222222222222222222", reason: "reward_token_audit" },
    ],
    generatedAt: "2026-05-08T00:01:00.000Z",
  });

  assert.equal(slice.unknownAssetBalanceCount, 0);
  assert.equal(slice.pendingWhitelistCount, 2);
  assert.deepEqual(slice.pendingWhitelistSample, [
    { chain: "base", token: "0x1111111111111111111111111111111111111111", reason: "manual_review" },
    { chain: "ethereum", token: "0x2222222222222222222222222222222222222222", reason: "reward_token_audit" },
  ]);
  assert.equal(slice.blockers.some((item) => item.code === "unknown_asset_universe_gap"), false);
});
