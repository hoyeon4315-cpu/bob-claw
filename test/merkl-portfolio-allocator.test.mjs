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
    aprPct: 12,
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

test("allocator uses portfolio active budget when maxUsd is omitted", () => {
  const plan = buildMerklPortfolioAllocationPlan({
    queue: { queue: [queueItem()] },
    inventorySnapshot,
    canaryExecutions,
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
    maxUsd: 0.25,
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.capitalJobCount, 1);
  assert.equal(plan.capitalJobs[0].chain, "ethereum");
  assert.equal(plan.capitalJobs[0].requiredAsset, "USDC");
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
    policy: {
      allowTopUps: false,
    },
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 0);
  assert.ok(plan.allocations[0].blockers.includes("opportunity_already_open"));
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
