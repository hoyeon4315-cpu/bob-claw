import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN, ZERO_TOKEN } from "../src/assets/tokens.mjs";
import {
  buildCapitalManagerRefillJobs,
  mergeCapitalInventory,
  observedCapitalBalancesByChain,
} from "../src/executor/capital/rebalancer.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";

function priceFixture() {
  return {
    btc: 80_000,
    tokenByKey: {
      btc: 80_000,
      wbtc: 80_000,
      ethereum: 2_000,
      usd_stable: 1,
    },
    nativeByChain: {
      avalanche: 25,
      base: 2_000,
      bera: 7,
      bob: 2_000,
      bsc: 600,
      ethereum: 2_000,
      optimism: 2_000,
      sei: 0.25,
      soneium: 2_000,
      sonic: 0.5,
      unichain: 2_000,
    },
  };
}

test("capital inventory merge prefers whole-wallet observations and aggregates settlement families per chain", () => {
  const inventory = mergeCapitalInventory({
    treasuryInventory: {
      native: [
        {
          chain: "base",
          token: ZERO_TOKEN,
          actual: "100000000000000",
          actualDecimal: 0.0001,
          estimatedUsd: 0.2,
        },
      ],
      tokens: [
        {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          actual: "50000",
          actualDecimal: 0.0005,
          estimatedUsd: 40,
        },
      ],
    },
    wholeWalletInventory: {
      native: [
        {
          chain: "base",
          token: ZERO_TOKEN,
          balance: "1000000000000000",
          actualDecimal: 0.001,
          estimatedUsd: 2,
        },
        {
          chain: "ethereum",
          token: ZERO_TOKEN,
          balance: "2500000000000000",
          actualDecimal: 0.0025,
          estimatedUsd: 5,
        },
      ],
      tokenBalances: [
        {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          balance: "52500",
          actualDecimal: 0.000525,
          estimatedUsd: 42,
        },
        {
          chain: "base",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ticker: "USDC",
          balance: "10000000",
          actualDecimal: 10,
          estimatedUsd: 10,
        },
        {
          chain: "base",
          token: "0x4200000000000000000000000000000000000006",
          ticker: "WETH",
          balance: "1000000000000000",
          actualDecimal: 0.001,
          estimatedUsd: 2,
        },
      ],
    },
  });

  const balancesByChain = observedCapitalBalancesByChain({ inventory });

  assert.equal(inventory.native.find((item) => item.chain === "base").estimatedUsd, 2);
  assert.equal(inventory.tokens.find((item) => item.chain === "base" && item.token === WBTC_OFT_TOKEN).estimatedUsd, 42);
  assert.equal(balancesByChain.base.nativeUsd, 2);
  assert.equal(balancesByChain.base.settlementUsd, 52);
  assert.equal(balancesByChain.ethereum.nativeUsd, 5);
});

test("capital manager wrapper emits auto-executable Gas.Zip gas-float refill jobs", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const result = buildCapitalManagerRefillJobs({
    strategyCaps: [
      {
        strategyId: "gas-float-soneium",
        autoExecute: true,
        caps: {
          perChainUsd: {
            soneium: 0,
          },
        },
        gasFloat: {
          soneium: { minUsd: 3, targetUsd: 6 },
        },
      },
    ],
    policy,
    wholeWalletInventory: {
      native: [
        {
          chain: "base",
          token: ZERO_TOKEN,
          balance: "5000000000000000",
          actualDecimal: 0.005,
          estimatedUsd: 10,
        },
      ],
      tokenBalances: [],
    },
    prices: priceFixture(),
    address: "0x1111111111111111111111111111111111111111",
    now: "2026-04-20T12:00:00.000Z",
  });

  assert.equal(result.rebalancePlan.actions.length, 1);
  assert.equal(result.rebalancePlan.actions[0].type, "gas_float_top_up");
  assert.equal(result.capitalPlan.actions.length, 1);
  assert.equal(result.capitalPlan.actions[0].type, "refill_native");
  assert.equal(result.capitalPlan.actions[0].chain, "soneium");
  assert.equal(result.jobs.requiresManualReview, false);
  assert.equal(result.jobs.jobs.length, 1);
  assert.equal(result.jobs.jobs[0].executionMethod, "gas_refuel_bridge_gas_zip");
  assert.equal(result.jobs.jobs[0].fundingSource.source.chain, "base");
  assert.deepEqual(result.jobs.jobs[0].fundingSource.settlementRequirements, [
    "gas_zip_destination_native_delta_proof_required",
  ]);
});

test("capital manager wrapper emits wrapped-BTC settlement rebalance jobs from observed source inventory", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const result = buildCapitalManagerRefillJobs({
    strategyCaps: [
      {
        strategyId: "wrapped-btc-soneium",
        autoExecute: true,
        caps: {
          perChainUsd: {
            soneium: 50,
          },
        },
        gasFloat: {
          soneium: { minUsd: 0, targetUsd: 0 },
        },
      },
    ],
    policy,
    wholeWalletInventory: {
      native: [
        {
          chain: "base",
          token: ZERO_TOKEN,
          balance: "5000000000000000",
          actualDecimal: 0.005,
          estimatedUsd: 10,
        },
      ],
      tokenBalances: [
        {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          balance: "150000",
          actualDecimal: 0.0015,
          estimatedUsd: 120,
        },
      ],
    },
    prices: priceFixture(),
    address: "0x1111111111111111111111111111111111111111",
    now: "2026-04-20T12:00:00.000Z",
  });

  const rebalanceActions = result.rebalancePlan.actions.filter((a) => a.type === "capital_rebalance");
  assert.equal(rebalanceActions.length, 1);
  assert.equal(rebalanceActions[0].chain, "soneium");
  assert.equal(result.capitalPlan.actions.length, 1);
  assert.equal(result.capitalPlan.actions[0].type, "refill_token");
  assert.equal(result.capitalPlan.actions[0].token, WBTC_OFT_TOKEN);
  assert.equal(result.jobs.requiresManualReview, false);
  assert.equal(result.jobs.jobs.length, 1);
  assert.equal(result.jobs.jobs[0].executionMethod, "cross_chain_bridge_or_swap");
  assert.equal(result.jobs.jobs[0].fundingSource.source.chain, "base");
  assert.equal(result.jobs.jobs[0].fundingSource.source.token, WBTC_OFT_TOKEN);
});

test("capital manager wrapper prefers cross-chain wrapped BTC when destination native gas exists but cannot cover settlement refill", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const result = buildCapitalManagerRefillJobs({
    strategyCaps: [
      {
        strategyId: "wrapped-btc-soneium",
        autoExecute: true,
        caps: {
          perChainUsd: {
            soneium: 50,
          },
        },
        gasFloat: {
          soneium: { minUsd: 0, targetUsd: 0 },
        },
      },
    ],
    policy,
    wholeWalletInventory: {
      native: [
        {
          chain: "soneium",
          token: ZERO_TOKEN,
          balance: "20000000000000",
          actualDecimal: 0.00002,
          estimatedUsd: 0.04,
        },
      ],
      tokenBalances: [
        {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          balance: "150000",
          actualDecimal: 0.0015,
          estimatedUsd: 120,
        },
      ],
    },
    prices: priceFixture(),
    address: "0x1111111111111111111111111111111111111111",
    now: "2026-04-20T12:00:00.000Z",
  });

  assert.equal(result.jobs.jobs.length, 1);
  assert.equal(result.jobs.jobs[0].executionMethod, "cross_chain_bridge_or_swap");
  assert.equal(result.jobs.jobs[0].fundingSource.source.chain, "base");
  assert.equal(
    result.jobs.jobs[0].candidateMethods.find((item) => item.method === "same_chain_native_to_token_swap").missingInputs.includes("source_inventory_below_target_amount"),
    true,
  );
});
