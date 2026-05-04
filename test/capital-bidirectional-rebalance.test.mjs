import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCapitalRebalancePlan,
  buildCapitalRebalanceMatchedTransfers,
} from "../src/executor/capital/rebalancer.mjs";
import { activeChains } from "../src/executor/capital/active-chain-set.mjs";

const STRATEGY_CAPS = [
  {
    strategyId: "strategy-base",
    autoExecute: true,
    caps: { perChainUsd: { base: 100 } },
    gasFloat: { base: { minUsd: 0, targetUsd: 0 } },
  },
  {
    strategyId: "strategy-bera",
    autoExecute: true,
    caps: { perChainUsd: { bera: 100 } },
    gasFloat: { bera: { minUsd: 0, targetUsd: 0 } },
  },
];

test("activeChains only includes auto-execute chains with positive caps", () => {
  assert.deepEqual(activeChains([
    ...STRATEGY_CAPS,
    {
      strategyId: "inactive-gas",
      autoExecute: true,
      caps: { perChainUsd: { soneium: 0 } },
      gasFloat: { soneium: { minUsd: 3, targetUsd: 6 } },
    },
    {
      strategyId: "manual-base",
      autoExecute: false,
      caps: { perChainUsd: { optimism: 100 } },
      gasFloat: { optimism: { minUsd: 0, targetUsd: 0 } },
    },
  ]), ["base", "bera"]);
});

test("buildCapitalRebalancePlan drains inactive surplus without creating inactive destination shortfall", () => {
  const plan = buildCapitalRebalancePlan({
    strategyCaps: [
      {
        strategyId: "strategy-base",
        autoExecute: true,
        caps: { perChainUsd: { base: 100, soneium: 0 } },
        gasFloat: {
          base: { minUsd: 0, targetUsd: 0 },
          soneium: { minUsd: 3, targetUsd: 6 },
        },
      },
    ],
    policy: { capital: { canaryStartUsdMax: 100, rebalanceToleranceUsd: 1 } },
    balancesByChain: {
      soneium: { nativeUsd: 0, settlementUsd: 90 },
      base: { nativeUsd: 0, settlementUsd: 0 },
    },
  });
  assert.equal(plan.actions.some((item) => item.type === "gas_float_top_up" && item.chain === "soneium"), false);
  assert.equal(plan.actions.some((item) => item.type === "capital_rebalance" && item.chain === "soneium"), false);
  assert.equal(plan.matchedTransfers.length, 1);
  assert.equal(plan.matchedTransfers[0].from, "soneium");
  assert.equal(plan.matchedTransfers[0].to, "base");
  assert.equal(plan.matchedTransfers[0].amountUsd, 90);
});

test("matched transfers pair surplus chains with shortfall chains", () => {
  const transfers = buildCapitalRebalanceMatchedTransfers({
    shortfalls: [{ chain: "base", amountUsd: 60 }],
    surpluses: [{ chain: "bera", amountUsd: 80 }],
  });
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].from, "bera");
  assert.equal(transfers[0].to, "base");
  assert.equal(transfers[0].amountUsd, 60);
});

test("matched transfers split a single surplus across two shortfalls", () => {
  const transfers = buildCapitalRebalanceMatchedTransfers({
    shortfalls: [
      { chain: "base", amountUsd: 50 },
      { chain: "optimism", amountUsd: 30 },
    ],
    surpluses: [{ chain: "bera", amountUsd: 100 }],
  });
  assert.equal(transfers.length, 2);
  const sum = transfers.reduce((s, t) => s + t.amountUsd, 0);
  assert.equal(sum, 80);
});

test("buildCapitalRebalancePlan emits drain for residual surplus that no shortfall consumed", () => {
  const plan = buildCapitalRebalancePlan({
    strategyCaps: [
      {
        strategyId: "strategy-base",
        autoExecute: true,
        caps: { perChainUsd: { base: 100 } },
        gasFloat: { base: { minUsd: 0, targetUsd: 0 } },
      },
    ],
    policy: { capital: { canaryStartUsdMax: 100, rebalanceToleranceUsd: 1 } },
    balancesByChain: {
      bsc: { nativeUsd: 0, settlementUsd: 300 },
      base: { nativeUsd: 0, settlementUsd: 0 },
    },
  });
  const drains = plan.actions.filter((a) => a.type === "capital_drain");
  const refills = plan.actions.filter((a) => a.type === "capital_rebalance");
  assert.equal(drains.length, 1);
  assert.equal(drains[0].chain, "bsc");
  assert.equal(drains[0].amountUsd, 200);
  assert.equal(drains[0].matchedToShortfallUsd, 100);
  assert.equal(refills.length, 1);
  assert.equal(refills[0].chain, "base");
  assert.equal(plan.matchedTransfers.length, 1);
});

test("buildCapitalRebalancePlan does not double-emit when matched transfer covers full surplus", () => {
  const plan = buildCapitalRebalancePlan({
    strategyCaps: [
      {
        strategyId: "strategy-base",
        autoExecute: true,
        caps: { perChainUsd: { base: 100 } },
        gasFloat: { base: { minUsd: 0, targetUsd: 0 } },
      },
    ],
    policy: { capital: { canaryStartUsdMax: 100, rebalanceToleranceUsd: 1 } },
    balancesByChain: {
      bsc: { nativeUsd: 0, settlementUsd: 100 },
      base: { nativeUsd: 0, settlementUsd: 0 },
    },
  });
  const drains = plan.actions.filter((a) => a.type === "capital_drain");
  const refills = plan.actions.filter((a) => a.type === "capital_rebalance");
  assert.equal(drains.length, 0, "matched transfer should not emit a residual drain");
  assert.equal(refills.length, 1);
});

test("buildCapitalRebalancePlan keeps matchedTransfers as cross-chain pull plan", () => {
  const plan = buildCapitalRebalancePlan({
    strategyCaps: STRATEGY_CAPS,
    policy: { capital: { canaryStartUsdMax: 100, rebalanceToleranceUsd: 1 } },
    balancesByChain: {
      bera: { nativeUsd: 0, settlementUsd: 130 },
      base: { nativeUsd: 0, settlementUsd: 0 },
    },
  });
  const drains = plan.actions.filter((a) => a.type === "capital_drain");
  const refills = plan.actions.filter((a) => a.type === "capital_rebalance");
  // bera surplus 30 fully eaten by matched transfer to base, no residual drain
  assert.equal(drains.length, 0);
  assert.equal(refills.length, 1);
  assert.equal(refills[0].chain, "base");
  assert.equal(refills[0].amountUsd, 100);
  assert.equal(plan.matchedTransfers.length, 1);
  assert.equal(plan.matchedTransfers[0].from, "bera");
  assert.equal(plan.matchedTransfers[0].to, "base");
  assert.equal(plan.matchedTransfers[0].amountUsd, 30);
});

test("buildCapitalRebalancePlan stays balanced within tolerance", () => {
  const plan = buildCapitalRebalancePlan({
    strategyCaps: STRATEGY_CAPS,
    policy: { capital: { canaryStartUsdMax: 100, rebalanceToleranceUsd: 5 } },
    balancesByChain: {
      base: { nativeUsd: 0, settlementUsd: 98 },
      bera: { nativeUsd: 0, settlementUsd: 102 },
    },
  });
  const drains = plan.actions.filter((a) => a.type === "capital_drain");
  const refills = plan.actions.filter((a) => a.type === "capital_rebalance");
  assert.equal(drains.length, 0);
  assert.equal(refills.length, 0);
});
