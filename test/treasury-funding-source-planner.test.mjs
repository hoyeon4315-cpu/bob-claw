import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildFundingSourcePlan } from "../src/treasury/funding-source-planner.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";

function planFixture(decision = "REVIEW_REFILL_PLAN") {
  return {
    schemaVersion: 1,
    observedAt: "2026-04-11T04:00:00.000Z",
    address: "0x000000000000000000000000000000000000dEaD",
    decision,
    inventory: {
      native: [
        {
          chain: "bob",
          actual: "1000000000000000",
          actualDecimal: 0.001,
          estimatedUsd: 2.2,
        },
      ],
      tokens: [
        {
          chain: "bob",
          actual: "5000",
          actualDecimal: 0.00005,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 3.5,
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "bob",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "4000000000000000",
        refillAmountDecimal: 0.004,
        refillEstimatedUsd: 8.8,
        rationale: "Primary chain buffer",
      },
      {
        type: "refill_token",
        chain: "bob",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "25000",
        refillAmountDecimal: 0.00025,
        refillEstimatedUsd: 17.5,
        rationale: "Route token buffer",
      },
    ],
  };
}

test("single wallet funding source planner prefers same-chain swaps with bootstrap gas", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: planFixture(),
    policy,
    routeContext: {
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
      inputUsd: 10,
      knownCostUsd: 0.2,
      netEdgeUsd: 1.5,
      executableNetEdgeUsd: 1.4,
      routeFailureRate: 0.1,
      tradeReadiness: "shadow_candidate_review_only",
    },
  });

  assert.equal(funding.selections.length, 2);
  assert.equal(funding.selections[0].selectedMethod, "same_chain_token_to_native_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
  assert.equal(funding.selections[1].selectedMethod, "same_chain_native_to_token_swap");
  assert.equal(funding.selections[1].selectionStatus, "ready");
  assert.equal(funding.reasons.includes("reserve_replenishment_unmodelled"), false);
  assert.equal(funding.summary.expectedFailureCostUsd > 0, true);
  assert.equal(funding.summary.capitalFragmentationDragUsd > 0, true);
  assert.equal(funding.summary.strandedCapitalUsd > 0, true);
  assert.equal(Number.isFinite(funding.summary.effectiveSystemNetPnlUsd), true);
  assert.equal(funding.summary.effectiveSystemNetPnlUsd < 1.4, true);
  assert.equal(funding.summary.economicallyJustified, true);
});

test("dual wallet funding source planner prefers reserve transfers but marks reserve state as unmodelled", () => {
  const policy = validateTreasuryPolicy({ ...buildDefaultTreasuryPolicy(), walletMode: "dual_wallet" });
  const funding = buildFundingSourcePlan({
    plan: planFixture("REFILL_REQUIRED"),
    policy,
    routeContext: {
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
      inputUsd: 10,
      knownCostUsd: 0.2,
      netEdgeUsd: 1.5,
      executableNetEdgeUsd: 1.4,
      routeFailureRate: 0.1,
      tradeReadiness: "shadow_candidate_review_only",
    },
  });

  assert.equal(funding.selections[0].selectedMethod, "same_chain_native_transfer");
  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[1].selectedMethod, "same_chain_token_transfer");
  assert.equal(funding.reasons.includes("reserve_state_unmodelled"), true);
  assert.equal(funding.reasons.includes("reserve_replenishment_unmodelled"), true);
  assert.equal(funding.summary.effectiveSystemNetPnlUsd, null);
  assert.equal(funding.summary.economicallyJustified, null);
});

test("funding source planner flags refill plans that stay system-negative after refill costs", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: planFixture(),
    policy,
    routeContext: {
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
      inputUsd: 10,
      knownCostUsd: 0.2,
      netEdgeUsd: -0.3,
      executableNetEdgeUsd: null,
      routeFailureRate: 0,
      tradeReadiness: "reject_no_net_edge",
    },
  });

  assert.equal(funding.summary.economicallyJustified, false);
  assert.equal(funding.summary.effectiveSystemNetPnlUsd < 0, true);
  assert.equal(funding.reasons.includes("route_refill_economically_unjustified"), true);
});

test("swap-based funding is conditional when bootstrap native gas is missing", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = planFixture();
  plan.inventory.native[0].actual = "0";
  plan.inventory.native[0].actualDecimal = 0;
  plan.inventory.native[0].estimatedUsd = 0;

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[0].selectedMethod, "same_chain_token_to_native_swap");
  assert.equal(funding.selections[0].missingInputs.includes("bootstrap_native_required"), true);
  assert.equal(funding.selections[0].missingInputs.includes("cross_chain_source_selection_missing"), false);
  assert.equal(funding.reasons.includes("bootstrap_native_required"), true);
});

test("cross-chain refill is selected when same-chain native rebuild is impossible", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "soneium",
          actual: "0",
          actualDecimal: 0,
          estimatedUsd: 0,
        },
      ],
      tokens: [],
    },
    actions: [
      {
        type: "refill_native",
        chain: "soneium",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[0].missingInputs.includes("cross_chain_source_selection_missing"), true);
  assert.equal(funding.selections[0].missingInputs.includes("reserve_state_unmodelled"), false);
  assert.equal(funding.reasons.includes("reserve_state_unmodelled"), false);
  assert.equal(funding.reasons.includes("reserve_replenishment_unmodelled"), false);
});

test("cross-chain refill selects an observed source inventory when another chain is funded", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "soneium",
          actual: "0",
          actualDecimal: 0,
          estimatedUsd: 0,
        },
      ],
      tokens: [
        {
          chain: "base",
          actual: "25000",
          actualDecimal: 0.00025,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 18.5,
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "soneium",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
  assert.equal(funding.selections[0].missingInputs.includes("cross_chain_source_selection_missing"), false);
  assert.equal(funding.selections[0].missingInputs.includes("cross_chain_native_refill_executor_missing"), true);
  assert.equal(funding.selections[0].missingInputs.includes("reserve_state_unmodelled"), false);
  assert.equal(funding.reasons.includes("reserve_state_unmodelled"), false);
  assert.equal(funding.reasons.includes("reserve_replenishment_unmodelled"), false);
});

test("cross-chain BTC-family token refill is ready when Gateway consolidation can execute it", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [],
      tokens: [
        {
          chain: "base",
          actual: "25000",
          actualDecimal: 0.00025,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 18.5,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "bob",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "10000",
        refillAmountDecimal: 0.0001,
        refillEstimatedUsd: 7.4,
        rationale: "Route token buffer",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.actual, "25000");
  assert.equal(funding.selections[0].missingInputs.length, 0);
});

test("funding source planner supplements same-chain token candidates from whole-wallet inventory", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "soneium",
          actual: "0",
          actualDecimal: 0,
          estimatedUsd: 0,
        },
      ],
      tokens: [],
    },
    actions: [
      {
        type: "refill_native",
        chain: "soneium",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
    ],
  };

  const funding = buildFundingSourcePlan({
    plan,
    policy,
    supplementalInventory: {
      native: [],
      tokenBalances: [
        {
          chain: "soneium",
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          balance: "25000",
          actualDecimal: 0.00025,
          estimatedUsd: 18.5,
        },
      ],
    },
  });

  assert.equal(funding.selections[0].selectedMethod, "same_chain_token_to_native_swap");
  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[0].selectedSource.source.chain, "soneium");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
  assert.equal(funding.selections[0].candidates[0].method, "same_chain_token_to_native_swap");
  assert.equal(funding.selections[0].candidates[0].source.ticker, "wBTC.OFT");
  assert.equal(funding.selections[0].candidates[0].missingInputs.includes("same_chain_token_inventory_missing"), false);
  assert.equal(funding.selections[0].candidates[0].missingInputs.includes("bootstrap_native_required"), true);
  assert.equal(funding.selections[0].missingInputs.includes("bootstrap_native_required"), true);
  assert.equal(funding.selections[0].missingInputs.includes("cross_chain_native_refill_executor_missing"), false);
});

test("cross-chain source selection prefers route-family token inventory over unrelated native balance", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "soneium",
          actual: "0",
          actualDecimal: 0,
          estimatedUsd: 0,
        },
        {
          chain: "sonic",
          actual: "2000000000000000000",
          actualDecimal: 2,
          estimatedUsd: 9.5,
        },
      ],
      tokens: [
        {
          chain: "base",
          actual: "25000",
          actualDecimal: 0.00025,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 6.1,
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "soneium",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
    ],
  };

  const funding = buildFundingSourcePlan({
    plan,
    policy,
    routeContext: {
      routeKey: "base:0x0555->soneium:0x0555",
      srcChain: "base",
      dstChain: "soneium",
      srcToken: WBTC_OFT_TOKEN,
      dstToken: WBTC_OFT_TOKEN,
      amount: "10000",
      inputUsd: 7.5,
      knownCostUsd: 0.52,
      netEdgeUsd: -0.58,
      executableNetEdgeUsd: null,
      routeFailureRate: 0,
      tradeReadiness: "insufficient_data",
    },
  });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
});

test("dual wallet cross-chain refill stays conditional even when a source inventory exists", () => {
  const policy = validateTreasuryPolicy({ ...buildDefaultTreasuryPolicy(), walletMode: "dual_wallet" });
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "soneium",
          actual: "0",
          actualDecimal: 0,
          estimatedUsd: 0,
        },
      ],
      tokens: [
        {
          chain: "base",
          actual: "25000",
          actualDecimal: 0.00025,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 18.5,
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "soneium",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "same_chain_native_transfer");
  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[0].selectedSource.source.chain, "soneium");
  assert.equal(funding.selections[0].missingInputs.includes("reserve_state_unmodelled"), true);
  assert.equal(funding.reasons.includes("reserve_state_unmodelled"), true);
});
