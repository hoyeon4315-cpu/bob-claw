import assert from "node:assert/strict";
import test from "node:test";

import { buildWalletHoldingsPayload } from "../src/cli/report-wallet-holdings-slice.mjs";

function baseInventory(overrides = {}) {
  return {
    observedAt: "2026-05-08T00:00:00.000Z",
    address: "0xwallet",
    native: [],
    tokenBalances: [],
    protocolPositions: [],
    totals: { tokenUsd: 0, protocolUsd: 0, totalUsd: 0 },
    summary: { walletCoverage: "full_rpc", unknownAssetBalanceCount: 0 },
    ...overrides,
  };
}

test("wallet holdings normalizes price freshness metadata for every visible item family", () => {
  const payload = buildWalletHoldingsPayload({
    now: new Date("2026-05-08T00:01:00.000Z"),
    inventoryRecords: [baseInventory({
      native: [{
        chain: "base",
        ticker: "ETH",
        actualDecimal: 0.01,
        estimatedUsd: 35,
      }],
      tokenBalances: [
        {
          chain: "base",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ticker: "USDC",
          family: "stablecoin",
          actualDecimal: 12,
          estimatedUsd: 12,
          countedInWalletTotal: true,
        },
        {
          chain: "base",
          token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
          ticker: "cbBTC",
          family: "wrapped_btc",
          actualDecimal: 0.001,
          estimatedUsd: 100,
          countedInWalletTotal: true,
        },
        {
          chain: "ethereum",
          token: "0x153bd1ABE60104bD46AA05a27fA12D1346D64A57",
          ticker: "alphaForexV2",
          family: "other",
          actualDecimal: 1,
          estimatedUsd: 1,
          countedInWalletTotal: true,
          valuation: { kind: "erc4626_preview", underlyingSymbol: "RLUSD" },
        },
        {
          chain: "ethereum",
          token: "0xBEEF003C68896c7D2c3C60D363e8d71a49Ab2Bf9",
          ticker: "steakUSDT",
          family: "other",
          actualDecimal: 2,
          estimatedUsd: 2,
          countedInWalletTotal: true,
          valuation: { kind: "erc4626_preview", underlyingSymbol: "USDT" },
        },
      ],
      protocolPositions: [{
        chain: "base",
        symbol: "yoUSD",
        family: "protocol",
        actualDecimal: 20,
        estimatedUsd: 20,
        protocolId: "yo",
        positionId: "base:yo:wallet:vault",
        bindingKind: "erc4626_vault_supply_withdraw",
      }],
      totals: { tokenUsd: 150, protocolUsd: 20, totalUsd: 170 },
    })],
  });

  assert.equal(payload.items.length, 6);
  for (const item of payload.items) {
    assert.ok(item.priceSource);
    assert.equal(typeof item.priceSource.name, "string");
    assert.equal(typeof item.priceSource.type, "string");
    assert.equal(typeof item.priceSource.observedAt, "string");
    assert.equal(typeof item.priceSource.divergencePct, "number");
    assert.match(item.priceFreshness, /^(fresh|stale|missing)$/);
    assert.match(item.priceDivergenceStatus, /^(ok|warn|block)$/);
    assert.match(item.freshness, /^(fresh|stale)$/);
    assert.match(item.confidence, /^(verified_current|rpc_inferred|registry_only|low)$/);
    assert.ok(item.priceObservedAt);
  }

  const shareTokens = payload.items.filter((item) => ["alphaforexv2", "steakusdt"].includes(item.sym));
  assert.equal(shareTokens.length, 2);
  assert.equal(shareTokens.every((item) => item.priceSource.type === "erc4626_underlying_preview"), true);
});

test("wallet holdings keeps unregistered assets visible but excluded from totals", () => {
  const payload = buildWalletHoldingsPayload({
    now: new Date("2026-05-08T00:01:00.000Z"),
    inventoryRecords: [baseInventory({
      tokenBalances: [{
        chain: "base",
        token: "0x1234567890123456789012345678901234567890",
        ticker: "NEW",
        family: "other",
        actualDecimal: 1,
        estimatedUsd: 99,
        trackingStatus: "pending_whitelist_review",
        countedInWalletTotal: false,
      }],
      totals: { tokenUsd: 0, protocolUsd: 0, totalUsd: 0 },
      summary: { walletCoverage: "partial_supported", unknownAssetBalanceCount: 1 },
    })],
  });

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].trackingStatus, "unregistered");
  assert.equal(payload.items[0].countedInWalletTotal, false);
  assert.equal(payload.items[0].confidence, "low");
  assert.equal(payload.totalUsd, 0);
});

test("stale price/source timestamps are explicit instead of null", () => {
  const payload = buildWalletHoldingsPayload({
    now: new Date("2026-05-08T02:00:00.000Z"),
    inventoryRecords: [baseInventory({
      observedAt: "2026-05-08T00:00:00.000Z",
      native: [{
        chain: "ethereum",
        ticker: "ETH",
        actualDecimal: 0.01,
        estimatedUsd: 35,
      }],
      totals: { tokenUsd: 35, protocolUsd: 0, totalUsd: 35 },
    })],
  });

  assert.equal(payload.items[0].freshness, "stale");
  assert.equal(payload.items[0].priceFreshness, "stale");
  assert.equal(payload.staleItemCount, 1);
  assert.equal(payload.stalePriceItemCount, 1);
});
