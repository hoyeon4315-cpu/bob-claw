import test from "node:test";
import assert from "node:assert/strict";
import { WBTC_OFT_TOKEN, tokenAsset } from "../src/assets/tokens.mjs";
import { priceForAssetUsd } from "../src/market/prices.mjs";
import {
  buildCurrentWholeWalletInventory,
  defaultAddressIsUnconfigured,
  resolveCapitalManagerPrices,
  resolveCapitalManagerTreasuryInventory,
} from "../src/cli/plan-capital-manager-refill-jobs.mjs";

test("capital manager inventory live refresh does not fall back to stored snapshot by default", async () => {
  const storedSnapshot = {
    address: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    native: [{ chain: "base", actual: "1" }],
    tokens: [],
    allowances: [],
  };

  await assert.rejects(
    () =>
      resolveCapitalManagerTreasuryInventory({
        refreshInventory: true,
        context: { inventorySnapshot: storedSnapshot },
        policy: {},
        address: storedSnapshot.address,
        prices: {},
        scanInventory: async () => {
          throw Object.assign(new Error("All RPC endpoints failed for chain: ethereum"), {
            name: "AccountStateRpcError",
          });
        },
      }),
    /All RPC endpoints failed/,
  );
});

test("capital manager inventory stored snapshot fallback requires explicit opt-in", async () => {
  const storedSnapshot = {
    address: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    native: [{ chain: "base", actual: "1" }],
    tokens: [],
    allowances: [],
  };

  const resolved = await resolveCapitalManagerTreasuryInventory({
    refreshInventory: true,
    allowStoredSnapshotFallback: true,
    context: { inventorySnapshot: storedSnapshot },
    policy: {},
    address: storedSnapshot.address,
    prices: {},
    scanInventory: async () => {
      throw Object.assign(new Error("All RPC endpoints failed for chain: ethereum"), { name: "AccountStateRpcError" });
    },
  });

  assert.equal(resolved.inventorySource, "stored_snapshot_fallback");
  assert.equal(resolved.treasuryInventory, storedSnapshot);
  assert.equal(resolved.inventoryRefreshError?.name, "AccountStateRpcError");
});

test("capital manager treats default verify recipient as unconfigured without explicit address", () => {
  assert.equal(
    defaultAddressIsUnconfigured(
      { address: "0x000000000000000000000000000000000000dEaD", source: "stored_inventory" },
      { address: null },
      { estimateFrom: null, verifyRecipient: "0x000000000000000000000000000000000000dEaD" },
    ),
    true,
  );
});

test("capital manager price resolver falls back to observed market snapshots for wrapped BTC", async () => {
  const prices = await resolveCapitalManagerPrices({
    dataDir: "/tmp/unused",
    livePriceReader: async () => {
      throw new Error("network unavailable");
    },
    readJsonlImpl: async (_dataDir, name) => {
      if (name === "market-price-snapshots") {
        return [
          {
            observedAt: "2026-05-09T21:00:00.000Z",
            btcUsd: 80_000,
            tokenByKey: { btc: 80_000, wbtc: 80_100, usd_stable: 1 },
            nativeByChain: {},
          },
        ];
      }
      return [];
    },
  });

  assert.equal(priceForAssetUsd(tokenAsset("base", WBTC_OFT_TOKEN), prices), 80_000);
});

test("capital manager current plan excludes stale dashboard wallet snapshots by default", () => {
  const treasuryInventory = {
    native: [
      {
        chain: "base",
        token: "0x0000000000000000000000000000000000000000",
        actual: "1",
        estimatedUsd: 1,
        source: "live_scan",
      },
    ],
    tokens: [
      {
        chain: "base",
        token: WBTC_OFT_TOKEN,
        actual: "10000",
        estimatedUsd: 8,
        source: "live_scan",
      },
    ],
  };
  const dashboardStatus = {
    capitalSummary: {
      walletItems: [{ chain: "base", family: "native", name: "ETH", amount: 1000, usd: 2_000_000 }],
    },
  };

  const wholeWallet = buildCurrentWholeWalletInventory({ treasuryInventory, dashboardStatus });

  assert.deepEqual(
    wholeWallet.native.map((item) => item.source),
    ["live_scan"],
  );
  assert.deepEqual(
    wholeWallet.tokenBalances.map((item) => item.source),
    ["live_scan"],
  );
  assert.equal(
    wholeWallet.native.some((item) => item.source === "dashboard_status_snapshot"),
    false,
  );
});

test("capital manager current plan can opt into dashboard snapshot fallback explicitly", () => {
  const treasuryInventory = { native: [], tokens: [] };
  const dashboardStatus = {
    capitalSummary: {
      walletItems: [{ chain: "base", family: "native", name: "ETH", amount: 1, usd: 2_000 }],
    },
  };

  const wholeWallet = buildCurrentWholeWalletInventory({
    treasuryInventory,
    dashboardStatus,
    allowDashboardSnapshotFallback: true,
  });

  assert.equal(wholeWallet.native.length, 1);
  assert.equal(wholeWallet.native[0].source, "dashboard_status_snapshot");
});
