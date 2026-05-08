import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildItems,
  buildWalletHoldingsPayload,
} from "../src/cli/report-wallet-holdings-slice.mjs";

test("wallet holdings payload preserves full-rpc coverage from authoritative scan", () => {
  const payload = buildWalletHoldingsPayload({
    now: new Date("2026-05-06T00:00:00.000Z"),
    inventoryRecords: [{
      observedAt: "2026-05-05T22:51:13.709Z",
      address: "0xwallet",
      native: [],
      tokenBalances: [{
        chain: "ethereum",
        ticker: "RLUSD",
        actualDecimal: 36.8,
        estimatedUsd: 36.8,
        countedInWalletTotal: true,
      }],
      protocolPositions: [{
        chain: "base",
        symbol: "yoUSD",
        actualDecimal: 66.7,
        estimatedUsd: 66.7,
        protocolId: "yo",
        positionId: "base:yo:wallet:vault",
        bindingKind: "erc4626_vault_supply_withdraw",
        confidence: "verified_current",
        freshness: "fresh",
      }],
      scanErrors: [],
      totals: {
        tokenUsd: 36.8,
        protocolUsd: 66.7,
        protocolStaleUsd: 0,
        totalUsd: 103.5,
      },
      summary: {
        itemizedWalletUsd: 103.5,
        walletCoverage: "full_rpc",
        unknownAssetBalanceCount: 0,
      },
      assetUniverse: {
        status: "needs_review",
        targetCount: 4,
        unknownTargetCount: 1,
      },
      unknownAssetBalances: [],
    }],
  });

  assert.equal(payload.walletCoverage, "full_rpc");
  assert.equal(payload.totalUsd, 103.5);
  assert.equal(payload.walletUsd, 36.8);
  assert.equal(payload.protocolUsd, 66.7);
  assert.equal(payload.unknownAssetBalanceCount, 0);
  assert.equal(payload.assetUniverse.unknownTargetCount, 1);
  assert.equal(payload.items.length, 2);
  assert.ok(payload.items.find((item) => item.family === "protocol" && item.protocolId === "yo"));
  assert.equal(payload.items[0].source, "whole_wallet_inventory");
  assert.equal(payload.items[0].sourceObservedAt, "2026-05-05T22:51:13.709Z");
  assert.equal(payload.totals.freeWalletUsd, 36.8);
  assert.equal(payload.totals.protocolUsd, 66.7);
  assert.equal(payload.totals.reconciledTotalUsd, 103.5);
  assert.equal(payload.oldestMaterialSourceObservedAt, "2026-05-05T22:51:13.709Z");
});

test("wallet holdings items do not double count protocol-reader-covered share tokens", () => {
  const items = buildItems({
    native: [],
    tokenBalances: [{
      chain: "base",
      ticker: "yoUSD",
      actualDecimal: 63.7,
      estimatedUsd: 66.7,
      countedInWalletTotal: false,
      trackingStatus: "protocol_reader_covered",
    }],
    protocolPositions: [{
      chain: "base",
      symbol: "yoUSD",
      actualDecimal: 66.7,
      estimatedUsd: 66.7,
      protocolId: "yo",
      positionId: "base:yo:wallet:vault",
      bindingKind: "erc4626_vault_supply_withdraw",
    }],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].family, "protocol");
  assert.equal(items[0].usd, 66.7);
});

test("wallet holdings payload counts prevented protocol-share-token double counts", () => {
  const payload = buildWalletHoldingsPayload({
    now: new Date("2026-05-06T00:00:00.000Z"),
    inventoryRecords: [{
      observedAt: "2026-05-05T22:51:13.709Z",
      native: [],
      tokenBalances: [{
        chain: "base",
        ticker: "yoUSD",
        actualDecimal: 63.7,
        estimatedUsd: 66.7,
        countedInWalletTotal: false,
        trackingStatus: "protocol_reader_covered",
      }],
      protocolPositions: [{
        chain: "base",
        symbol: "yoUSD",
        actualDecimal: 66.7,
        estimatedUsd: 66.7,
        protocolId: "yo",
        positionId: "base:yo:wallet:vault",
        bindingKind: "erc4626_vault_supply_withdraw",
        freshness: "stale",
      }],
      totals: {
        tokenUsd: 0,
        protocolUsd: 66.7,
        protocolStaleUsd: 66.7,
        totalUsd: 66.7,
      },
      summary: { walletCoverage: "full_rpc" },
    }],
  });

  assert.equal(payload.doubleCountPreventedCount, 1);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].freshness, "stale");
  assert.equal(payload.staleItemCount, 1);
  assert.equal(payload.totals.staleProtocolUsd, 66.7);
});
