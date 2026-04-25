import test from "node:test";
import assert from "node:assert/strict";
import { resolveCapitalManagerTreasuryInventory } from "../src/cli/plan-capital-manager-refill-jobs.mjs";

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
