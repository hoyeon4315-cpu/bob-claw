import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTreasuryPlan } from "../src/treasury/planner.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";

function inventoryFixture() {
  return {
    schemaVersion: 1,
    observedAt: "2026-04-11T03:00:00.000Z",
    address: "0x000000000000000000000000000000000000dEaD",
    supportedChains: ["bob", "base"],
    activeChains: ["bob", "base"],
    native: [
      {
        chain: "bob",
        active: true,
        enabled: true,
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        actual: "1000000000000000",
        actualDecimal: 0.001,
        targetBalance: "5000000000000000",
        targetBalanceDecimal: 0.005,
        maxBalance: "20000000000000000",
        maxBalanceDecimal: 0.02,
        refillToTarget: "4000000000000000",
        refillToTargetDecimal: 0.004,
        priceUsd: 2200,
        estimatedUsd: 2.2,
        status: "refill_required",
        rationale: "Primary chain",
      },
      {
        chain: "base",
        active: true,
        enabled: true,
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        actual: "5000000000000000",
        actualDecimal: 0.005,
        targetBalance: "4000000000000000",
        targetBalanceDecimal: 0.004,
        maxBalance: "15000000000000000",
        maxBalanceDecimal: 0.015,
        refillToTarget: "0",
        refillToTargetDecimal: 0,
        priceUsd: 2200,
        estimatedUsd: 11,
        status: "ready",
        rationale: "Secondary chain",
      },
    ],
    tokens: [
      {
        chain: "bob",
        active: true,
        enabled: true,
        ticker: "wBTC.OFT",
        token: "0x0555",
        actual: "5000",
        actualDecimal: 0.00005,
        targetBalance: "30000",
        targetBalanceDecimal: 0.0003,
        maxBalance: "100000",
        maxBalanceDecimal: 0.001,
        refillToTarget: "25000",
        refillToTargetDecimal: 0.00025,
        priceUsd: 70000,
        estimatedUsd: 3.5,
        status: "refill_required",
        rationale: "Current route token",
      },
    ],
    allowances: [
      {
        chain: "bob",
        ticker: "wBTC.OFT",
        spender: "0x0555",
        actual: "0",
        actualDecimal: 0,
        maxApproval: "30000",
        maxApprovalDecimal: 0.0003,
        status: "zero",
        mode: "self_send_or_exact_only",
      },
    ],
    summary: {
      estimatedWalletUsd: 16.7,
    },
  };
}

test("planner emits refill actions for active route-demand items", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = buildTreasuryPlan({
    policy,
    inventory: inventoryFixture(),
    routeDemand: [{ chain: "bob" }, { chain: "bob", token: "0x0555" }],
  });

  assert.equal(plan.decision, "REFILL_REQUIRED");
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].type, "refill_native");
  assert.equal(plan.actions[1].type, "refill_token");
  assert.equal(plan.observations.some((item) => item.type === "allowance_zero"), true);
  assert.equal(plan.reasons.includes("wallet_value_below_refill_floor"), false);
  assert.equal(plan.reasons.includes("refill_cost_above_daily_cap"), false);
  assert.equal(plan.summary.executionBudgetEstimateUsd, 1);
  assert.equal(plan.summary.walletValueFloorUsd, 0);
  assert.equal(plan.summary.walletValueShortfallUsd, 0);
  assert.equal(plan.summary.noDemandBlockerCount, 0);
});

test("planner can refill without route-demand signal in aggressive treasury mode", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = buildTreasuryPlan({
    policy,
    inventory: inventoryFixture(),
    routeDemand: [],
  });

  assert.equal(plan.blockers.some((item) => item.type === "native_refill_blocked_no_demand"), false);
  assert.equal(plan.blockers.some((item) => item.type === "token_refill_blocked_no_demand"), false);
  assert.equal(plan.actions.some((item) => item.type === "refill_native" && item.chain === "bob"), true);
  assert.equal(plan.actions.some((item) => item.type === "refill_token" && item.chain === "bob"), true);
  assert.equal(plan.summary.noDemandBlockerCount, 0);
});

test("planner emits wrapped BTC loop collateral refill as strategy-scoped capital action", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = inventoryFixture();
  inventory.supportedChains = [...inventory.supportedChains, "base"];
  inventory.tokens.push({
    chain: "base",
    active: true,
    enabled: true,
    ticker: "cbBTC",
    token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    actual: "0",
    actualDecimal: 0,
    targetBalance: "35000",
    targetBalanceDecimal: 0.00035,
    maxBalance: "500000",
    maxBalanceDecimal: 0.005,
    refillToTarget: "35000",
    refillToTargetDecimal: 0.00035,
    priceUsd: 70000,
    estimatedUsd: 0,
    status: "refill_required",
    rationale: "Moonwell wrapped-BTC lending loop collateral on Base.",
    strategyPolicy: {
      id: "wrapped_btc_loop_collateral_refill",
      category: "yield",
      economicsMode: "holding_period_carry",
      strategyType: "wrapped_btc_lending_loop",
      actionType: "treasury_refill_for_leverage_collateral",
      perTradeCapUsd: 30,
    },
  });

  const plan = buildTreasuryPlan({
    policy,
    inventory,
    routeDemand: [],
  });

  const action = plan.actions.find((item) => item.chain === "base" && item.ticker === "cbBTC");
  assert.ok(action);
  assert.equal(action.strategyPolicy.id, "wrapped_btc_loop_collateral_refill");
  assert.equal(action.refillEstimatedUsd, 24.5);
});

test("planner promotes observe-only supported chains into refill actions when route demand targets destination gas", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = inventoryFixture();
  inventory.supportedChains = [...inventory.supportedChains, "soneium"];
  inventory.native.push({
    chain: "soneium",
    active: false,
    enabled: true,
    asset: "ETH",
    token: "0x0000000000000000000000000000000000000000",
    actual: "0",
    actualDecimal: 0,
    targetBalance: "1000000000000000",
    targetBalanceDecimal: 0.001,
    maxBalance: "5000000000000000",
    maxBalanceDecimal: 0.005,
    refillToTarget: "1000000000000000",
    refillToTargetDecimal: 0.001,
    priceUsd: 2200,
    estimatedUsd: 0,
    status: "observe_only_low",
    rationale: "Expansion chain bootstrap",
  });

  const plan = buildTreasuryPlan({
    policy,
    inventory,
    routeDemand: [{ chain: "soneium" }],
  });

  const action = plan.actions.find((item) => item.chain === "soneium" && item.type === "refill_native");
  assert.ok(action);
  assert.equal(action.refillAmountDecimal, 0.001);
});

test("planner estimates modeled stable refill value when oracle price is absent", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = inventoryFixture();
  inventory.supportedChains = [...inventory.supportedChains, "soneium"];
  inventory.activeChains = [...inventory.activeChains, "soneium"];
  inventory.tokens.push({
    chain: "soneium",
    active: true,
    enabled: true,
    ticker: "USDC",
    token: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
    actual: "0",
    actualDecimal: 0,
    targetBalance: "4000000",
    targetBalanceDecimal: 4,
    maxBalance: "12000000",
    maxBalanceDecimal: 12,
    refillToTarget: "4000000",
    refillToTargetDecimal: 4,
    priceUsd: null,
    estimatedUsd: null,
    status: "refill_required",
    rationale: "Soneium representative USDC bootstrap",
  });

  const plan = buildTreasuryPlan({
    policy,
    inventory,
    routeDemand: [{ chain: "soneium", token: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369" }],
  });

  const action = plan.actions.find((item) => item.chain === "soneium" && item.ticker === "USDC");
  assert.ok(action);
  assert.equal(action.refillEstimatedUsd, 4);
});

test("planner flags demanded source tokens that are not modeled in treasury policy", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = buildTreasuryPlan({
    policy,
    inventory: inventoryFixture(),
    routeDemand: [{ chain: "base", token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }],
  });

  const blocker = plan.blockers.find((item) => item.type === "token_inventory_unmodeled_for_demand");
  assert.ok(blocker);
  assert.equal(blocker.chain, "base");
  assert.equal(blocker.token, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
});

test("planner uses token-specific demand when a chain has multiple modeled tokens", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = inventoryFixture();
  inventory.tokens.push({
    chain: "base",
    active: true,
    enabled: true,
    ticker: "wBTC.OFT",
    token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    actual: "0",
    actualDecimal: 0,
    targetBalance: "30000",
    targetBalanceDecimal: 0.0003,
    maxBalance: "100000",
    maxBalanceDecimal: 0.001,
    refillToTarget: "30000",
    refillToTargetDecimal: 0.0003,
    priceUsd: 70000,
    estimatedUsd: 0,
    status: "refill_required",
    rationale: "Base wrapped BTC buffer",
  });
  inventory.tokens.push({
    chain: "base",
    active: true,
    enabled: true,
    ticker: "USDC",
    token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    actual: "0",
    actualDecimal: 0,
    targetBalance: "300000000",
    targetBalanceDecimal: 300,
    maxBalance: "1000000000",
    maxBalanceDecimal: 1000,
    refillToTarget: "300000000",
    refillToTargetDecimal: 300,
    priceUsd: 1,
    estimatedUsd: 0,
    status: "refill_required",
    rationale: "Base USDC buffer",
  });

  const plan = buildTreasuryPlan({
    policy,
    inventory,
    routeDemand: [{ chain: "base" }, { chain: "base", token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }],
  });

  assert.equal(plan.actions.some((item) => item.chain === "base" && item.token === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"), true);
  assert.equal(plan.actions.some((item) => item.chain === "base" && item.token === "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c"), true);
});

test("planner accepts same-chain stablecoin alias coverage for chain-level demand", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory = inventoryFixture();
  inventory.supportedChains = [...inventory.supportedChains, "bsc"];
  inventory.tokens.push({
    chain: "bsc",
    active: false,
    enabled: true,
    ticker: "USDC",
    token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    actual: "0",
    actualDecimal: 0,
    targetBalance: "300000000000000000000",
    targetBalanceDecimal: 300,
    maxBalance: "1000000000000000000000",
    maxBalanceDecimal: 1000,
    refillToTarget: "300000000000000000000",
    refillToTargetDecimal: 300,
    priceUsd: 1,
    estimatedUsd: 0,
    status: "observe_only_low",
    rationale: "BSC stable buffer",
  });
  inventory.tokens.push({
    chain: "bsc",
    active: false,
    enabled: true,
    ticker: "USDT",
    token: "0x55d398326f99059fF775485246999027B3197955",
    actual: "357373900000000000000",
    actualDecimal: 357.3739,
    targetBalance: "300000000000000000000",
    targetBalanceDecimal: 300,
    maxBalance: "1000000000000000000000",
    maxBalanceDecimal: 1000,
    refillToTarget: "0",
    refillToTargetDecimal: 0,
    priceUsd: 1,
    estimatedUsd: 357.3739,
    status: "supported_ready",
    rationale: "BSC stable buffer",
  });

  const plan = buildTreasuryPlan({
    policy,
    inventory,
    routeDemand: [{ chain: "bsc" }],
  });

  assert.equal(plan.actions.some((item) => item.chain === "bsc" && item.token === "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"), false);
  assert.equal(
    plan.observations.some(
      (item) => item.chain === "bsc" && item.ticker === "USDC" && item.status === "satisfied_by_same_chain_stable_buffer",
    ),
    true,
  );
});
