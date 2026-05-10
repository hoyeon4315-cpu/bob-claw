import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTreasuryHoldingsSlice } from "../src/status/treasury-holdings-slice.mjs";

test("treasury holdings reconcile newer Merkl exit proof balances over stale snapshot items", () => {
  const holdings = buildTreasuryHoldingsSlice(
    [
      {
        observedAt: "2026-04-25T22:54:04.221Z",
        native: [],
        tokens: [
          {
            chain: "base",
            ticker: "USDC",
            actualDecimal: 0.224227,
            estimatedUsd: 0.224227,
            status: "refill_required",
          },
        ],
        summary: {
          estimatedWalletUsd: 0.224227,
          activeChainCount: 1,
          supportedChainCount: 11,
          nativeRefillRequiredCount: 0,
          tokenRefillRequiredCount: 1,
        },
      },
    ],
    {
      generatedAt: "2026-04-26T04:50:33.894Z",
      merklPositionEvents: [
        {
          event: "position_opened",
          opportunityId: "yo-base",
          chain: "base",
          assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          name: "Deposit USDC to YO",
          observedAt: "2026-04-24T06:16:49.813Z",
        },
        {
          event: "position_exit_confirmed",
          status: "closed",
          opportunityId: "yo-base",
          observedAt: "2026-04-26T04:39:10.322Z",
          redeemProof: {
            settledBalance: "15631221",
          },
        },
      ],
    },
  );

  const usdc = holdings.items.find((item) => item.chain === "base" && item.sym === "usdc");
  assert.ok(usdc, "expected reconciled base USDC item");
  assert.equal(usdc.status, "reconciled_exit_proof");
  assert.equal(usdc.amount, 15.631221);
  assert.equal(usdc.usd, 15.631221);
  assert.equal(holdings.totalUsd, 15.631221);
});

test("treasury holdings add reconciled exit-proof items missing from stale inventory snapshot", () => {
  const holdings = buildTreasuryHoldingsSlice(
    [
      {
        observedAt: "2026-04-25T22:54:04.221Z",
        native: [],
        tokens: [],
        summary: {
          estimatedWalletUsd: 0,
          activeChainCount: 0,
          supportedChainCount: 11,
          nativeRefillRequiredCount: 0,
          tokenRefillRequiredCount: 0,
        },
      },
    ],
    {
      generatedAt: "2026-04-26T04:50:33.894Z",
      merklPositionEvents: [
        {
          event: "position_opened",
          opportunityId: "aave-rlusd",
          chain: "ethereum",
          assetAddress: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
          name: "Lend RLUSD on Aave Horizon",
          observedAt: "2026-04-24T07:54:13.427Z",
        },
        {
          event: "position_exit_reconciled_zero_balance",
          status: "closed",
          opportunityId: "aave-rlusd",
          observedAt: "2026-04-26T03:48:34.051Z",
          redeemProof: {
            assetBalance: "50898904530668095790",
          },
        },
      ],
    },
  );

  const rlusd = holdings.items.find((item) => item.chain === "ethereum" && item.sym === "rlusd");
  assert.ok(rlusd, "expected reconciled Ethereum RLUSD item");
  assert.equal(rlusd.amount, 50.898904530668094);
  assert.equal(rlusd.usd, 50.898904530668094);
  assert.equal(holdings.totalUsd, 50.898904530668094);
});

test("treasury holdings prefer fresh whole-wallet inventory when address scan data is available", () => {
  const holdings = buildTreasuryHoldingsSlice(
    [
      {
        observedAt: "2026-04-26T06:40:00.000Z",
        native: [],
        tokens: [
          {
            chain: "base",
            ticker: "USDC",
            actualDecimal: 10,
            estimatedUsd: 10,
            status: "ready",
          },
        ],
        summary: {
          estimatedWalletUsd: 10,
          activeChainCount: 1,
          supportedChainCount: 11,
          nativeRefillRequiredCount: 0,
          tokenRefillRequiredCount: 0,
        },
      },
    ],
    {
      generatedAt: "2026-04-26T06:50:00.000Z",
      merklPositionEvents: [],
      wholeWalletRecords: [
        {
          observedAt: "2026-04-26T06:49:00.000Z",
          totalUsd: 25,
          native: [
            {
              chain: "base",
              ticker: "ETH",
              actualDecimal: 0.001,
              estimatedUsd: 2.2,
            },
          ],
          tokenBalances: [
            {
              chain: "base",
              ticker: "USDC",
              actualDecimal: 10,
              estimatedUsd: 10,
            },
            {
              chain: null,
              ticker: "OTHER",
              actualDecimal: 0,
              estimatedUsd: 12.8,
              family: "external_unclassified",
            },
          ],
          summary: {
            chainCount: 1,
            scanErrorCount: 2,
            externalWalletUsd: 25,
            externalUnclassifiedUsd: 12.8,
          },
          scanErrors: [
            { kind: "external_portfolio", provider: "zerion", message: "Zerion wallet portfolio request failed: 429" },
            { kind: "token", chain: "ethereum", token: "0x0555", message: "All RPC endpoints failed for chain: ethereum" },
          ],
        },
      ],
    },
  );

  assert.equal(holdings.source, "whole_wallet_inventory");
  assert.equal(holdings.scanErrorCount, 1);
  assert.deepEqual(holdings.scanErrors.map((error) => error.provider || error.chain), ["ethereum"]);
  assert.equal(holdings.totalUsd, 12.2);
  assert.equal(holdings.externalWalletUsd, 25);
  assert.equal(holdings.unclassifiedUsd, 12.8);
  assert.equal(holdings.items.some((item) => item.sym === "other"), false);
});

test("treasury holdings ignore cached Zerion full-wallet coverage for live totals", () => {
  const holdings = buildTreasuryHoldingsSlice(
    [],
    {
      generatedAt: "2026-04-26T07:05:00.000Z",
      wholeWalletRecords: [
        {
          observedAt: "2026-04-26T06:45:00.000Z",
          totalUsd: 250,
          native: [],
          tokenBalances: [
            {
              chain: "base",
              ticker: "USDC",
              actualDecimal: 220,
              estimatedUsd: 220,
            },
            {
              chain: null,
              ticker: "OTHER",
              actualDecimal: 0,
              estimatedUsd: 30,
              family: "external_unclassified",
            },
          ],
          summary: {
            itemizedWalletUsd: 220,
            chainCount: 1,
            scanErrorCount: 0,
            externalWalletUsd: 250,
            externalUnclassifiedUsd: 30,
            externalProvider: "zerion",
          },
          scanErrors: [],
        },
        {
          observedAt: "2026-04-26T07:04:00.000Z",
          totalUsd: 214,
          native: [],
          tokenBalances: [
            {
              chain: "base",
              ticker: "USDC",
              actualDecimal: 214,
              estimatedUsd: 214,
            },
          ],
          summary: {
            itemizedWalletUsd: 214,
            chainCount: 1,
            scanErrorCount: 1,
            externalWalletUsd: null,
            externalUnclassifiedUsd: null,
          },
          scanErrors: [
            { kind: "external_portfolio", provider: "zerion", message: "Zerion wallet portfolio request failed: 429" },
          ],
        },
      ],
    },
  );

  assert.equal(holdings.totalUsd, 214);
  assert.equal(holdings.itemizedSupportedWalletUsd, 214);
  assert.equal(holdings.scanErrorCount, 0);
  assert.equal(holdings.fullWalletUsd, null);
  assert.equal(holdings.fullWalletObservedAt, null);
  assert.equal(holdings.fullWalletProvider, null);
  assert.equal(holdings.fullWalletStale, false);
  assert.equal(holdings.walletCoverage, "partial_supported");
  assert.equal(holdings.externalWalletUsd, null);
  assert.equal(holdings.unclassifiedUsd, null);
  assert.equal(holdings.items.some((item) => item.sym === "other"), false);
});

test("treasury holdings preserves full_rpc coverage from closed tx-derived asset universe", () => {
  const holdings = buildTreasuryHoldingsSlice(
    [],
    {
      generatedAt: "2026-05-05T22:30:00.000Z",
      wholeWalletRecords: [
        {
          address: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
          observedAt: "2026-05-05T22:29:00.000Z",
          totalUsd: 100,
          native: [],
          tokenBalances: [
            {
              chain: "base",
              ticker: "USDC",
              actualDecimal: 100,
              estimatedUsd: 100,
            },
          ],
          summary: {
            itemizedWalletUsd: 100,
            chainCount: 1,
            scanErrorCount: 0,
            walletCoverage: "full_rpc",
            assetUniverseStatus: "closed",
            unknownAssetBalanceCount: 0,
          },
          assetUniverse: {
            status: "closed",
            targetCount: 3,
            unknownTargetCount: 0,
          },
          scanErrors: [],
        },
      ],
    },
  );

  assert.equal(holdings.walletCoverage, "full_rpc");
  assert.equal(holdings.address, "0x96262bE63AA687563789225c2fE898c27a3b0AE4");
  assert.equal(holdings.assetUniverse.status, "closed");
  assert.equal(holdings.unknownAssetBalanceCount, 0);
});

test("treasury holdings preserves freshness and price-source metadata for dashboard asset tracking", () => {
  const holdings = buildTreasuryHoldingsSlice(
    [],
    {
      generatedAt: "2026-05-08T13:46:00.000Z",
      wholeWalletRecords: [
        {
          observedAt: "2026-05-08T13:45:30.000Z",
          totalUsd: 100,
          native: [],
          tokenBalances: [
            {
              chain: "base",
              ticker: "USDC",
              actualDecimal: 100,
              estimatedUsd: 100,
              priceSource: {
                name: "chainlink:usd_stable",
                type: "chainlink_onchain_feed",
                observedAt: "2026-05-08T13:45:30.000Z",
                divergencePct: 0,
              },
              priceFreshness: "fresh",
              freshness: "fresh",
              confidence: "verified_current",
            },
          ],
          summary: {
            itemizedWalletUsd: 100,
            chainCount: 1,
            scanErrorCount: 0,
            walletCoverage: "full_rpc",
            assetUniverseStatus: "closed",
            unknownAssetBalanceCount: 0,
          },
          assetUniverse: {
            status: "closed",
            targetCount: 1,
            unknownTargetCount: 0,
          },
          scanErrors: [],
        },
      ],
    },
  );

  assert.equal(holdings.items.length, 1);
  assert.equal(holdings.items[0].freshness, "fresh");
  assert.equal(holdings.items[0].confidence, "verified_current");
  assert.equal(holdings.items[0].priceFreshness, "fresh");
  assert.equal(holdings.items[0].priceSource.name, "chainlink:usd_stable");
  assert.equal(holdings.items[0].priceDivergenceStatus, "ok");
});

test("treasury holdings surfaces tx-derived unknown asset balances for dashboard blockers", () => {
  const holdings = buildTreasuryHoldingsSlice(
    [],
    {
      generatedAt: "2026-05-05T22:30:00.000Z",
      wholeWalletRecords: [
        {
          observedAt: "2026-05-05T22:29:00.000Z",
          totalUsd: 0,
          native: [],
          tokenBalances: [
            {
              chain: "base",
              ticker: "NEW",
              actualDecimal: 1,
              estimatedUsd: null,
              trackingStatus: "pending_whitelist_review",
            },
          ],
          summary: {
            itemizedWalletUsd: 0,
            chainCount: 1,
            scanErrorCount: 0,
            walletCoverage: "partial_supported",
            assetUniverseStatus: "needs_review",
            unknownAssetBalanceCount: 1,
          },
          assetUniverse: {
            status: "needs_review",
            targetCount: 1,
            unknownTargetCount: 1,
          },
          unknownAssetBalances: [{ chain: "base", ticker: "NEW", actualDecimal: 1 }],
          scanErrors: [],
        },
      ],
    },
  );

  assert.equal(holdings.walletCoverage, "partial_supported");
  assert.equal(holdings.assetUniverse.unknownTargetCount, 1);
  assert.equal(holdings.unknownAssetBalanceCount, 1);
  assert.equal(holdings.unknownAssetBalances[0].ticker, "NEW");
});

test("treasury holdings excludes protocol-reader-covered share tokens from wallet totals", () => {
  const holdings = buildTreasuryHoldingsSlice(
    [],
    {
      generatedAt: "2026-05-05T22:30:00.000Z",
      wholeWalletRecords: [
        {
          observedAt: "2026-05-05T22:29:00.000Z",
          totalUsd: 50,
          native: [],
          tokenBalances: [
            {
              chain: "base",
              ticker: "yoUSD",
              actualDecimal: 50,
              estimatedUsd: 50,
              countedInWalletTotal: false,
              trackingStatus: "protocol_reader_covered",
            },
            {
              chain: "base",
              ticker: "USDC",
              actualDecimal: 10,
              estimatedUsd: 10,
            },
          ],
          summary: {
            itemizedWalletUsd: 10,
            chainCount: 1,
            scanErrorCount: 0,
            walletCoverage: "full_rpc",
          },
          scanErrors: [],
        },
      ],
    },
  );

  assert.equal(holdings.totalUsd, 10);
  assert.equal(holdings.items.some((item) => item.name === "yoUSD"), false);
  assert.equal(holdings.items.some((item) => item.name === "USDC"), true);
});

test("treasury holdings preserve injected protocol APR entries for dashboard consumers", () => {
  const protocolApr = {
    "wrapped-btc-loop-base-moonwell": {
      strategyId: "wrapped-btc-loop-base-moonwell",
      observedAt: "2026-04-27T04:05:38.735Z",
      supplyApyPct: 2.4,
      borrowApyPct: 1.3,
      netApyPct: 1.1,
    },
  };
  const holdings = buildTreasuryHoldingsSlice(
    [
      {
        observedAt: "2026-04-26T06:40:00.000Z",
        native: [],
        tokens: [],
        summary: {
          estimatedWalletUsd: 0,
          activeChainCount: 0,
          supportedChainCount: 11,
          nativeRefillRequiredCount: 0,
          tokenRefillRequiredCount: 0,
        },
      },
    ],
    {
      generatedAt: "2026-04-26T06:50:00.000Z",
      protocolApr,
    },
  );

  assert.deepEqual(holdings.protocolApr, protocolApr);
});
