import assert from "node:assert/strict";
import { test } from "node:test";
import {
  materializeWholeWalletInventory,
  shouldUseStoredWholeWalletFallback,
} from "../src/cli/inventory-whole-wallet.mjs";

test("whole-wallet inventory falls back to stored treasury snapshot when live scan is empty with scan errors", () => {
  const liveInventory = {
    totalUsd: 0,
    native: [],
    tokenBalances: [],
    scanErrors: [{ chain: "base", message: "rpc error" }],
    summary: {
      nativeCount: 0,
      tokenCount: 0,
      scanErrorCount: 1,
    },
  };
  const treasurySnapshot = {
    observedAt: "2026-04-18T01:50:48.773Z",
    address: "0xabc",
    native: [
      { chain: "bob", asset: "ETH", token: "0x0", actual: "100", actualDecimal: 0.1, estimatedUsd: 12.5, rpcUrl: "https://rpc.gobob.xyz" },
    ],
    tokens: [
      { chain: "bob", ticker: "wBTC.OFT", token: "0x0555", actual: "200", actualDecimal: 0.000002, estimatedUsd: 0.15, rpcUrl: "https://rpc.gobob.xyz" },
    ],
    summary: {
      estimatedWalletUsd: 12.65,
    },
  };

  assert.equal(shouldUseStoredWholeWalletFallback(liveInventory, treasurySnapshot), true);
  const inventory = materializeWholeWalletInventory(liveInventory, treasurySnapshot);
  assert.equal(inventory.source, "stored_treasury_snapshot");
  assert.equal(inventory.totalUsd, 12.65);
  assert.equal(inventory.summary.nativeCount, 1);
  assert.equal(inventory.summary.tokenCount, 1);
  assert.equal(inventory.scanErrors.length, 1);
});

test("whole-wallet inventory keeps live scan when it already has value", () => {
  const liveInventory = {
    totalUsd: 5.5,
    native: [{ chain: "base", ticker: "ETH", actualDecimal: 0.001, estimatedUsd: 2.4 }],
    tokenBalances: [{ chain: "base", ticker: "wBTC.OFT", actualDecimal: 0.00004, estimatedUsd: 3.1 }],
    scanErrors: [{ chain: "soneium", message: "rpc error" }],
    summary: {
      nativeCount: 1,
      tokenCount: 1,
      scanErrorCount: 1,
    },
  };
  const treasurySnapshot = {
    summary: {
      estimatedWalletUsd: 12.65,
    },
  };

  assert.equal(shouldUseStoredWholeWalletFallback(liveInventory, treasurySnapshot), false);
  const inventory = materializeWholeWalletInventory(liveInventory, treasurySnapshot);
  assert.equal(inventory.source, "live_scan");
  assert.equal(inventory.totalUsd, 5.5);
  assert.equal(inventory.summary.nativeCount, 1);
  assert.equal(inventory.summary.tokenCount, 1);
});
