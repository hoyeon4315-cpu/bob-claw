import assert from "node:assert/strict";
import { test } from "node:test";
import { ETHEREUM_WBTC_TOKEN, WBTC_OFT_TOKEN, WRAPPED_NATIVE_TOKENS, ZERO_TOKEN } from "../src/assets/tokens.mjs";
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
          actual: "10000000000000000",
          actualDecimal: 0.01,
          estimatedUsd: 22,
        },
      ],
      tokens: [
        {
          chain: "bob",
          actual: "50000",
          actualDecimal: 0.0005,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 35,
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
  const plan = planFixture();
  plan.inventory.native[0].chain = "base";
  plan.inventory.tokens[0].chain = "base";
  plan.actions[0].chain = "base";
  plan.actions[1].chain = "base";
  const funding = buildFundingSourcePlan({
    plan,
    policy,
    routeContext: {
      routeKey: "base:0x0555->base:0x0555",
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

test("same-chain swap refill stays conditional when chain has no deterministic DEX executor", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({ plan: planFixture("REFILL_REQUIRED"), policy });

  assert.equal(funding.selections[0].selectedMethod, "same_chain_token_to_native_swap");
  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[0].missingInputs.includes("same_chain_dex_executor_missing"), true);
  assert.equal(funding.selections[1].selectedMethod, "same_chain_native_to_token_swap");
  assert.equal(funding.selections[1].selectionStatus, "conditional");
  assert.equal(funding.selections[1].missingInputs.includes("same_chain_dex_executor_missing"), true);
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
  assert.equal(funding.selections[0].missingInputs.includes("stranded_same_chain_token_inventory_without_native"), true);
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
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
  assert.equal(funding.selections[0].missingInputs.includes("cross_chain_source_selection_missing"), false);
  assert.equal(funding.selections[0].missingInputs.includes("cross_chain_native_refill_executor_missing"), false);
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

test("Soneium Gateway route gaps keep LI.FI in the deterministic fallback ladder", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: {
      ...planFixture("REFILL_REQUIRED"),
      inventory: {
        native: [],
        tokens: [
          {
            chain: "base",
            actual: "5000000",
            actualDecimal: 5,
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            ticker: "USDC",
            estimatedUsd: 5,
          },
        ],
      },
      actions: [
        {
          type: "refill_token",
          chain: "soneium",
          ticker: "USDC",
          token: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
          refillAmount: "3000000",
          refillAmountDecimal: 3,
          refillEstimatedUsd: 3,
          rationale: "Soneium representative USDC bootstrap",
        },
      ],
    },
    policy,
  });

  const methods = funding.selections[0].candidates.map((candidate) => candidate.method);
  assert.ok(methods.indexOf("cross_chain_bridge_lifi") > methods.indexOf("cross_chain_bridge_across"));
  assert.ok(methods.includes("cross_chain_bridge_stargate"));
});

test("Gateway-healthy stable refill still retains live alternate bridges as standby candidates", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: {
      ...planFixture("REFILL_REQUIRED"),
      inventory: {
        native: [],
        tokens: [
          {
            chain: "base",
            actual: "5000000",
            actualDecimal: 5,
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            ticker: "USDC",
            estimatedUsd: 5,
          },
        ],
      },
      actions: [
        {
          type: "refill_token",
          chain: "unichain",
          ticker: "USDC",
          token: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
          refillAmount: "3000000",
          refillAmountDecimal: 3,
          refillEstimatedUsd: 3,
          rationale: "Unichain stable bootstrap",
        },
      ],
    },
    policy,
    gatewayAvailability: { available: true, reason: null, observedAt: "2026-04-24T00:00:00.000Z" },
  });

  const selection = funding.selections[0];
  const methods = selection.candidates.map((candidate) => candidate.method);
  assert.ok(methods.includes("cross_chain_swap_via_btc_intermediate"));
  assert.ok(methods.includes("cross_chain_bridge_across"));
  assert.ok(methods.includes("cross_chain_bridge_lifi"));
  assert.equal(selection.selectedMethod, "cross_chain_swap_via_btc_intermediate");
  assert.equal(selection.candidates.find((candidate) => candidate.method === "cross_chain_bridge_across").standbyFallback, true);
  assert.equal(selection.candidates.find((candidate) => candidate.method === "cross_chain_bridge_lifi").standbyFallback, true);
});

test("alternate bridge candidates use USD coverage for cross-asset token refills", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const baseCbbtc = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  const ethereumRlusd = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD";
  const funding = buildFundingSourcePlan({
    plan: {
      ...planFixture("REFILL_REQUIRED"),
      inventory: {
        native: [],
        tokens: [
          {
            chain: "base",
            token: baseCbbtc,
            ticker: "cbBTC",
            actual: "40214",
            actualDecimal: 0.00040214,
            estimatedUsd: 31.49,
          },
        ],
      },
      actions: [
        {
          type: "refill_token",
          chain: "ethereum",
          ticker: "RLUSD",
          token: ethereumRlusd,
          refillAmount: "25288497754491860000",
          refillAmountDecimal: 25.28849775449186,
          refillEstimatedUsd: 25.29,
          rationale: "Ethereum RLUSD strategy refill",
        },
      ],
    },
    policy,
    gatewayAvailability: { available: true, reason: null, observedAt: "2026-05-02T00:00:00.000Z" },
  });

  const lifi = funding.selections[0].candidates.find((candidate) => candidate.method === "cross_chain_bridge_lifi");
  assert.ok(lifi);
  assert.equal(lifi.source.chain, "base");
  assert.equal(lifi.source.token, baseCbbtc);
  assert.equal(lifi.missingInputs.includes("source_inventory_below_target_amount"), false);
});

test("alternate bridge candidates allow high-coverage same-token wrapped BTC partial refills", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: {
      ...planFixture("REFILL_REQUIRED"),
      inventory: {
        native: [],
        tokens: [
          {
            chain: "base",
            token: WBTC_OFT_TOKEN,
            ticker: "wBTC.OFT",
            actual: "9000",
            actualDecimal: 0.00009,
            estimatedUsd: 7.2,
          },
        ],
      },
      actions: [
        {
          type: "refill_token",
          chain: "unichain",
          ticker: "wBTC.OFT",
          token: WBTC_OFT_TOKEN,
          refillAmount: "10000",
          refillAmountDecimal: 0.0001,
          refillEstimatedUsd: 8,
          rationale: "Unichain wrapped BTC refill",
        },
      ],
    },
    policy,
    gatewayAvailability: { available: true, reason: null, observedAt: "2026-05-02T00:00:00.000Z" },
  });

  const lifi = funding.selections[0].candidates.find((candidate) => candidate.method === "cross_chain_bridge_lifi");
  assert.ok(lifi);
  assert.equal(lifi.missingInputs.includes("source_inventory_below_target_amount"), false);
});

test("Ethereum WBTC target can use value coverage from cross-chain wBTC.OFT inventory", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: {
      ...planFixture("REFILL_REQUIRED"),
      inventory: {
        native: [],
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
      actions: [
        {
          type: "refill_token",
          chain: "ethereum",
          ticker: "WBTC",
          token: ETHEREUM_WBTC_TOKEN,
          refillAmount: "38367",
          refillAmountDecimal: 0.00038367,
          refillEstimatedUsd: 30.7,
          rationale: "Ethereum canonical WBTC refill",
        },
      ],
    },
    policy,
    gatewayAvailability: { available: true, reason: null, observedAt: "2026-05-02T00:00:00.000Z" },
  });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
});

test("representative stable token refills use ticker fallback when token registry family is absent", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const funding = buildFundingSourcePlan({
    plan: {
      ...planFixture("REFILL_REQUIRED"),
      inventory: {
        native: [
          {
            chain: "optimism",
            actual: "5000000000000000",
            actualDecimal: 0.005,
            estimatedUsd: 10,
          },
        ],
        tokens: [],
      },
      actions: [
        {
          type: "refill_token",
          chain: "soneium",
          ticker: "USDC",
          token: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
          refillAmount: "4000000",
          refillAmountDecimal: 4,
          refillEstimatedUsd: 4,
          rationale: "Soneium representative USDC bootstrap",
        },
      ],
    },
    policy,
  });

  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[0].selectedSource.source.chain, "optimism");
  assert.equal(funding.selections[0].missingInputs.includes("destination_dex_executor_missing"), true);
});

test("cross-chain BTC-family token refill stays conditional when observed source amount is below target", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [],
      tokens: [
        {
          chain: "base",
          actual: "5000",
          actualDecimal: 0.00005,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 3.7,
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

  const crossChainCandidate = funding.selections[0].candidates.find((item) => item.method === "cross_chain_bridge_or_swap");
  assert.equal(crossChainCandidate.availability, "conditional");
  assert.equal(crossChainCandidate.source.chain, "base");
  assert.equal(crossChainCandidate.missingInputs.includes("source_inventory_below_target_amount"), true);
});

test("cross-chain BTC-family token refill stays conditional when same-token partial coverage is below threshold", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [],
      tokens: [
        {
          chain: "base",
          actual: "8400",
          actualDecimal: 0.000084,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 6.72,
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
        refillEstimatedUsd: 8,
        rationale: "Route token buffer",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  const crossChainCandidate = funding.selections[0].candidates.find((item) => item.method === "cross_chain_bridge_or_swap");
  assert.equal(crossChainCandidate.availability, "conditional");
  assert.equal(crossChainCandidate.source.chain, "base");
  assert.equal(crossChainCandidate.missingInputs.includes("source_inventory_below_target_amount"), true);
});

test("cross-chain token refill prefers executable wrapped BTC over larger unsupported stablecoin inventory", () => {
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
        {
          chain: "bsc",
          actual: "300000000",
          actualDecimal: 300,
          token: "0x55d398326f99059fF775485246999027B3197955",
          ticker: "USDT",
          estimatedUsd: 300,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "soneium",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "10000",
        refillAmountDecimal: 0.0001,
        refillEstimatedUsd: 7.4,
        rationale: "Settlement reserve shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
});

test("cross-chain BTC-family refill prefers direct wBTC.OFT source over larger BTC wrapper that needs source swap", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const baseCbBtc = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [],
      tokens: [
        {
          chain: "base",
          actual: "26184",
          actualDecimal: 0.00026184,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 20.72,
        },
        {
          chain: "base",
          actual: "30777",
          actualDecimal: 0.00030777,
          token: baseCbBtc,
          ticker: "cbBTC",
          estimatedUsd: 24.34,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "ethereum",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "24825",
        refillAmountDecimal: 0.00024825,
        refillEstimatedUsd: 19.64,
        rationale: "Ethereum settlement reserve shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
});

test("cross-chain stable refill prefers wrapped BTC source over larger native inventory when destination DEX is supported", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const optimismUsdc = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "ethereum",
          actual: "11000000000000000",
          actualDecimal: 0.011,
          estimatedUsd: 21,
        },
      ],
      tokens: [
        {
          chain: "base",
          actual: "26184",
          actualDecimal: 0.00026184,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 20.74,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "optimism",
        ticker: "USDC",
        token: optimismUsdc,
        refillAmount: "3000000",
        refillAmountDecimal: 3,
        refillEstimatedUsd: 3,
        rationale: "Representative stablecoin reserve shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
});

test("cross-chain stable refill stays conditional when destination DEX executor is missing", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const bobUsdc = "0xe75D0fB2C24A55cA1e3F96781a2bCC7bdba058F0";
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "ethereum",
          actual: "11000000000000000",
          actualDecimal: 0.011,
          estimatedUsd: 21,
        },
      ],
      tokens: [
        {
          chain: "base",
          actual: "26184",
          actualDecimal: 0.00026184,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 20.74,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "bob",
        ticker: "USDC",
        token: bobUsdc,
        refillAmount: "3000000",
        refillAmountDecimal: 3,
        refillEstimatedUsd: 3,
        rationale: "Representative stablecoin reserve shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(funding.selections[0].missingInputs.includes("destination_dex_executor_missing"), true);
});

test("token refill prefers cross-chain wrapped BTC when same-chain native inventory is too small", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "soneium",
          actual: "20000000000000",
          actualDecimal: 0.00002,
          estimatedUsd: 0.04,
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
        type: "refill_token",
        chain: "soneium",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "10000",
        refillAmountDecimal: 0.0001,
        refillEstimatedUsd: 7.4,
        rationale: "Settlement reserve shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(
    funding.selections[0].candidates.find((item) => item.method === "same_chain_native_to_token_swap").missingInputs.includes("source_inventory_below_target_amount"),
    true,
  );
});

test("token refill uses same-chain token inventory for a source-limited yield partial refill", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const baseCbbtc = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "base",
          actual: "2951182258674551",
          actualDecimal: 0.002951182258674551,
          estimatedUsd: 7.03,
        },
      ],
      tokens: [
        {
          chain: "base",
          actual: "47345000",
          actualDecimal: 0.00047345,
          token: baseCbbtc,
          ticker: "cbBTC",
          estimatedUsd: 38.66,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "USDC",
        token: baseUsdc,
        refillAmount: "67807303",
        refillAmountDecimal: 67.807303,
        refillEstimatedUsd: 67.807303,
        rationale: "Merkl portfolio live-capital validation float on Base",
        strategyPolicy: {
          id: "merkl_portfolio_stable_carry_refill",
          strategyType: "merkl_portfolio_stable_carry",
          perTradeCapUsd: 75,
        },
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "same_chain_token_to_token_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "cbBTC");
  assert.equal(funding.selections[0].missingInputs.includes("source_inventory_below_target_amount"), false);
  assert.equal(funding.selections[0].selectedSource.partialRefill, true);
  assert.equal(funding.selections[0].selectedSource.partialRefillEstimatedUsd > 20, true);
});

test("cross-chain token refill prefers a source that covers target over an undersized preferred route source", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "bitcoin",
          actual: "13017",
          actualDecimal: 0.00013017,
          estimatedUsd: 10.12,
        },
      ],
      tokens: [
        {
          chain: "ethereum",
          actual: "111711812",
          actualDecimal: 111.711812,
          token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ticker: "USDC",
          estimatedUsd: 111.711812,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "400510",
        refillAmountDecimal: 0.00040051,
        refillEstimatedUsd: 31.02,
        rationale: "Score-weighted settlement reserve shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({
    plan,
    policy,
    routeContext: {
      srcChain: "bitcoin",
      srcToken: ZERO_TOKEN,
      dstChain: "base",
      dstToken: WBTC_OFT_TOKEN,
      amount: "13017",
      inputUsd: 10.12,
      netEdgeUsd: -0.1,
    },
  });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_swap_via_btc_intermediate");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.chain, "ethereum");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "USDC");
  assert.equal(funding.selections[0].missingInputs.includes("source_inventory_below_target_amount"), false);
});

test("native refill does not treat undersized same-chain token inventory as ready", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "soneium",
          actual: "10000000000000",
          actualDecimal: 0.00001,
          estimatedUsd: 0.02,
        },
      ],
      tokens: [
        {
          chain: "soneium",
          actual: "1100",
          actualDecimal: 0.000011,
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          estimatedUsd: 0.82,
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "soneium",
        asset: "ETH",
        token: ZERO_TOKEN,
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectionStatus, "conditional");
  assert.equal(
    funding.selections[0].candidates.find((item) => item.method === "same_chain_token_to_native_swap").missingInputs.includes("source_inventory_below_target_amount"),
    true,
  );
});

test("native refill prefers same-chain wrapped-native inventory for direct unwrap", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "base",
          actual: "1000000000000000",
          actualDecimal: 0.001,
          estimatedUsd: 2.3,
        },
      ],
      tokens: [
        {
          chain: "base",
          actual: "8500000000000000",
          actualDecimal: 0.0085,
          token: WRAPPED_NATIVE_TOKENS.base,
          ticker: "WETH",
          estimatedUsd: 19.55,
        },
        {
          chain: "base",
          actual: "40214",
          actualDecimal: 0.00040214,
          token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
          ticker: "cbBTC",
          estimatedUsd: 31.5,
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "base",
        asset: "ETH",
        token: ZERO_TOKEN,
        refillAmount: "7500000000000000",
        refillAmountDecimal: 0.0075,
        refillEstimatedUsd: 17.25,
        rationale: "Base gas float keeper target shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "same_chain_token_to_native_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.token, WRAPPED_NATIVE_TOKENS.base);
  assert.equal(funding.selections[0].selectedSource.source.ticker, "WETH");
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

test("funding source planner prefers fresher larger supplemental native BTC over stale smaller primary BTC", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "bitcoin",
          actual: "2650",
          actualDecimal: 0.0000265,
          estimatedUsd: 2.14,
          source: "stale_dashboard_status_snapshot",
        },
      ],
      tokens: [],
    },
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "10000",
        refillAmountDecimal: 0.0001,
        refillEstimatedUsd: 8.07,
        rationale: "Bootstrap Base wrapped BTC from operator BTC funding address",
      },
    ],
  };

  const funding = buildFundingSourcePlan({
    plan,
    policy,
    supplementalInventory: {
      native: [
        {
          chain: "bitcoin",
          token: ZERO_TOKEN,
          balance: "620483",
          actualDecimal: 0.00620483,
          estimatedUsd: 500.61,
          source: "signer_whole_wallet_live_scan",
        },
      ],
      tokenBalances: [],
    },
  });

  assert.equal(funding.selections[0].selectedSource.source.chain, "bitcoin");
  assert.equal(funding.selections[0].selectedSource.source.actual, "620483");
  assert.equal(funding.selections[0].selectedSource.missingInputs.includes("source_inventory_below_target_amount"), false);
});

test("funding source planner excludes protocol-reader-covered position tokens as spendable refill sources", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const protocolShareToken = "0x0000000f2eb9f69274678c76222b35eec7588a65";
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [
        {
          chain: "base",
          actual: "1000000000000000",
          actualDecimal: 0.001,
          estimatedUsd: 2.3,
        },
      ],
      tokens: [
        {
          chain: "base",
          token: protocolShareToken,
          ticker: "yoUSD",
          family: "protocol_share",
          actual: "62481796",
          actualDecimal: 62.481796,
          estimatedUsd: 65.46,
          trackingStatus: "protocol_reader_covered",
          countedInWalletTotal: false,
          sourceKinds: ["protocol_position_mark", "signer_audit_intent"],
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "base",
        asset: "ETH",
        token: ZERO_TOKEN,
        refillAmount: "3000000000000000",
        refillAmountDecimal: 0.003,
        refillEstimatedUsd: 6.9,
        rationale: "Base gas float keeper target shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  const candidateSources = funding.selections[0].candidates
    .map((candidate) => candidate.source?.token)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
  assert.equal(candidateSources.includes(protocolShareToken), false);
  assert.equal(funding.selections[0].candidates[0].method, "same_chain_token_to_native_swap");
  assert.equal(funding.selections[0].candidates[0].source, null);
  assert.equal(funding.selections[0].candidates[0].missingInputs.includes("same_chain_token_inventory_missing"), true);
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

test("cross-chain native refill prefers exact route-source wrapped BTC over bitcoin inventory when gas refill is executable", () => {
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
          estimatedUsd: 18.5,
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "soneium",
        asset: "ETH",
        token: ZERO_TOKEN,
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
    supplementalInventory: {
      native: [
        {
          chain: "bitcoin",
          token: ZERO_TOKEN,
          balance: "25000",
          actualDecimal: 0.00025,
          estimatedUsd: 18.5,
        },
      ],
      tokenBalances: [],
    },
  });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
  assert.deepEqual(funding.selections[0].missingInputs, []);
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

test("cross-chain refill from non-BTC source uses intermediate swap method when DEX available", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [],
      tokens: [
        {
          chain: "bsc",
          actual: "300000000",
          actualDecimal: 300,
          token: "0x55d398326f99059fF775485246999027B3197955",
          ticker: "USDT",
          estimatedUsd: 300,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "10000",
        refillAmountDecimal: 0.0001,
        refillEstimatedUsd: 7.4,
        rationale: "Settlement reserve shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_swap_via_btc_intermediate");
  assert.equal(funding.selections[0].selectedSource.source.chain, "bsc");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "USDT");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.deepEqual(funding.selections[0].missingInputs, []);
});

test("cross-chain BSC USDT refill can target Base USDC through BTC intermediate", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [],
      tokens: [
        {
          chain: "bsc",
          actual: "300000000000000000000",
          actualDecimal: 300,
          token: "0x55d398326f99059fF775485246999027B3197955",
          ticker: "USDT",
          estimatedUsd: 300,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        refillAmount: "1000000",
        refillAmountDecimal: 1,
        refillEstimatedUsd: 1,
        rationale: "Base USDC Merkl entry inventory",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_swap_via_btc_intermediate");
  assert.equal(funding.selections[0].selectedSource.source.chain, "bsc");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "USDT");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.deepEqual(funding.selections[0].missingInputs, []);
});

test("cross-chain BSC USDT refill can target Ethereum USDC through BTC intermediate", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [],
      tokens: [
        {
          chain: "bsc",
          actual: "300000000000000000000",
          actualDecimal: 300,
          token: "0x55d398326f99059fF775485246999027B3197955",
          ticker: "USDT",
          estimatedUsd: 300,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "ethereum",
        ticker: "USDC",
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        refillAmount: "1000000",
        refillAmountDecimal: 1,
        refillEstimatedUsd: 1,
        rationale: "Ethereum USDC Merkl entry inventory",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_swap_via_btc_intermediate");
  assert.equal(funding.selections[0].selectedSource.source.chain, "bsc");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "USDT");
  assert.equal(funding.selections[0].selectionStatus, "ready");
  assert.deepEqual(funding.selections[0].missingInputs, []);
});

test("cross-chain refill prefers direct BTC-family source over intermediate swap", () => {
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
        {
          chain: "bsc",
          actual: "300000000",
          actualDecimal: 300,
          token: "0x55d398326f99059fF775485246999027B3197955",
          ticker: "USDT",
          estimatedUsd: 300,
        },
      ],
    },
    actions: [
      {
        type: "refill_token",
        chain: "soneium",
        ticker: "wBTC.OFT",
        token: WBTC_OFT_TOKEN,
        refillAmount: "10000",
        refillAmountDecimal: 0.0001,
        refillEstimatedUsd: 7.4,
        rationale: "Settlement reserve shortfall",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  // Direct BTC-family source should be preferred over intermediate swap
  assert.equal(funding.selections[0].selectedMethod, "cross_chain_bridge_or_swap");
  assert.equal(funding.selections[0].selectedSource.source.chain, "base");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "wBTC.OFT");
});

test("cross-chain native refill from non-BTC source with DEX uses intermediate swap", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    inventory: {
      native: [],
      tokens: [
        {
          chain: "bsc",
          actual: "300000000",
          actualDecimal: 300,
          token: "0x55d398326f99059fF775485246999027B3197955",
          ticker: "USDT",
          estimatedUsd: 300,
        },
      ],
    },
    actions: [
      {
        type: "refill_native",
        chain: "base",
        asset: "ETH",
        token: ZERO_TOKEN,
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
    ],
  };

  const funding = buildFundingSourcePlan({ plan, policy });

  assert.equal(funding.selections[0].selectedMethod, "cross_chain_swap_via_btc_intermediate");
  assert.equal(funding.selections[0].selectedSource.source.chain, "bsc");
  assert.equal(funding.selections[0].selectedSource.source.ticker, "USDT");
});
