import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFundingSourcePlan } from "../src/treasury/funding-source-planner.mjs";
import { buildTreasuryRefillJobs } from "../src/treasury/refill-job.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../src/treasury/policy.mjs";

function planFixture(decision = "REVIEW_REFILL_PLAN") {
  return {
    schemaVersion: 1,
    observedAt: "2026-04-11T03:30:00.000Z",
    address: "0x000000000000000000000000000000000000dEaD",
    decision,
    inventory: {
      native: [{ chain: "bob", actual: "10000000000000000", actualDecimal: 0.01, estimatedUsd: 22 }],
      tokens: [{ chain: "bob", actual: "50000", actualDecimal: 0.0005, token: "0x0555", ticker: "wBTC.OFT", estimatedUsd: 35 }],
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
        token: "0x0555",
        refillAmount: "25000",
        refillAmountDecimal: 0.00025,
        refillEstimatedUsd: 17.5,
        rationale: "Route token buffer",
      },
    ],
  };
}

test("refill jobs are deterministic and carry execution constraints", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const fundingSourcePlan = buildFundingSourcePlan({ plan: planFixture(), policy });
  const jobs = buildTreasuryRefillJobs({ plan: planFixture(), policy, fundingSourcePlan });

  assert.equal(jobs.requiresManualReview, true);
  assert.equal(jobs.jobs.length, 2);
  assert.equal(jobs.jobs[0].constraints.requireEmergencyStopClear, true);
  assert.equal(jobs.jobs[0].executionMethod, "same_chain_token_to_native_swap");
  assert.equal(jobs.jobs[1].executionMethod, "same_chain_native_to_token_swap");
  assert.equal(jobs.jobs[0].candidateMethods.some((item) => item.method === "same_chain_token_to_native_swap"), true);
  assert.equal(jobs.jobs[0].candidateMethods.find((item) => item.method === "same_chain_token_to_native_swap").source.chain, "bob");
  assert.equal(jobs.jobs[0].fundingSource.selectionStatus, "ready");
  assert.equal(jobs.jobs[0].jobId, buildTreasuryRefillJobs({ plan: planFixture(), policy, fundingSourcePlan }).jobs[0].jobId);
});

test("refill jobs stop requiring manual review when plan is refill-ready", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const fundingSourcePlan = buildFundingSourcePlan({ plan: planFixture("REFILL_REQUIRED"), policy });
  const jobs = buildTreasuryRefillJobs({ plan: planFixture("REFILL_REQUIRED"), policy, fundingSourcePlan });

  assert.equal(jobs.requiresManualReview, false);
  assert.equal(jobs.summary.highPriorityCount, 1);
  assert.equal(jobs.summary.mediumPriorityCount, 1);
});

test("refill jobs preserve strategy policy metadata for holding-period carry funding", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        refillAmount: "74000000",
        refillAmountDecimal: 74,
        refillEstimatedUsd: 74,
        rationale: "Merkl portfolio live-capital validation float.",
        strategyPolicy: {
          id: "merkl_portfolio_stable_carry_refill",
          category: "yield",
          economicsMode: "holding_period_carry",
          perTradeCapUsd: 75,
        },
      },
    ],
    inventory: {
      native: [{ chain: "base", actualDecimal: 0.005 }],
      tokens: [],
    },
  };
  const fundingSourcePlan = buildFundingSourcePlan({ plan, policy });
  const jobs = buildTreasuryRefillJobs({ plan, policy, fundingSourcePlan });

  assert.equal(jobs.jobs.length, 1);
  assert.equal(jobs.jobs[0].strategyPolicy.id, "merkl_portfolio_stable_carry_refill");
  assert.equal(jobs.jobs[0].strategyPolicy.economicsMode, "holding_period_carry");
});

test("refill jobs defer bridge methods above discretionary quote-cost ceiling", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        refillAmount: "74000000",
        refillAmountDecimal: 74,
        refillEstimatedUsd: 74,
        rationale: "Bridge-dependent destination inventory.",
      },
    ],
  };
  const jobs = buildTreasuryRefillJobs({
    plan,
    policy,
    fundingSourcePlan: {
      selections: [
        {
          resourceKey: "base:0x833589fcD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(),
          actionType: "refill_token",
          chain: "base",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          selectionStatus: "ready",
          selectedMethod: "cross_chain_bridge_lifi",
          selectedSource: { source: { chain: "ethereum", token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" } },
          expectedExecutionRefillCostUsd: 1.6,
          expectedReserveReplenishmentCostUsd: 0,
          requiresManualFunding: false,
          requiresReserveState: false,
          missingInputs: [],
          settlementRequirements: [],
          candidates: [],
        },
      ],
    },
  });

  assert.equal(jobs.jobs[0].requiresManualReview, true);
  assert.equal(jobs.jobs[0].reviewReasons.includes("bridge_quote_cost_above_discretionary_ceiling"), true);
});

test("refill jobs keep explicit live destination-inventory override bridgeable", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        refillAmount: "74000000",
        refillAmountDecimal: 74,
        refillEstimatedUsd: 74,
        rationale: "Live destination inventory dependency.",
        liveInventoryDependencyOverride: true,
      },
    ],
  };
  const jobs = buildTreasuryRefillJobs({
    plan,
    policy,
    fundingSourcePlan: {
      selections: [
        {
          resourceKey: "base:0x833589fcD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(),
          actionType: "refill_token",
          chain: "base",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          selectionStatus: "ready",
          selectedMethod: "cross_chain_bridge_lifi",
          selectedSource: { source: { chain: "ethereum", token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" } },
          expectedExecutionRefillCostUsd: 1.25,
          expectedReserveReplenishmentCostUsd: 0,
          requiresManualFunding: false,
          requiresReserveState: false,
          missingInputs: [],
          settlementRequirements: [],
          candidates: [],
        },
      ],
    },
  });

  assert.equal(jobs.jobs[0].requiresManualReview, false);
  assert.equal(jobs.jobs[0].liveInventoryDependencyOverride, true);
});

test("dual wallet mode prefers reserve transfers", () => {
  const policy = validateTreasuryPolicy({ ...buildDefaultTreasuryPolicy(), walletMode: "dual_wallet" });
  const fundingSourcePlan = buildFundingSourcePlan({ plan: planFixture("REFILL_REQUIRED"), policy });
  const jobs = buildTreasuryRefillJobs({ plan: planFixture("REFILL_REQUIRED"), policy, fundingSourcePlan });

  assert.equal(jobs.jobs[0].executionMethod, "same_chain_native_transfer");
  assert.equal(jobs.jobs[1].executionMethod, "same_chain_token_transfer");
  assert.equal(jobs.jobs[0].fundingSource.requiresReserveState, true);
});

test("refill jobs tolerate a selection without selected source details", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const fundingSourcePlan = {
    ...buildFundingSourcePlan({ plan: planFixture(), policy }),
    selections: [
      {
        actionType: "refill_native",
        chain: "bob",
        asset: "ETH",
        resourceKey: "bob:native",
        selectionStatus: "waiting_inputs",
        selectedMethod: "manual_funding_required",
        selectedSource: null,
        expectedExecutionRefillCostUsd: null,
        expectedReserveReplenishmentCostUsd: null,
        requiresManualFunding: true,
        requiresReserveState: false,
        missingInputs: ["selected_source"],
      },
      {
        actionType: "refill_token",
        chain: "bob",
        token: "0x0555",
        ticker: "wBTC.OFT",
        resourceKey: "bob:0x0555",
        selectionStatus: "ready",
        selectedMethod: "same_chain_native_to_token_swap",
        selectedSource: { source: "same_chain_native_balance" },
        expectedExecutionRefillCostUsd: 0.01,
        expectedReserveReplenishmentCostUsd: 0,
        requiresManualFunding: false,
        requiresReserveState: false,
        missingInputs: [],
      },
    ],
  };
  const jobs = buildTreasuryRefillJobs({ plan: planFixture(), policy, fundingSourcePlan });

  assert.equal(jobs.jobs[0].fundingSource.source, null);
});

test("refill jobs use route candidates that match each action chain instead of one global fallback", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    ...planFixture("REFILL_REQUIRED"),
    actions: [
      {
        type: "refill_native",
        chain: "bera",
        asset: "BERA",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "10000000000000000",
        refillAmountDecimal: 0.01,
        refillEstimatedUsd: 0.004,
        rationale: "Expansion chain bootstrap",
      },
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
    inventory: {
      native: [{ chain: "base", actualDecimal: 0.005 }],
      tokens: [{ chain: "base", actual: "5000", actualDecimal: 0.00005, token: "0x0555", ticker: "wBTC.OFT", estimatedUsd: 3.5 }],
    },
  };
  const fundingSourcePlan = buildFundingSourcePlan({
    plan,
    policy,
    routeContext: {
      routeKey: "avalanche:0x0555->bera:0x0555",
      srcChain: "avalanche",
      dstChain: "bera",
      srcToken: "0x0555",
      dstToken: "0x0555",
      amount: "10000",
      inputUsd: 7.5,
      knownCostUsd: 0.52,
      netEdgeUsd: -0.56,
      executableNetEdgeUsd: null,
      routeFailureRate: 0,
      tradeReadiness: "insufficient_data",
    },
  });
  const jobs = buildTreasuryRefillJobs({
    plan,
    policy,
    fundingSourcePlan,
    routeCandidates: [
      {
        routeKey: "base:0x0555->bera:0x0555",
        srcChain: "base",
        dstChain: "bera",
        srcToken: "0x0555",
        dstToken: "0x0555",
        viableForPrep: false,
        txReady: true,
        blockerCount: 1,
        prepFundingUsd: 0,
        amount: "10000",
        inputUsd: 7.5,
        knownCostUsd: 0.54,
        netEdgeUsd: -0.58,
        executableNetEdgeUsd: null,
        routeFailureRate: 0,
        tradeReadiness: "insufficient_data",
      },
      {
        routeKey: "avalanche:0x0555->bera:0x0555",
        srcChain: "avalanche",
        dstChain: "bera",
        srcToken: "0x0555",
        dstToken: "0x0555",
        viableForPrep: false,
        txReady: true,
        blockerCount: 0,
        prepFundingUsd: 0,
        amount: "10000",
        inputUsd: 7.5,
        knownCostUsd: 0.52,
        netEdgeUsd: -0.56,
        executableNetEdgeUsd: null,
        routeFailureRate: 0,
        tradeReadiness: "insufficient_data",
      },
      {
        routeKey: "base:0x0555->soneium:0x0555",
        srcChain: "base",
        dstChain: "soneium",
        srcToken: "0x0555",
        dstToken: "0x0555",
        viableForPrep: false,
        txReady: true,
        blockerCount: 0,
        prepFundingUsd: 0,
        amount: "10000",
        inputUsd: 7.5,
        knownCostUsd: 0.52,
        netEdgeUsd: -0.67,
        executableNetEdgeUsd: null,
        routeFailureRate: 0,
        tradeReadiness: "insufficient_data",
      },
    ],
  });

  assert.equal(jobs.jobs[0].chain, "bera");
  assert.equal(jobs.jobs[0].systemEconomics.routeKey, "base:0x0555->bera:0x0555");
  assert.equal(jobs.jobs[1].chain, "soneium");
  assert.equal(jobs.jobs[1].systemEconomics.routeKey, "base:0x0555->soneium:0x0555");
  assert.notEqual(jobs.jobs[0].systemEconomics.effectiveSystemNetPnlUsd, jobs.jobs[1].systemEconomics.effectiveSystemNetPnlUsd);
  assert.equal(jobs.jobs[0].systemEconomics.executionRefillExpectedCostUsd, jobs.jobs[0].fundingSource.expectedExecutionRefillCostUsd);
  assert.equal(jobs.jobs[1].systemEconomics.executionRefillExpectedCostUsd, jobs.jobs[1].fundingSource.expectedExecutionRefillCostUsd);
});

test("refill jobs combine pending overflow review with non-ready funding-source reasons", () => {
  const basePolicy = buildDefaultTreasuryPolicy();
  const policy = validateTreasuryPolicy({
    ...basePolicy,
    refillPolicy: {
      ...basePolicy.refillPolicy,
      maxPendingJobs: 4,
    },
  });
  const plan = {
    ...planFixture("REVIEW_REFILL_PLAN"),
    reasons: ["too_many_pending_refills"],
    actions: [
      {
        type: "refill_native",
        chain: "bera",
        asset: "BERA",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "10000000000000000",
        refillAmountDecimal: 0.01,
        refillEstimatedUsd: 0.004,
        rationale: "Expansion chain bootstrap",
      },
      {
        type: "refill_native",
        chain: "bsc",
        asset: "BNB",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 0.6,
        rationale: "Expansion chain bootstrap",
      },
      {
        type: "refill_native",
        chain: "ethereum",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
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
      {
        type: "refill_native",
        chain: "unichain",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "1000000000000000",
        refillAmountDecimal: 0.001,
        refillEstimatedUsd: 2.2,
        rationale: "Expansion chain bootstrap",
      },
    ],
    inventory: {
      native: [{ chain: "base", actualDecimal: 0.005 }],
      tokens: [{ chain: "base", actual: "5000", actualDecimal: 0.00005, token: "0x0555", ticker: "wBTC.OFT", estimatedUsd: 3.5 }],
    },
  };
  const fundingSourcePlan = buildFundingSourcePlan({
    plan,
    policy,
    routeContext: {
      routeKey: "base:0x0555->bera:0x0555",
      srcChain: "base",
      dstChain: "bera",
      srcToken: "0x0555",
      dstToken: "0x0555",
      amount: "10000",
      inputUsd: 7.5,
      knownCostUsd: 0.52,
      netEdgeUsd: -0.57,
      executableNetEdgeUsd: null,
      routeFailureRate: 0,
      tradeReadiness: "insufficient_data",
    },
  });
  const jobs = buildTreasuryRefillJobs({ plan, policy, fundingSourcePlan });

  assert.equal(jobs.requiresManualReview, true);
  assert.equal(jobs.summary.manualReviewJobCount, 1);
  assert.equal(jobs.summary.autoQueuedJobCount, 4);
  assert.equal(jobs.jobs.filter((job) => job.requiresManualReview).length, 1);
  assert.equal(jobs.jobs.some((job) => job.reviewReasons.includes("too_many_pending_refills")), true);
  assert.equal(jobs.jobs.some((job) => job.reviewReasons.includes("too_many_pending_refills")), true);
  assert.equal(jobs.jobs.every((job) => !job.reviewReasons.includes("cross_chain_native_refill_executor_missing")), true);
});

test("refill jobs apply daily cost cap to ranked overflow instead of blocking every job", () => {
  const policy = validateTreasuryPolicy({
    ...buildDefaultTreasuryPolicy(),
    capital: {
      ...buildDefaultTreasuryPolicy().capital,
      maxRefillCost24hUsd: 0.5,
    },
    refillPolicy: {
      ...buildDefaultTreasuryPolicy().refillPolicy,
      maxPendingJobs: 5,
    },
  });
  const plan = {
    ...planFixture("REVIEW_REFILL_PLAN"),
    reasons: ["refill_cost_above_daily_cap"],
    actions: [
      {
        type: "refill_native",
        chain: "bera",
        asset: "BERA",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "10000000000000000",
        refillAmountDecimal: 0.01,
        refillEstimatedUsd: 0.004,
        rationale: "Expansion chain bootstrap",
      },
      {
        type: "refill_native",
        chain: "optimism",
        asset: "ETH",
        token: "0x0000000000000000000000000000000000000000",
        refillAmount: "100000000000000",
        refillAmountDecimal: 0.0001,
        refillEstimatedUsd: 0.22,
        rationale: "Expansion chain bootstrap",
      },
      {
        type: "refill_token",
        chain: "ethereum",
        ticker: "wBTC.OFT",
        token: "0x0555",
        refillAmount: "10000",
        refillAmountDecimal: 0.0001,
        refillEstimatedUsd: 7.5,
        rationale: "Gateway buffer",
      },
    ],
    inventory: {
      native: [{ chain: "base", actualDecimal: 0.005 }],
      tokens: [{ chain: "base", actual: "50000", actualDecimal: 0.0005, token: "0x0555", ticker: "wBTC.OFT", estimatedUsd: 35 }],
    },
  };
  const fundingSourcePlan = buildFundingSourcePlan({ plan, policy });
  const jobs = buildTreasuryRefillJobs({ plan, policy, fundingSourcePlan });

  assert.equal(jobs.summary.autoQueuedJobCount > 0, true);
  assert.equal(jobs.summary.manualReviewJobCount > 0, true);
  assert.equal(jobs.jobs.some((job) => !job.requiresManualReview), true);
  assert.equal(jobs.jobs.some((job) => job.reviewReasons.includes("refill_cost_above_daily_cap")), true);
  assert.equal(jobs.jobs.every((job) => job.reviewReasons.filter((reason) => reason === "refill_cost_above_daily_cap").length <= 1), true);
});

test("refill jobs prefer higher-net fallback route context over weaker local matches", () => {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const plan = {
    schemaVersion: 1,
    observedAt: "2026-04-18T19:17:21.910Z",
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    decision: "REVIEW_REFILL_PLAN",
    inventory: {
      native: [{ chain: "base", actual: "200000000000000000", actualDecimal: 0.2, estimatedUsd: 400 }],
      tokens: [{ chain: "base", actual: "863020", actualDecimal: 0.86302, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", ticker: "USDC" }],
    },
    reasons: ["refill_cost_above_daily_cap", "too_many_pending_refills"],
    actions: [
      {
        type: "refill_token",
        chain: "base",
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        refillAmount: "299136980",
        refillAmountDecimal: 299.13698,
        refillEstimatedUsd: 299.13698,
        rationale: "Positive Base USDC->native BTC offramp candidate needs source-token inventory before exact-gas validation can graduate it.",
      },
    ],
  };
  const fundingSourcePlan = buildFundingSourcePlan({
    plan,
    policy,
    routeContext: {
      routeKey: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
      srcChain: "base",
      dstChain: "bitcoin",
      srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      dstToken: "0x0000000000000000000000000000000000000000",
      amount: "250122268",
      inputUsd: 250.74757366999998,
      prepFundingUsd: 249.259248,
      netEdgeUsd: 1.7505430945203104,
      executableNetEdgeUsd: null,
      knownCostUsd: 0.1391156862,
      routeFailureRate: 0.1111111111111111,
      tradeReadiness: "insufficient_data",
    },
  });
  const jobs = buildTreasuryRefillJobs({
    plan,
    policy,
    fundingSourcePlan,
    routeCandidates: [
      {
        routeKey: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
        srcChain: "base",
        dstChain: "bitcoin",
        srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        dstToken: "0x0000000000000000000000000000000000000000",
        viableForPrep: false,
        txReady: true,
        blockerCount: 0,
        prepFundingUsd: 99.25,
        amount: "100000000",
        inputUsd: 100.25,
        knownCostUsd: 0.9062857618286819,
        netEdgeUsd: -2.3989955074786855,
        executableNetEdgeUsd: null,
        routeFailureRate: 0.1111111111111111,
        tradeReadiness: "insufficient_data",
      },
    ],
  });

  assert.equal(jobs.jobs.length, 1);
  assert.equal(
    jobs.jobs[0].systemEconomics.routeKey,
    "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
  );
  assert.equal(jobs.jobs[0].systemEconomics.amount, "250122268");
  assert.equal(jobs.jobs[0].systemEconomics.routeNetEdgeUsd, 1.7505430945203104);
  assert.ok(jobs.jobs[0].systemEconomics.effectiveSystemNetPnlUsd > 0);
});
