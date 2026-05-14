import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PRIMARY_OPERATOR_BTC_ADDRESS } from "../src/config/operator-btc-addresses.mjs";
import {
  materializeWholeWalletInventory,
  resolveBitcoinAddress,
  resolveInventoryPrices,
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
      {
        chain: "bob",
        asset: "ETH",
        token: "0x0",
        actual: "100",
        actualDecimal: 0.1,
        estimatedUsd: 12.5,
        rpcUrl: "https://rpc.gobob.xyz",
      },
    ],
    tokens: [
      {
        chain: "bob",
        ticker: "wBTC.OFT",
        token: "0x0555",
        actual: "200",
        actualDecimal: 0.000002,
        estimatedUsd: 0.15,
        rpcUrl: "https://rpc.gobob.xyz",
      },
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
    source: "live_scan_with_external_portfolio",
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
  assert.equal(inventory.source, "live_scan_with_external_portfolio");
  assert.equal(inventory.totalUsd, 5.5);
  assert.equal(inventory.summary.nativeCount, 1);
  assert.equal(inventory.summary.tokenCount, 1);
});

test("whole-wallet inventory uses signer BTC address when signer health is available", async () => {
  const signerAddress = "bc1psigneraddress000000000000000000000000000000000000000000000000";
  const address = await resolveBitcoinAddress({
    signerHealthReader: async () => ({ addresses: { bitcoin: signerAddress } }),
    fallbackAddress: PRIMARY_OPERATOR_BTC_ADDRESS,
  });

  assert.equal(address, signerAddress);
});

test("whole-wallet inventory falls back to approved operator BTC address when signer health is unavailable", async () => {
  const address = await resolveBitcoinAddress({
    signerHealthReader: async () => {
      throw new Error("signer health unavailable");
    },
    fallbackAddress: PRIMARY_OPERATOR_BTC_ADDRESS,
  });

  assert.equal(address, PRIMARY_OPERATOR_BTC_ADDRESS);
});

test("inventory price resolver fills missing live prices from latest local snapshot", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-inventory-prices-"));
  await writeFile(
    join(dataDir, "price-snapshot.json"),
    JSON.stringify({
      schemaVersion: 1,
      observedAt: "2026-05-06T08:00:00.000Z",
      btcUsd: 81000,
      tokenByKey: {
        btc: 81000,
        wbtc: 80950,
        ethereum: 2300,
        usd_stable: 1,
      },
      nativeByChain: {
        base: 2300,
        ethereum: 2300,
      },
    }),
  );

  const prices = await resolveInventoryPrices({
    dataDir,
    livePriceReader: async () => ({
      btc: null,
      tokenByKey: {
        btc: null,
        wbtc: null,
        ethereum: 2400,
        usd_stable: 1,
      },
      nativeByChain: {
        base: null,
        ethereum: 2400,
      },
    }),
  });

  assert.equal(prices.btc, 81000);
  assert.equal(prices.tokenByKey.wbtc, 80950);
  assert.equal(prices.tokenByKey.ethereum, 2400);
  assert.equal(prices.nativeByChain.base, 2300);
  assert.equal(prices.nativeByChain.ethereum, 2400);
});
