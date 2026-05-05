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
