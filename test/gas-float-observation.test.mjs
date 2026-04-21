import assert from "node:assert/strict";
import { test } from "node:test";

import { buildObservedGasFloats } from "../src/executor/bootstrap/gas-float-observation.mjs";

test("buildObservedGasFloats prefers treasury inventory actual balance and gas snapshot pricing", () => {
  const result = buildObservedGasFloats({
    strategyCaps: {
      gasFloat: {
        base: { minUsd: 3, targetUsd: 6 },
      },
    },
    gasSnapshots: [
      {
        observedAt: "2026-04-22T00:00:00Z",
        chain: "base",
        nativeUsd: 3000,
      },
    ],
    walletReadiness: [
      {
        observedAt: "2026-04-22T00:00:00Z",
        address: "0xabc",
        srcChain: "base",
        native: { balanceWei: "1000000000000000" },
      },
    ],
    treasuryInventory: [
      {
        observedAt: "2026-04-22T01:00:00Z",
        address: "0xabc",
        native: [
          {
            chain: "base",
            actual: "4000000000000000",
            priceUsd: 3100,
            targetBalance: "999",
          },
        ],
      },
    ],
  });

  assert.equal(result.operatorAddress, "0xabc");
  assert.deepEqual(result.gasFloats.base, {
    actualWei: "4000000000000000",
    targetWei: "2000000000000000",
  });
  assert.equal(result.summary.observedChainCount, 1);
  assert.equal(result.summary.chains[0].actualSource, "treasury_inventory");
  assert.equal(result.summary.chains[0].targetSource, "strategy_caps_usd");
});

test("buildObservedGasFloats falls back to wallet readiness when treasury inventory is absent", () => {
  const result = buildObservedGasFloats({
    strategyCaps: {
      gasFloat: {
        bob: { minUsd: 3, targetUsd: 6 },
      },
    },
    gasSnapshots: [
      {
        observedAt: "2026-04-22T00:00:00Z",
        chain: "bob",
        nativeUsd: 2000,
      },
    ],
    walletReadiness: [
      {
        observedAt: "2026-04-22T02:00:00Z",
        address: "0xdef",
        srcChain: "bob",
        native: { balanceWei: "12345" },
      },
    ],
    treasuryInventory: [],
  });

  assert.equal(result.operatorAddress, "0xdef");
  assert.deepEqual(result.gasFloats.bob, {
    actualWei: "12345",
    targetWei: "3000000000000000",
  });
  assert.equal(result.summary.chains[0].actualSource, "wallet_readiness");
});

test("buildObservedGasFloats records unresolved chains instead of fabricating balances", () => {
  const result = buildObservedGasFloats({
    strategyCaps: {
      gasFloat: {
        bera: { minUsd: 3, targetUsd: 6 },
      },
    },
    gasSnapshots: [],
    walletReadiness: [],
    treasuryInventory: [],
  });

  assert.deepEqual(result.gasFloats, {});
  assert.equal(result.summary.configuredChainCount, 1);
  assert.equal(result.summary.observedChainCount, 0);
  assert.equal(result.summary.chains[0].missingReason, "actual_balance_unobserved");
});
