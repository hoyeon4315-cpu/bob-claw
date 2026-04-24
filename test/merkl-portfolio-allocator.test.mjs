import test from "node:test";
import assert from "node:assert/strict";
import {
  activeMerklPortfolioPositions,
  buildMerklPortfolioAllocationPlan,
  merklPortfolioScore,
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

test("allocator blocks duplicate opportunity when a position is already open", () => {
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
    now: "2026-04-24T06:00:00.000Z",
  });

  assert.equal(plan.summary.entryReadyCount, 0);
  assert.ok(plan.allocations[0].blockers.includes("opportunity_already_open"));
});
