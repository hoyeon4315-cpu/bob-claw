import test from "node:test";
import assert from "node:assert/strict";
import {
  activeMerklPortfolioPositions,
  buildMerklPortfolioAllocationPlan,
  executionErrorBlockers,
  merklPortfolioScore,
  parseInsufficientAssetBalance,
  retryAmountFromAvailableBalance,
} from "../src/executor/merkl-portfolio-allocator.mjs";

function queueItem(overrides = {}) {
  return {
    queueId: "merkl:opp-1",
    rank: 1,
    opportunityId: "opp-1",
    chain: "base",
    protocolId: "yo",
    name: "Deposit USDC to YO",
    entryAssets: ["USDC"],
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    executionSurface: "stableCarry",
    campaignRemainingHours: 120,
    expectedHoldDays: 10,
    aprPct: 500,
    estimatedGasCostUsd: 0,
    tvlUsd: 20_000_000,
    score: 86,
    priorityScore: 105,
    overfitRisk: "low",
    capabilityGaps: [],
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
    ...overrides,
  };
}

const inventorySnapshot = {
  native: [
    {
      chain: "base",
      asset: "ETH",
      actual: "1000000000000000",
      actualDecimal: 0.001,
      estimatedUsd: 2,
    },
  ],
  tokens: [
    {
      chain: "base",
      ticker: "USDC",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      actual: "1000000",
      actualDecimal: 1,
      estimatedUsd: 1,
    },
  ],
};

const canaryExecutions = [
  {
    observedAt: "2026-04-24T05:49:13.000Z",
    mode: "execute",
    queueItem: { opportunityId: "opp-1" },
    execution: { settlementStatus: "delivered" },
  },
];

const btcDecisionContext = {
  btcPriceUsd: 100_000,
  btcPriceSnapshotAt: "2026-04-24T06:00:00.000Z",
};

function activePosition({ id, chain, protocolId, amountUsd = 100 }) {
  return {
    event: "position_opened",
    status: "open",
    positionId: id,
    opportunityId: id,
    chain,
    protocolId,
    amountUsd,
  };
}

function inventoryWithUsdc({ chain = "base", usd = 500 } = {}) {
  return {
    native: [{ chain, actual: "1", actualDecimal: 1, estimatedUsd: 20 }],
    tokens: [
      {
        chain,
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        actual: String(Math.floor(usd * 1_000_000)),
        actualDecimal: usd,
        estimatedUsd: usd,
      },
    ],
  };
}

function deliveredProof(opportunityId) {
  return {
    observedAt: "2026-04-24T06:01:00.000Z",
    mode: "execute",
    queueItem: { opportunityId },
    execution: { settlementStatus: "delivered" },
  };
}

test("portfolio score rewards canary-proven inventory-ready opportunities", () => {
  const scored = merklPortfolioScore({
    ...queueItem(),
    executionReadiness: {
      status: "inventory_ready",
      matchedNative: { estimatedUsd: 2 },
    },
  }, { canaryProof: canaryExecutions[0] });

  assert.ok(scored >= 100);
});

test("allocator opens a weighted hold entry only after live canary proof", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions,
    maxUsd: 0.25,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 1,
      perOpportunityMaxUsd: 1,
      maxNewPositionsPerRun: 3,
      minPositionUsd: 0.05,
    },
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 1);
  assert.equal(plan.entryQueue[0].queueItem.opportunityId, "opp-1");
  assert.equal(plan.entryQueue[0].targetAmount, "250000");
  assert.equal(plan.entryQueue[0].targetUsd, 0.25);
});

test("allocator blocks otherwise-ready hold entries when BTC price is unavailable", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions,
    maxUsd: 0.25,
    policy: {
      maxActiveUsd: 1,
      perOpportunityMaxUsd: 1,
      maxNewPositionsPerRun: 3,
      minPositionUsd: 0.05,
    },
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 0);
  assert.ok(plan.allocations[0].blockers.includes("btc_price_required_for_sats_decision"));
});

test("allocator uses portfolio active budget when maxUsd is omitted", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 1,
      perOpportunityMaxUsd: 1,
      maxNewPositionsPerRun: 3,
      minPositionUsd: 0.05,
    },
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.runBudgetUsd, 1);
  assert.equal(plan.summary.entryReadyCount, 1);
  assert.equal(plan.entryQueue[0].targetUsd, 0.95);
  assert.equal(plan.entryQueue[0].targetAmount, "950000");
});

test("allocator treats explicit maxUsd zero as no new run budget", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions,
    maxUsd: 0,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 1,
      perOpportunityMaxUsd: 1,
      maxNewPositionsPerRun: 3,
      minPositionUsd: 0.05,
    },
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.runBudgetUsd, 0);
  assert.equal(plan.summary.entryReadyCount, 0);
});

test("allocator blocks hold entries that have not completed a live canary", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions: [],
    maxUsd: 0.25,
    ...btcDecisionContext,
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 0);
  assert.ok(plan.allocations[0].blockers.includes("live_canary_proof_required_before_hold"));
});

test("allocator emits capital jobs for inventory-missing candidates", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: {
      queue: [
        queueItem({
          opportunityId: "eth-morpho",
          chain: "ethereum",
          capabilityGaps: ["current_inventory_entry_route_required"],
          protocolBindingPlan: {
            status: "binding_ready",
            bindingKind: "erc4626_vault_supply_withdraw",
            resolvedBinding: {
              vaultAddress: "0x1111111111111111111111111111111111111111",
              assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              shareTokenAddress: "0x1111111111111111111111111111111111111111",
              assetSymbol: "USDC",
              assetDecimals: 6,
            },
          },
        }),
      ],
    },
    inventorySnapshot,
    canaryExecutions: [
      {
        observedAt: "2026-04-24T05:49:13.000Z",
        mode: "execute",
        queueItem: { opportunityId: "eth-morpho" },
        execution: { settlementStatus: "delivered" },
      },
    ],
    maxUsd: 0.25,
    ...btcDecisionContext,
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.capitalJobCount, 1);
  assert.equal(plan.capitalJobs[0].chain, "ethereum");
  assert.equal(plan.capitalJobs[0].requiredAsset, "USDC");
});

test("allocator suppresses capital jobs for proof-missing candidates", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: {
      queue: [
        queueItem({
          opportunityId: "eth-morpho",
          chain: "ethereum",
          capabilityGaps: ["current_inventory_entry_route_required"],
          protocolBindingPlan: {
            status: "binding_ready",
            bindingKind: "erc4626_vault_supply_withdraw",
            resolvedBinding: {
              vaultAddress: "0x1111111111111111111111111111111111111111",
              assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              shareTokenAddress: "0x1111111111111111111111111111111111111111",
              assetSymbol: "USDC",
              assetDecimals: 6,
            },
          },
        }),
      ],
    },
    inventorySnapshot,
    canaryExecutions: [],
    maxUsd: 0.25,
    ...btcDecisionContext,
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 0);
  assert.equal(plan.summary.capitalJobCount, 0);
  assert.ok(plan.allocations[0].blockers.includes("live_canary_proof_required_before_hold"));
});

test("active position loader keeps only positions without a close event", () => {
  const records = [
    { event: "position_opened", positionId: "p1", amountUsd: 0.25 },
    { event: "position_opened", positionId: "p2", amountUsd: 0.25 },
    { event: "position_exit_confirmed", positionId: "p1" },
  ];

  const active = activeMerklPortfolioPositions(records);

  assert.equal(active.length, 1);
  assert.equal(active[0].positionId, "p2");
});

test("allocator tops up an already open opportunity within the per-opportunity cap", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions,
    positionRecords: [
      {
        event: "position_opened",
        status: "open",
        positionId: "p1",
        opportunityId: "opp-1",
        amountUsd: 0.25,
      },
    ],
    maxUsd: 0.25,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 1,
      perOpportunityMaxUsd: 0.45,
      minPositionUsd: 0.05,
    },
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 1);
  assert.equal(plan.entryQueue[0].entryAction, "top_up");
  assert.equal(plan.entryQueue[0].targetUsd, 0.2);
  assert.equal(plan.entryQueue[0].targetAmount, "200000");
});

test("allocator can top up immediately after a delivered canary without canary cooldown blocking hold entry", () => {
  const now = "2026-04-24T06:02:00.000Z";
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions: [
      {
        observedAt: "2026-04-24T06:01:00.000Z",
        mode: "execute",
        queueItem: { opportunityId: "opp-1" },
        execution: { settlementStatus: "delivered" },
      },
    ],
    positionRecords: [
      {
        event: "position_opened",
        status: "open",
        positionId: "p1",
        opportunityId: "opp-1",
        amountUsd: 0.25,
      },
    ],
    maxUsd: 0.25,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 1,
      perOpportunityMaxUsd: 0.45,
      minPositionUsd: 0.05,
    },
    now,
  });

  assert.equal(plan.summary.entryReadyCount, 1);
  assert.equal(plan.entryQueue[0].entryAction, "top_up");
  assert.equal(plan.entryQueue[0].targetUsd, 0.2);
});

test("allocator can still block duplicate opportunities when top-ups are disabled", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions,
    positionRecords: [
      {
        event: "position_opened",
        status: "open",
        positionId: "p1",
        opportunityId: "opp-1",
        amountUsd: 0.25,
      },
    ],
    maxUsd: 0.25,
    ...btcDecisionContext,
    policy: {
      allowTopUps: false,
    },
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 0);
  assert.ok(plan.allocations[0].blockers.includes("opportunity_already_open"));
});

test("allocator resizes a different opportunity to fit diversification caps", () => {
  const ethItem = queueItem({
    opportunityId: "eth-morpho",
    chain: "ethereum",
    protocolId: "morpho",
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        shareTokenAddress: "0x1111111111111111111111111111111111111111",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
  });
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [ethItem] },
    inventorySnapshot: {
      native: [{ chain: "ethereum", actual: "1", actualDecimal: 1, estimatedUsd: 20 }],
      tokens: [
        {
          chain: "ethereum",
          token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ticker: "USDC",
          actual: "100000000",
          actualDecimal: 100,
          estimatedUsd: 100,
        },
      ],
    },
    canaryExecutions: [
      {
        observedAt: "2026-04-24T06:01:00.000Z",
        mode: "execute",
        queueItem: { opportunityId: "eth-morpho" },
        execution: { settlementStatus: "delivered" },
      },
    ],
    positionRecords: [
      {
        event: "position_opened",
        status: "open",
        positionId: "base-yo",
        opportunityId: "base-yo",
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        protocolId: "yo",
        amountUsd: 100,
      },
    ],
    maxUsd: 100,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 500,
      perOpportunityMaxUsd: 100,
      minPositionUsd: 1,
      maxNewPositionsPerRun: 1,
      minEthereumNotionalUsd: 1,
    },
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 1);
  assert.equal(plan.entryQueue[0].queueItem.opportunityId, "eth-morpho");
  assert.ok(plan.entryQueue[0].targetUsd > 30);
  assert.ok(plan.entryQueue[0].targetUsd < 34);
});

test("allocator downgrades live balance races to a blocked execution", () => {
  assert.deepEqual(
    parseInsufficientAssetBalance(new Error("Insufficient asset balance: required 111570916, available 104493122")),
    { required: "111570916", available: "104493122" },
  );
  assert.equal(
    retryAmountFromAvailableBalance({ available: "104493122", reservePct: 0.05 }),
    "99268465",
  );
  assert.deepEqual(
    executionErrorBlockers(new Error("Insufficient asset balance: required 111570916, available 104493122")),
    ["insufficient_asset_balance"],
  );
  assert.deepEqual(executionErrorBlockers(new Error("rpc failed")), ["portfolio_execution_error"]);
});

test("allocator diversification gate blocks the next Ethereum pick when current holdings are already concentrated there", () => {
  const ethItem = queueItem({
    opportunityId: "eth-next",
    chain: "ethereum",
    protocolId: "morpho",
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        shareTokenAddress: "0x1111111111111111111111111111111111111111",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
  });
  const optimismItem = queueItem({
    opportunityId: "op-next",
    chain: "optimism",
    protocolId: "aave",
    priorityScore: 100,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "aave_v3_pool_supply_withdraw",
      resolvedBinding: {
        assetAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        aTokenAddress: "0x2222222222222222222222222222222222222222",
        poolAddress: "0x3333333333333333333333333333333333333333",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
  });
  const proof = (opportunityId) => ({
    observedAt: "2026-04-24T06:01:00.000Z",
    mode: "execute",
    queueItem: { opportunityId },
    execution: { settlementStatus: "delivered" },
  });
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [ethItem, optimismItem] },
    inventorySnapshot: {
      native: [
        { chain: "ethereum", actual: "1", actualDecimal: 1, estimatedUsd: 20 },
        { chain: "optimism", actual: "1", actualDecimal: 1, estimatedUsd: 20 },
      ],
      tokens: [
        { chain: "ethereum", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", ticker: "USDC", actual: "100000000", actualDecimal: 100, estimatedUsd: 100 },
        { chain: "optimism", token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", ticker: "USDC", actual: "100000000", actualDecimal: 100, estimatedUsd: 100 },
      ],
    },
    canaryExecutions: [proof("eth-next"), proof("op-next")],
    positionRecords: [
      { event: "position_opened", status: "open", positionId: "base-1", opportunityId: "base-1", chain: "base", protocolId: "yo", amountUsd: 75 },
      { event: "position_opened", status: "open", positionId: "eth-1", opportunityId: "eth-1", chain: "ethereum", protocolId: "aave", amountUsd: 25 },
      { event: "position_opened", status: "open", positionId: "eth-2", opportunityId: "eth-2", chain: "ethereum", protocolId: "morpho", amountUsd: 75 },
      { event: "position_opened", status: "open", positionId: "eth-3", opportunityId: "eth-3", chain: "ethereum", protocolId: "morpho", amountUsd: 50 },
    ],
    maxUsd: 25,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 300,
      perOpportunityMaxUsd: 25,
      minPositionUsd: 1,
      maxNewPositionsPerRun: 2,
    },
    now: "2026-04-25T00:00:00.000Z",
  });

  const ethAllocation = plan.allocations.find((item) => item.queueItem.opportunityId === "eth-next");
  assert.equal(ethAllocation.status, "blocked");
  assert.ok(ethAllocation.blockers.includes("diversification_policy_rejected"));
  assert.notEqual(plan.entryQueue[0]?.queueItem.chain, "ethereum");
});

test("allocator allows evidence-primary Base resize above the default chain cap", () => {
  const baseNext = queueItem({
    opportunityId: "base-next",
    protocolId: "new-base-protocol",
    aprPct: 500,
    expectedHoldDays: 10,
  });
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [baseNext] },
    inventorySnapshot: inventoryWithUsdc({ chain: "base", usd: 500 }),
    canaryExecutions: [deliveredProof("base-next")],
    positionRecords: [
      activePosition({ id: "base-a", chain: "base", protocolId: "base-a" }),
      activePosition({ id: "base-b", chain: "base", protocolId: "base-b" }),
      activePosition({ id: "base-c", chain: "base", protocolId: "base-c" }),
      activePosition({ id: "bob-a", chain: "bob", protocolId: "bob-a" }),
      activePosition({ id: "bob-b", chain: "bob", protocolId: "bob-b" }),
      activePosition({ id: "avax-a", chain: "avalanche", protocolId: "avax-a" }),
      activePosition({ id: "avax-b", chain: "avalanche", protocolId: "avax-b" }),
      activePosition({ id: "sonic-a", chain: "sonic", protocolId: "sonic-a" }),
      activePosition({ id: "sonic-b", chain: "sonic", protocolId: "sonic-b" }),
      activePosition({ id: "uni-a", chain: "unichain", protocolId: "uni-a" }),
    ],
    maxUsd: 500,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 2000,
      perOpportunityMaxUsd: 500,
      minPositionUsd: 1,
      maxNewPositionsPerRun: 1,
    },
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 1);
  assert.equal(plan.entryQueue[0].queueItem.opportunityId, "base-next");
  assert.ok(plan.entryQueue[0].targetUsd > 100);
});

test("allocator keeps non-primary chains near the default chain cap", () => {
  const bscNext = queueItem({
    opportunityId: "bsc-next",
    chain: "bsc",
    protocolId: "new-bsc-protocol",
    aprPct: 500,
    expectedHoldDays: 10,
  });
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [bscNext] },
    inventorySnapshot: inventoryWithUsdc({ chain: "bsc", usd: 500 }),
    canaryExecutions: [deliveredProof("bsc-next")],
    positionRecords: [
      activePosition({ id: "bsc-a", chain: "bsc", protocolId: "bsc-a" }),
      activePosition({ id: "bsc-b", chain: "bsc", protocolId: "bsc-b" }),
      activePosition({ id: "bsc-c", chain: "bsc", protocolId: "bsc-c" }),
      activePosition({ id: "bob-a", chain: "bob", protocolId: "bob-a" }),
      activePosition({ id: "bob-b", chain: "bob", protocolId: "bob-b" }),
      activePosition({ id: "avax-a", chain: "avalanche", protocolId: "avax-a" }),
      activePosition({ id: "avax-b", chain: "avalanche", protocolId: "avax-b" }),
      activePosition({ id: "sonic-a", chain: "sonic", protocolId: "sonic-a" }),
      activePosition({ id: "sonic-b", chain: "sonic", protocolId: "sonic-b" }),
      activePosition({ id: "uni-a", chain: "unichain", protocolId: "uni-a" }),
    ],
    maxUsd: 500,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 2000,
      perOpportunityMaxUsd: 500,
      minPositionUsd: 1,
      maxNewPositionsPerRun: 1,
    },
    now: "2026-04-25T00:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 1);
  assert.equal(plan.entryQueue[0].queueItem.opportunityId, "bsc-next");
  assert.ok(plan.entryQueue[0].targetUsd < 80);
});

test("allocator includes external wallet chain exposure before re-entering after rebalance exits", () => {
  const ethItem = queueItem({
    opportunityId: "eth-reentry",
    chain: "ethereum",
    protocolId: "morpho",
    priorityScore: 125,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        shareTokenAddress: "0x1111111111111111111111111111111111111111",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
  });
  const optimismItem = queueItem({
    opportunityId: "op-next",
    chain: "optimism",
    protocolId: "aave",
    priorityScore: 95,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "aave_v3_pool_supply_withdraw",
      resolvedBinding: {
        assetAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        aTokenAddress: "0x2222222222222222222222222222222222222222",
        poolAddress: "0x3333333333333333333333333333333333333333",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
  });
  const proof = (opportunityId) => ({
    observedAt: "2026-04-24T06:01:00.000Z",
    mode: "execute",
    queueItem: { opportunityId },
    execution: { settlementStatus: "delivered" },
  });

  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [ethItem, optimismItem] },
    inventorySnapshot: {
      native: [
        { chain: "ethereum", actual: "1", actualDecimal: 1, estimatedUsd: 20 },
        { chain: "optimism", actual: "1", actualDecimal: 1, estimatedUsd: 20 },
      ],
      tokens: [
        { chain: "ethereum", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", ticker: "USDC", actual: "100000000", actualDecimal: 100, estimatedUsd: 100 },
        { chain: "optimism", token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", ticker: "USDC", actual: "100000000", actualDecimal: 100, estimatedUsd: 100 },
      ],
    },
    externalChainUsd: {
      ethereum: 150,
    },
    canaryExecutions: [proof("eth-reentry"), proof("op-next")],
    positionRecords: [
      { event: "position_opened", status: "open", positionId: "base-1", opportunityId: "base-1", chain: "base", protocolId: "yo", amountUsd: 100 },
    ],
    maxUsd: 50,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 500,
      perOpportunityMaxUsd: 50,
      minPositionUsd: 1,
      maxNewPositionsPerRun: 2,
      minEthereumNotionalUsd: 1,
    },
    now: "2026-04-25T00:00:00.000Z",
  });

  const ethAllocation = plan.allocations.find((item) => item.queueItem.opportunityId === "eth-reentry");
  assert.equal(ethAllocation.status, "blocked");
  assert.ok(ethAllocation.blockers.includes("diversification_policy_rejected"));
  assert.equal(plan.entryQueue[0]?.queueItem.opportunityId, "op-next");
});

test("allocator respects scored chain targets so exit and entry do not churn the same chain", () => {
  const ethItem = queueItem({
    opportunityId: "eth-target-over",
    chain: "ethereum",
    protocolId: "morpho",
    priorityScore: 125,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        shareTokenAddress: "0x1111111111111111111111111111111111111111",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
  });
  const optimismItem = queueItem({
    opportunityId: "op-target-under",
    chain: "optimism",
    protocolId: "aave",
    priorityScore: 95,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "aave_v3_pool_supply_withdraw",
      resolvedBinding: {
        assetAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        aTokenAddress: "0x2222222222222222222222222222222222222222",
        poolAddress: "0x3333333333333333333333333333333333333333",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
  });
  const proof = (opportunityId) => ({
    observedAt: "2026-04-24T06:01:00.000Z",
    mode: "execute",
    queueItem: { opportunityId },
    execution: { settlementStatus: "delivered" },
  });

  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [ethItem, optimismItem] },
    inventorySnapshot: {
      native: [
        { chain: "ethereum", actual: "1", actualDecimal: 1, estimatedUsd: 20 },
        { chain: "optimism", actual: "1", actualDecimal: 1, estimatedUsd: 20 },
      ],
      tokens: [
        { chain: "ethereum", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", ticker: "USDC", actual: "100000000", actualDecimal: 100, estimatedUsd: 100 },
        { chain: "optimism", token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", ticker: "USDC", actual: "100000000", actualDecimal: 100, estimatedUsd: 100 },
      ],
    },
    externalChainUsd: {
      ethereum: 85,
      optimism: 5,
    },
    targetChainUsd: {
      ethereum: 15,
      optimism: 120,
    },
    canaryExecutions: [proof("eth-target-over"), proof("op-target-under")],
    maxUsd: 50,
    ...btcDecisionContext,
    policy: {
      maxActiveUsd: 500,
      perOpportunityMaxUsd: 50,
      minPositionUsd: 1,
      maxNewPositionsPerRun: 2,
      minEthereumNotionalUsd: 1,
    },
    now: "2026-04-25T00:00:00.000Z",
  });

  const ethAllocation = plan.allocations.find((item) => item.queueItem.opportunityId === "eth-target-over");
  assert.equal(ethAllocation.status, "blocked");
  assert.ok(ethAllocation.blockers.includes("chain_target_exceeded"));
  assert.equal(plan.entryQueue[0]?.queueItem.opportunityId, "op-target-under");
});

test("allocator surfaces BTC-first expected net fields on ready hold entries", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: {
      queue: [
        queueItem({
          expectedHoldDays: 10,
          aprPct: 36.5,
          rewardTokenType: "stable",
          estimatedGasCostUsd: 0.01,
          estimatedBridgeCostUsd: 0.02,
          estimatedClaimCostUsd: 0,
          estimatedRewardSwapCostUsd: 0,
          estimatedExitCostUsd: 0,
          estimatedSlippageUsd: 0,
        }),
      ],
    },
    inventorySnapshot: {
      native: inventorySnapshot.native,
      tokens: [
        {
          chain: "base",
          ticker: "USDC",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          actual: "100000000",
          actualDecimal: 100,
          estimatedUsd: 100,
        },
      ],
    },
    canaryExecutions,
    externalChainUsd: { bob: 1000 },
    maxUsd: 10,
    btcPriceUsd: 100_000,
    btcPriceSnapshotAt: "2026-05-07T00:00:00.000Z",
    policy: {
      maxActiveUsd: 100,
      perOpportunityMaxUsd: 10,
      minPositionUsd: 1,
    },
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 1);
  assert.equal(plan.entryQueue[0].decision.expectedNetSats, 70);
  assert.equal(plan.entryQueue[0].decision.expectedNetUsd, 0.07);
  assert.equal(plan.entryQueue[0].decision.grossRewardSats, 100);
  assert.equal(plan.entryQueue[0].decision.estimatedCostSats, 30);
  assert.equal(plan.entryQueue[0].decision.bridgeCostSats, 20);
  assert.equal(plan.entryQueue[0].decision.holdWindowSource, "expectedHoldDays");
  assert.equal(plan.entryQueue[0].decision.btcPriceSnapshotAt, "2026-05-07T00:00:00.000Z");
});

test("allocator blocks candidates whose measured bridge cost consumes expected BTC net", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: {
      queue: [
        queueItem({
          expectedHoldDays: 10,
          aprPct: 36.5,
          rewardTokenType: "stable",
          estimatedGasCostUsd: 0.01,
          estimatedBridgeCostUsd: 0.20,
          estimatedClaimCostUsd: 0,
          estimatedRewardSwapCostUsd: 0,
          estimatedExitCostUsd: 0,
          estimatedSlippageUsd: 0,
        }),
      ],
    },
    inventorySnapshot: {
      native: inventorySnapshot.native,
      tokens: [
        {
          chain: "base",
          ticker: "USDC",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          actual: "100000000",
          actualDecimal: 100,
          estimatedUsd: 100,
        },
      ],
    },
    canaryExecutions,
    externalChainUsd: { bob: 1000 },
    maxUsd: 10,
    btcPriceUsd: 100_000,
    policy: {
      maxActiveUsd: 100,
      perOpportunityMaxUsd: 10,
      minPositionUsd: 1,
    },
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 0);
  assert.ok(plan.allocations[0].blockers.includes("expected_net_sats_not_positive"));
  assert.equal(plan.idleCapitalReport.bridgeCostGreaterThanExpectedNet.length, 1);
});

test("allocator converts proof-missing candidates into ladder-bound graduation canary requests", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot: {
      native: inventorySnapshot.native,
      tokens: [
        {
          chain: "base",
          ticker: "USDC",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          actual: "100000000",
          actualDecimal: 100,
          estimatedUsd: 100,
        },
      ],
    },
    canaryExecutions: [],
    maxUsd: 10,
    btcPriceUsd: 100_000,
    policy: {
      maxActiveUsd: 100,
      perOpportunityMaxUsd: 10,
      minPositionUsd: 1,
    },
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 0);
  assert.equal(plan.summary.graduationCanaryRequestCount, 1);
  assert.equal(plan.graduationCanaryRequests[0].amountUsd, 5);
  assert.equal(plan.graduationCanaryRequests[0].metadata.sameOpportunityHoldProofSatisfied, false);
});

test("allocator reports proof-graduation blockers for non-executable canary requests", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: {
      queue: [
        queueItem({
          protocolBindingPlan: {
            status: "protocol_position_binding_required",
            bindingKind: "aave_v3_pool_supply_withdraw",
          },
          capabilityGaps: ["protocol_position_binding_required"],
        }),
      ],
    },
    inventorySnapshot: {
      native: inventorySnapshot.native,
      tokens: [
        {
          chain: "base",
          ticker: "USDC",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          actual: "100000000",
          actualDecimal: 100,
          estimatedUsd: 100,
        },
      ],
    },
    canaryExecutions: [],
    maxUsd: 10,
    btcPriceUsd: 100_000,
    policy: {
      maxActiveUsd: 100,
      perOpportunityMaxUsd: 10,
      minPositionUsd: 1,
    },
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(plan.summary.graduationCanaryRequestCount, 0);
  assert.equal(plan.idleCapitalReport.proofRequired[0].graduationReady, false);
  assert.ok(plan.idleCapitalReport.proofRequired[0].graduationBlockers.includes("protocol_binding_not_ready"));
  assert.ok(plan.idleCapitalReport.proofRequired[0].graduationBlockers.includes("protocol_position_binding_required"));
});

test("allocator reports proof-graduation EV floor diagnostics", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: {
      queue: [
        queueItem({
          aprPct: 5,
          expectedHoldDays: null,
          campaignRemainingHours: 24,
        }),
      ],
    },
    inventorySnapshot: {
      native: inventorySnapshot.native,
      tokens: [
        {
          chain: "base",
          ticker: "USDC",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          actual: "3307405",
          actualDecimal: 3.307405,
          estimatedUsd: 3.307405,
        },
      ],
    },
    canaryExecutions: [],
    maxUsd: 10,
    btcPriceUsd: 100_000,
    policy: {
      maxActiveUsd: 100,
      perOpportunityMaxUsd: 10,
      minPositionUsd: 1,
    },
    now: "2026-05-07T00:00:00.000Z",
  });

  const proof = plan.idleCapitalReport.proofRequired[0];
  assert.equal(plan.summary.graduationCanaryRequestCount, 0);
  assert.equal(proof.graduationReady, false);
  assert.ok(proof.graduationBlockers.some((blocker) => blocker.startsWith("same_chain_unprofitable:need_$")));
  assert.equal(proof.graduationEvGate.limitingFactor, "inventory");
  assert.deepEqual(proof.graduationLimiters, ["inventory"]);
  assert.equal(proof.graduationEvGate.currentAmountUsd, 3.307405);
  assert.ok(proof.graduationEvGate.neededUsd > proof.graduationEvGate.currentAmountUsd);
});

test("allocator never spends a shared chain-token bucket below zero", () => {
  const second = queueItem({
    queueId: "merkl:opp-2",
    opportunityId: "opp-2",
    priorityScore: 103,
    aprPct: 500,
    expectedHoldDays: 10,
    estimatedGasCostUsd: 0,
  });
  const plan = buildMerklPortfolioAllocationPlan({
    queue: {
      queue: [
        queueItem({
          aprPct: 500,
          expectedHoldDays: 10,
          estimatedGasCostUsd: 0,
        }),
        second,
      ],
    },
    inventorySnapshot: {
      native: inventorySnapshot.native,
      tokens: [
        {
          chain: "base",
          ticker: "USDC",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          actual: "1000000",
          actualDecimal: 1,
          estimatedUsd: 1,
        },
      ],
    },
    canaryExecutions: [
      canaryExecutions[0],
      {
        observedAt: "2026-04-24T05:49:14.000Z",
        mode: "execute",
        queueItem: { opportunityId: "opp-2" },
        execution: { settlementStatus: "delivered" },
      },
    ],
    externalChainUsd: { bob: 1000 },
    maxUsd: 2,
    btcPriceUsd: 100_000,
    policy: {
      maxActiveUsd: 10,
      perOpportunityMaxUsd: 2,
      maxNewPositionsPerRun: 2,
      minPositionUsd: 0.05,
    },
    now: "2026-05-07T00:00:00.000Z",
  });

  const totalTargetUsd = plan.entryQueue.reduce((sum, item) => sum + item.targetUsd, 0);
  assert.ok(totalTargetUsd <= 0.95);
  assert.ok(plan.idleCapitalReport.tokenDust.some((item) => item.tokenKey.includes("base:")));
});
