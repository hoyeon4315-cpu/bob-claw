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
