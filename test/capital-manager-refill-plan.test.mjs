import test from "node:test";
import assert from "node:assert/strict";
import { WBTC_OFT_TOKEN, tokenAsset } from "../src/assets/tokens.mjs";
import { priceForAssetUsd } from "../src/market/prices.mjs";
import {
  resolveCapitalManagerPrices,
  resolveCapitalManagerTreasuryInventory,
} from "../src/cli/plan-capital-manager-refill-jobs.mjs";

test("capital manager inventory refresh falls back to stored snapshot on scan failure", async () => {
  const storedSnapshot = {
    address: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    native: [{ chain: "base", actual: "1" }],
    tokens: [],
    allowances: [],
  };

  const resolved = await resolveCapitalManagerTreasuryInventory({
    refreshInventory: true,
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
