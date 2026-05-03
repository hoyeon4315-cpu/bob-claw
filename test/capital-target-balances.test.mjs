import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetBalances } from "../src/executor/capital/target-balances.mjs";

test("target balances use max live unit sizing instead of summing raw chain caps", () => {
  const targets = buildTargetBalances({
    strategyCaps: [
      {
        strategyId: "strategy-a",
        autoExecute: true,
        caps: {
          perTxUsd: 500,
          tinyLivePerTxUsd: 25,
          perChainUsd: { base: 1_000_000 },
        },
        gasFloat: {
          base: { minUsd: 3, targetUsd: 6 },
        },
      },
      {
        strategyId: "strategy-b",
        autoExecute: true,
        caps: {
          perTxUsd: 50,
          perChainUsd: { base: 1_000_000 },
        },
        gasFloat: {
          base: { minUsd: 10, targetUsd: 20 },
        },
      },
    ],
    policy: {
      capital: {
        canaryStartUsdMax: 50,
        maxIdleCapitalPerChainUsd: 60,
      },
    },
  });

  assert.equal(targets.items.length, 1);
  assert.equal(targets.items[0].chain, "base");
  assert.equal(targets.items[0].settlementTargetUsd, 50);
  assert.equal(targets.items[0].gasFloatMinUsd, 10);
  assert.equal(targets.items[0].gasFloatTargetUsd, 20);
});

test("target balances can use aggressive committed execution budget without exceeding strategy caps", () => {
  const targets = buildTargetBalances({
    strategyCaps: [
      {
        strategyId: "base-opportunistic",
        autoExecute: true,
        caps: {
          perTxUsd: 200,
          perChainUsd: { base: 1_000 },
        },
      },
      {
        strategyId: "base-tiny",
        autoExecute: true,
        caps: {
          perTxUsd: 200,
          tinyLivePerTxUsd: 25,
          perChainUsd: { base: 1_000 },
        },
      },
    ],
    policy: {
      capital: {
        canaryStartUsdMax: 125,
        maxIdleCapitalPerChainUsd: 200,
      },
    },
  });

  assert.equal(targets.items.length, 1);
  assert.equal(targets.items[0].chain, "base");
  assert.equal(targets.items[0].settlementTargetUsd, 125);
});
