import { describe, it } from "node:test";
import assert from "node:assert";
import {
  reconcilePositions,
  isReconcileStale,
  PROTOCOL_READERS,
} from "../../../src/executor/health/position-reconciler.mjs";

describe("position-reconciler", () => {
  it("returns positions with protocol + wallet sources", async () => {
    const result = await reconcilePositions({
      signerAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      priceMap: { cbBTC: 76730, USDC: 1, WETH: 2300 },
      protocolConfigs: [
        {
          reader: "yoProtocol",
          chain: "base",
          params: {
            vaultAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
            assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          },
        },
      ],
    });

    assert.strictEqual(result.version, 1);
    assert.ok(Array.isArray(result.positions));
    assert.ok(typeof result.totalCapital === "number");
    assert.ok(result.timestamp);
    assert.strictEqual(result.stale, false);
  });

  it("flags stale reconcile correctly", () => {
    const fresh = { timestamp: new Date().toISOString() };
    assert.strictEqual(isReconcileStale(fresh, 60000), false);

    const old = { timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() };
    assert.strictEqual(isReconcileStale(old, 60000), true);

    assert.strictEqual(isReconcileStale(null), true);
    assert.strictEqual(isReconcileStale({}), true);
  });

  it("has registered protocol readers", () => {
    assert.ok(typeof PROTOCOL_READERS.moonwell === "function");
    assert.ok(typeof PROTOCOL_READERS.yoProtocol === "function");
  });
});
