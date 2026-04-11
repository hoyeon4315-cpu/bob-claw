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

  assert.equal(plan.decision, "REVIEW_REFILL_PLAN");
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].type, "refill_native");
  assert.equal(plan.actions[1].type, "refill_token");
  assert.equal(plan.observations.some((item) => item.type === "allowance_zero"), true);
  assert.equal(plan.reasons.includes("wallet_value_below_refill_floor"), true);
});

test("planner blocks token refill without demand signal", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = buildTreasuryPlan({
    policy,
    inventory: inventoryFixture(),
    routeDemand: [],
  });

  assert.equal(plan.blockers.some((item) => item.type === "native_refill_blocked_no_demand"), true);
  assert.equal(plan.blockers.some((item) => item.type === "token_refill_blocked_no_demand"), true);
  assert.equal(plan.actions.length, 0);
});
