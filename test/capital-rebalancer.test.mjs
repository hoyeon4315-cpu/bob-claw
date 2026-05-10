import assert from "node:assert/strict";
import { test } from "node:test";
import { ETHEREUM_WBTC_TOKEN, WBTC_OFT_TOKEN, ZERO_TOKEN } from "../src/assets/tokens.mjs";
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

test("capital inventory merge does not let stale duplicate wallet rows hide larger BTC observations", () => {
  const inventory = mergeCapitalInventory({
    treasuryInventory: null,
    wholeWalletInventory: {
      native: [
        {
          chain: "bitcoin",
          token: ZERO_TOKEN,
          balance: "620483",
          actualDecimal: 0.00620483,
          estimatedUsd: 500.61,
          source: "whole_wallet_live_scan",
        },
        {
          chain: "bitcoin",
          token: ZERO_TOKEN,
          balance: "2650",
          actualDecimal: 0.0000265,
          estimatedUsd: 2.14,
          source: "stale_dashboard_status_snapshot",
        },
      ],
      tokenBalances: [],
    },
  });

  const btc = inventory.native.find((item) => item.chain === "bitcoin");
  assert.equal(btc.actual, "620483");
  assert.equal(btc.estimatedUsd, 500.61);
});

test("capital manager wrapper skips gas-float refuel intents for inactive zero-cap chains", () => {
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

  assert.equal(result.rebalancePlan.actions.length, 0);
  assert.equal(result.capitalPlan.actions.length, 0);
  assert.equal(result.jobs.jobs.length, 0);
});

test("capital manager wrapper still emits same-tick active-chain gas-float refill jobs", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const result = buildCapitalManagerRefillJobs({
    strategyCaps: [
      {
        strategyId: "gas-float-soneium",
        autoExecute: true,
        caps: {
          perChainUsd: {
            soneium: 25,
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

  assert.equal(result.rebalancePlan.actions.some((item) => item.type === "gas_float_top_up" && item.chain === "soneium"), true);
  assert.equal(result.capitalPlan.actions.some((item) => item.type === "refill_native" && item.chain === "soneium"), true);
  assert.equal(result.jobs.jobs.some((item) => item.executionMethod === "gas_refuel_bridge_gas_zip"), true);
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

test("capital manager targets Ethereum canonical WBTC instead of non-canonical wBTC.OFT", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const result = buildCapitalManagerRefillJobs({
    strategyCaps: [
      {
        strategyId: "wrapped-btc-ethereum",
        autoExecute: true,
        caps: {
          perChainUsd: {
            ethereum: 50,
          },
        },
        gasFloat: {
          ethereum: { minUsd: 0, targetUsd: 0 },
        },
      },
    ],
    policy,
    wholeWalletInventory: {
      native: [],
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

  assert.equal(result.capitalPlan.actions.length, 1);
  assert.equal(result.capitalPlan.actions[0].chain, "ethereum");
  assert.equal(result.capitalPlan.actions[0].token, ETHEREUM_WBTC_TOKEN);
  assert.equal(result.capitalPlan.actions[0].ticker, "WBTC");
  assert.equal(result.jobs.jobs[0].token, ETHEREUM_WBTC_TOKEN);
});

test("capital manager promotes executable LI.FI fallback when preferred gateway token refill is not auto-executable", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const result = buildCapitalManagerRefillJobs({
    strategyCaps: [
      {
        strategyId: "wrapped-btc-base",
        autoExecute: true,
        caps: {
          perChainUsd: {
            base: 50,
          },
        },
        gasFloat: {
          base: { minUsd: 0, targetUsd: 0 },
        },
      },
    ],
    policy,
    wholeWalletInventory: {
      native: [
        {
          chain: "bera",
          token: ZERO_TOKEN,
          balance: "15576907036978404619",
          actualDecimal: 15.576907036978405,
          estimatedUsd: 5.768985405680137,
        },
      ],
      tokenBalances: [],
    },
    prices: priceFixture(),
    address: "0x1111111111111111111111111111111111111111",
    now: "2026-05-04T18:31:47.947Z",
  });

  assert.equal(result.jobs.requiresManualReview, false);
  assert.equal(result.jobs.summary.manualReviewJobCount, 0);
  assert.equal(result.jobs.summary.autoQueuedJobCount, 1);
  assert.equal(result.jobs.jobs[0].executionMethod, "cross_chain_bridge_lifi");
  assert.equal(result.jobs.jobs[0].fundingSource.method, "cross_chain_bridge_lifi");
  assert.equal(result.jobs.jobs[0].fundingSource.selectionStatus, "ready");
  assert.equal(result.jobs.jobs[0].fundingSource.source.chain, "bera");
  assert.deepEqual(result.jobs.jobs[0].reviewReasons, []);
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
  assert.equal(result.jobs.jobs[0].candidateMethods.some((item) => item.method === "cross_chain_bridge_or_swap"), true);
});

test("capital manager reserve concentration splits a scattered 11-chain wallet into Base-matched source jobs", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const result = buildCapitalManagerRefillJobs({
    strategyCaps: [
      {
        strategyId: "base-reserve",
        autoExecute: true,
        caps: {
          perChainUsd: {
            base: 200,
          },
        },
        gasFloat: {
          base: { minUsd: 0, targetUsd: 0 },
        },
      },
    ],
    policy,
    wholeWalletInventory: {
      native: [
        { chain: "base", token: ZERO_TOKEN, balance: "15000000000000000", actualDecimal: 0.015, estimatedUsd: 30 },
        { chain: "bera", token: ZERO_TOKEN, balance: "9000000000000000000", actualDecimal: 9, estimatedUsd: 9 },
        { chain: "avalanche", token: ZERO_TOKEN, balance: "520000000000000000", actualDecimal: 0.52, estimatedUsd: 13 },
        { chain: "sonic", token: ZERO_TOKEN, balance: "14000000000000000000", actualDecimal: 14, estimatedUsd: 7 },
        { chain: "ethereum", token: ZERO_TOKEN, balance: "7000000000000000", actualDecimal: 0.007, estimatedUsd: 14 },
        { chain: "soneium", token: ZERO_TOKEN, balance: "3500000000000000", actualDecimal: 0.0035, estimatedUsd: 7 },
        { chain: "bob", token: ZERO_TOKEN, balance: "1500000000000000", actualDecimal: 0.0015, estimatedUsd: 3 },
      ],
      tokenBalances: [
        { chain: "sei", token: WBTC_OFT_TOKEN, ticker: "wBTC.OFT", balance: "30000", actualDecimal: 0.0003, estimatedUsd: 24 },
        { chain: "bsc", token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", ticker: "USDC", balance: "10000000000000000000", actualDecimal: 10, estimatedUsd: 10 },
        { chain: "sonic", token: "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38", ticker: "wS", balance: "14000000000000000000", actualDecimal: 14, estimatedUsd: 7 },
        { chain: "ethereum", token: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", ticker: "RLUSD", balance: "9000000000000000000", actualDecimal: 9, estimatedUsd: 9 },
        { chain: "optimism", token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", ticker: "USDC", balance: "6000000", actualDecimal: 6, estimatedUsd: 6 },
        { chain: "unichain", token: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", ticker: "USDC", balance: "5000000", actualDecimal: 5, estimatedUsd: 5 },
        { chain: "avalanche", token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", ticker: "USDC", balance: "5000000", actualDecimal: 5, estimatedUsd: 5 },
      ],
    },
    prices: priceFixture(),
    address: "0x1111111111111111111111111111111111111111",
    scoredTargets: {
      observedAt: "2026-05-04T00:00:00.000Z",
      perChain: [{ chain: "base", strategyIds: ["base-reserve"], settlementTargetUsd: 112 }],
    },
    now: "2026-05-04T00:00:00.000Z",
  });

  assert.equal(result.rebalancePlan.reserveConcentration.active, true);
  const projectedBaseUsd =
    result.rebalancePlan.reserveConcentration.currentReserveWalletUsd +
    result.rebalancePlan.matchedTransfers.reduce((sum, item) => sum + item.amountUsd, 0);
  const projectedBaseShare = projectedBaseUsd / result.rebalancePlan.reserveConcentration.totalWalletUsd;
  assert.ok(projectedBaseShare >= 0.8, `expected Base share >= 0.8, got ${projectedBaseShare}`);

  const matchedSources = new Set(result.rebalancePlan.matchedTransfers.map((item) => `${item.from}:${item.sourceTicker}`));
  assert.equal(matchedSources.has("bsc:USDC"), true);
  assert.equal(matchedSources.has("bera:BERA"), true);
  assert.equal(matchedSources.has("avalanche:AVAX"), true);
  assert.equal(matchedSources.has("sonic:wS"), true);

  const refillActions = result.capitalPlan.actions.filter((item) => item.origin === "capital_rebalance_matched_transfer");
  assert.ok(refillActions.length >= 4);
  assert.equal(refillActions.every((item) => item.chain === "base"), true);

  const jobSources = new Set(
    result.jobs.jobs
      .filter((item) => item.type === "refill_token")
      .map((item) => `${item.fundingSource?.source?.chain}:${item.fundingSource?.source?.ticker}`),
  );
  assert.equal(jobSources.has("bsc:USDC"), true);
  assert.equal(jobSources.has("bera:BERA"), true);
  assert.equal(jobSources.has("avalanche:AVAX"), true);
  assert.equal(jobSources.has("sonic:wS"), true);
});
