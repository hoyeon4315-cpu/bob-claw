import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMerklCanaryOpportunityIntent,
  evaluateMerklCanaryOpportunityPolicy,
  merklExecutionErrorReport,
  portfolioGraduationRequestsFromReport,
  refreshMerklAutopilotSelectionForExecute,
  selectMerklCanaryOpportunityPolicyReadyCandidates,
  selectMerklCanaryAutopilotCandidate,
  selectMerklCanaryAutopilotCandidates,
  sizeMerklCanaryAmount,
  summarizeMerklAutopilotResults,
} from "../src/executor/merkl-canary-autopilot.mjs";

function queueItem(overrides = {}) {
  return {
    opportunityId: "opp-1",
    chain: "base",
    protocolId: "morpho",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    priorityScore: 100,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        shareTokenAddress: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
        assetDecimals: 6,
      },
    },
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        actual: "414771",
        estimatedUsd: 0.414771,
      },
      matchedNative: {
        asset: "ETH",
        actual: "1000000000000000",
        estimatedUsd: 2,
      },
    },
    ...overrides,
  };
}

test("sizes Merkl canary amount to the committed tiny cap and inventory", () => {
  const sizing = sizeMerklCanaryAmount(queueItem());

  assert.equal(sizing.status, "ready");
  assert.equal(sizing.amount, "414771");
  assert.equal(sizing.amountUsd, 0.414771);
});

test("uses committed graduation ladder as the live canary sizing cap", () => {
  const sizing = sizeMerklCanaryAmount(queueItem({
    opportunityId: "opp-next",
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        actual: "100000000",
        estimatedUsd: 100,
      },
      matchedNative: {
        asset: "ETH",
        actual: "1000000000000000",
        estimatedUsd: 2,
      },
    },
  }), {
    canaryExecutions: [
      {
        observedAt: "2026-05-09T02:07:00.000Z",
        mode: "execute",
        status: "delivered",
        queueItem: {
          opportunityId: "opp-next",
          chain: "base",
          protocolId: "morpho",
          mappedStrategyId: "gateway_native_asset_conversion_sleeve",
          protocolBindingPlan: { bindingKind: "erc4626_vault_supply_withdraw" },
        },
        sizing: { amountUsd: 5 },
        openedAt: "2026-05-09T02:00:00.000Z",
        closedAt: "2026-05-09T02:07:00.000Z",
        entryUsd: 5,
        exitUsd: 5.12,
        entryGasUsd: 0.01,
        exitGasUsd: 0.01,
        claimCostUsd: 0,
        rewardSwapCostUsd: 0,
        rewardUsd: 0,
        bridgeCostUsd: 0,
        slippageUsd: 0,
        realizedNetBtcSats: 50,
        terminalReconciliationStatus: "reconciled",
        sourceObservedAt: "2026-05-09T02:07:00.000Z",
        execution: { settlementStatus: "delivered", txHash: "0xaaa" },
        realized: { netUsd: 0.05 },
      },
      {
        observedAt: "2026-05-09T02:08:00.000Z",
        mode: "execute",
        status: "delivered",
        queueItem: {
          opportunityId: "opp-next",
          chain: "base",
          protocolId: "morpho",
          mappedStrategyId: "gateway_native_asset_conversion_sleeve",
          protocolBindingPlan: { bindingKind: "erc4626_vault_supply_withdraw" },
        },
        sizing: { amountUsd: 10 },
        openedAt: "2026-05-09T02:01:00.000Z",
        closedAt: "2026-05-09T02:08:00.000Z",
        entryUsd: 10,
        exitUsd: 10.12,
        entryGasUsd: 0.01,
        exitGasUsd: 0.01,
        claimCostUsd: 0,
        rewardSwapCostUsd: 0,
        rewardUsd: 0,
        bridgeCostUsd: 0,
        slippageUsd: 0,
        realizedNetBtcSats: 50,
        terminalReconciliationStatus: "reconciled",
        sourceObservedAt: "2026-05-09T02:08:00.000Z",
        execution: { settlementStatus: "delivered", txHash: "0xbbb" },
        realized: { netUsd: 0.05 },
      },
    ],
  });

  assert.equal(sizing.status, "ready");
  assert.equal(sizing.graduation.targetUsd, 25);
  assert.equal(sizing.capUsd, 25);
  assert.equal(sizing.amountUsd, 25);
});

test("does not apply canary graduation ladder when tiny live cap is disabled", () => {
  const sizing = sizeMerklCanaryAmount(queueItem({
    opportunityId: "portfolio-hold",
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        actual: "100000000",
        estimatedUsd: 100,
      },
      matchedNative: {
        asset: "ETH",
        actual: "1000000000000000",
        estimatedUsd: 2,
      },
    },
  }), {
    maxUsd: 100,
    useTinyLiveCap: false,
  });

  assert.equal(sizing.status, "ready");
  assert.equal(sizing.graduation, null);
  assert.equal(sizing.capUsd, 100);
  assert.equal(sizing.amountUsd, 100);
});

test("Merkl canary opportunity policy blocks selected candidates before plan build", async () => {
  const result = await evaluateMerklCanaryOpportunityPolicy({
    queueItem: queueItem(),
    sizing: {
      status: "ready",
      amount: "25000000",
      amountUsd: 25,
    },
    evaluateOpportunityPolicyImpl: async ({ intent }) => ({
      decision: "BLOCK",
      blockers: [`blocked:${intent.intentType}`],
    }),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, ["blocked:erc4626_deposit"]);
});

test("Merkl canary opportunity policy uses campaign window and tiny canary cost basis", async () => {
  const result = await evaluateMerklCanaryOpportunityPolicy({
    now: "2026-05-01T20:19:17.949Z",
    queueItem: queueItem({
      protocolId: "yo",
      aprPct: 19.8,
      campaignRemainingHours: 24 * 33,
      estimatedGasCostUsd: null,
    }),
    sizing: {
      status: "ready",
      amount: "1400000",
      amountUsd: 1.4,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.blockers.some((blocker) => blocker.startsWith("same_chain_unprofitable")),
    false
  );
  assert.equal(result.intent.expectedHoldDays, 33);
});

test("Merkl canary opportunity policy still blocks genuinely negative tiny EV", async () => {
  const result = await evaluateMerklCanaryOpportunityPolicy({
    now: "2026-05-01T20:19:17.949Z",
    queueItem: queueItem({
      protocolId: "yo",
      aprPct: 0.6,
      campaignRemainingHours: 24 * 33,
      estimatedGasCostUsd: null,
      executionReadiness: {
        status: "inventory_ready",
        matchedToken: {
          ticker: "USDC",
          actual: "10000000",
          estimatedUsd: 10,
        },
        matchedNative: {
          asset: "ETH",
          actual: "1000000000000000",
          estimatedUsd: 2,
        },
      },
    }),
    sizing: {
      status: "ready",
      amount: "10000000",
      amountUsd: 10,
      capUsd: 10,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith("same_chain_unprofitable")));
  assert.equal(result.evGate.status, "blocked");
  assert.equal(result.evGate.currentAmountUsd, 10);
  assert.ok(result.evGate.neededUsd > 10);
  assert.equal(result.evGate.holdDays, 33);
  assert.equal(result.evGate.limitingFactor, "inventory");
});

test("buildMerklCanaryOpportunityIntent preserves explicit hold days over campaign hours", () => {
  const intent = buildMerklCanaryOpportunityIntent({
    now: "2026-05-01T20:19:17.949Z",
    queueItem: queueItem({
      expectedHoldDays: 5,
      campaignRemainingHours: 24 * 33,
    }),
    sizing: {
      amountUsd: 1.4,
    },
  });

  assert.equal(intent.expectedHoldDays, 5);
});

test("Merkl autopilot result summary separates selected candidates from policy-ready execution", () => {
  const summary = summarizeMerklAutopilotResults([
    {
      status: "blocked",
      blockedReason: "same_chain_unprofitable:need_$64_on_base",
      opportunityPolicy: {
        blockers: ["same_chain_unprofitable:need_$64_on_base"],
        evGate: {
          status: "blocked",
          blocker: "same_chain_unprofitable:need_$64_on_base",
          currentAmountUsd: 10,
          neededUsd: 64,
          limitingFactor: "inventory",
        },
      },
    },
    {
      status: "preview_ready",
    },
  ]);

  assert.equal(summary.executionReadyCount, 1);
  assert.equal(summary.blockedCount, 1);
  assert.equal(summary.topBlocker, "same_chain_unprofitable:need_$64_on_base");
  assert.deepEqual(summary.blockerCounts, {
    "same_chain_unprofitable:need_$64_on_base": 1,
  });
  assert.deepEqual(summary.topEvGate, {
    status: "blocked",
    blocker: "same_chain_unprofitable:need_$64_on_base",
    currentAmountUsd: 10,
    neededUsd: 64,
    limitingFactor: "inventory",
  });
});

test("Merkl autopilot summary reports the EV gate matching the top blocker", () => {
  const summary = summarizeMerklAutopilotResults([
    {
      status: "blocked",
      blockedReason: "same_chain_unprofitable:need_$5_on_base",
      opportunityPolicy: {
        blockers: ["same_chain_unprofitable:need_$5_on_base"],
        evGate: {
          status: "blocked",
          blocker: "same_chain_unprofitable:need_$5_on_base",
          currentAmountUsd: 1,
          neededUsd: 5,
          limitingFactor: "inventory",
        },
      },
    },
    {
      status: "blocked",
      blockedReason: "same_chain_unprofitable:need_$10_on_optimism",
      opportunityPolicy: {
        blockers: ["same_chain_unprofitable:need_$10_on_optimism"],
        evGate: {
          status: "blocked",
          blocker: "same_chain_unprofitable:need_$10_on_optimism",
          currentAmountUsd: 2,
          neededUsd: 10,
          limitingFactor: "inventory",
        },
      },
    },
    {
      status: "blocked",
      blockedReason: "same_chain_unprofitable:need_$10_on_optimism",
      opportunityPolicy: {
        blockers: ["same_chain_unprofitable:need_$10_on_optimism"],
      },
    },
  ]);

  assert.equal(summary.topBlocker, "same_chain_unprofitable:need_$10_on_optimism");
  assert.equal(summary.topEvGate.blocker, "same_chain_unprofitable:need_$10_on_optimism");
  assert.equal(summary.topEvGate.neededUsd, 10);
});

test("blocks Merkl canary sizing when committed chain cap is exhausted", () => {
  const sizing = sizeMerklCanaryAmount(queueItem(), {
    now: "2026-04-24T01:40:00.000Z",
    auditRecords: [{
      strategyId: "gateway_native_asset_conversion_sleeve",
      chain: "base",
      timestamp: "2026-04-24T01:20:00.000Z",
      policyVerdict: "approved",
      lifecycle: { stage: "confirmed" },
      intent: {
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        intentType: "erc4626_deposit",
        amountUsd: 2_000,
        metadata: { capCheckAmountUsd: 2_000 },
      },
      amountUsd: 2_000,
    }],
  });

  assert.equal(sizing.status, "blocked");
  assert.ok(sizing.blockers.includes("strategy_per_chain_cap_exceeded"));
});

test("blocks Merkl canary sizing when tiny live cap is missing", () => {
  const sizing = sizeMerklCanaryAmount(queueItem({
    mappedStrategyId: "gateway-btc-offramp",
  }));

  assert.equal(sizing.status, "blocked");
  assert.ok(sizing.blockers.includes("strategy_tiny_live_cap_missing"));
});

test("selection skips candidates whose committed chain cap is exhausted", () => {
  const selection = selectMerklCanaryAutopilotCandidate(
    { queue: [queueItem()] },
    {
      now: "2026-04-24T01:40:00.000Z",
      auditRecords: [{
        strategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        timestamp: "2026-04-24T01:20:00.000Z",
        policyVerdict: "approved",
      lifecycle: { stage: "confirmed" },
      intent: {
          strategyId: "gateway_native_asset_conversion_sleeve",
          chain: "base",
          intentType: "erc4626_deposit",
          amountUsd: 2_000,
          metadata: { capCheckAmountUsd: 2_000 },
        },
        amountUsd: 2_000,
      }],
    },
  );

  assert.equal(selection.readyCount, 0);
  assert.equal(selection.selected, null);
  assert.ok(selection.candidates[0].sizing.blockers.includes("strategy_per_chain_cap_exceeded"));
});

test("does not use a fixed Ethereum notional floor before the tiny-canary EV gate", () => {
  const sizing = sizeMerklCanaryAmount(queueItem({
    chain: "ethereum",
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        actual: "100000000",
        estimatedUsd: 100,
      },
      matchedNative: {
        asset: "ETH",
        actual: "100000000000000000",
        estimatedUsd: 250,
      },
    },
  }), {
    maxUsd: 5,
  });

  assert.equal(sizing.status, "ready");
  assert.equal(sizing.blockers.includes("cap_too_low_for_ethereum_gas_efficiency"), false);
  assert.equal(sizing.amountUsd, 5);
});

test("selects the highest priority ready candidate after gas and cap checks", () => {
  const base = queueItem({ opportunityId: "base", priorityScore: 90 });
  const ethereum = queueItem({
    opportunityId: "ethereum",
    chain: "ethereum",
    priorityScore: 120,
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        actual: "100000000",
        estimatedUsd: 100,
      },
      matchedNative: {
        asset: "ETH",
        actual: "100000000000000000",
        estimatedUsd: 250,
      },
    },
  });

  const selection = selectMerklCanaryAutopilotCandidate({ queue: [ethereum, base] });

  assert.equal(selection.readyCount, 2);
  assert.equal(selection.selected.queueItem.opportunityId, "ethereum");
});

test("selection can be scoped to one Merkl opportunity id", () => {
  const highPriority = queueItem({ opportunityId: "high", priorityScore: 200 });
  const requested = queueItem({ opportunityId: "requested", priorityScore: 100 });

  const selection = selectMerklCanaryAutopilotCandidate(
    { queue: [highPriority, requested] },
    { opportunityId: "merkl:requested" },
  );

  assert.equal(selection.readyCount, 1);
  assert.equal(selection.selected.queueItem.opportunityId, "requested");
});

test("batch selection spreads Merkl canaries across chains before repeating a chain", () => {
  const ethereumA = queueItem({ opportunityId: "ethereum-a", chain: "ethereum", priorityScore: 130, executionReadiness: {
    status: "inventory_ready",
    matchedToken: { ticker: "USDC", actual: "100000000", estimatedUsd: 100 },
    matchedNative: { asset: "ETH", actual: "100000000000000000", estimatedUsd: 250 },
  } });
  const ethereumB = queueItem({ opportunityId: "ethereum-b", chain: "ethereum", priorityScore: 120, executionReadiness: ethereumA.executionReadiness });
  const base = queueItem({ opportunityId: "base", chain: "base", priorityScore: 90 });

  const selection = selectMerklCanaryAutopilotCandidates(
    { queue: [ethereumA, ethereumB, base] },
    { maxCandidates: 3, maxPerChain: 2 },
  );

  assert.equal(selection.readyCount, 3);
  assert.deepEqual(selection.selected.map((item) => item.queueItem.opportunityId), [
    "ethereum-a",
    "base",
    "ethereum-b",
  ]);
});

test("execute selection defers policy-failing candidates and keeps the first policy-pass candidate", async () => {
  const optimism = queueItem({
    opportunityId: "optimism-unprofitable",
    chain: "optimism",
    priorityScore: 110,
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: { ticker: "USDC", actual: "4096980", estimatedUsd: 4.09698 },
      matchedNative: { asset: "ETH", actual: "1000000000000000", estimatedUsd: 2 },
    },
    protocolBindingPlan: {
      ...queueItem().protocolBindingPlan,
      resolvedBinding: {
        ...queueItem().protocolBindingPlan.resolvedBinding,
        assetAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      },
    },
  });
  const base = queueItem({
    opportunityId: "base-policy-pass",
    chain: "base",
    priorityScore: 100,
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: { ticker: "USDC", actual: "5000000", estimatedUsd: 5 },
      matchedNative: { asset: "ETH", actual: "1000000000000000", estimatedUsd: 2 },
    },
  });
  const selection = selectMerklCanaryAutopilotCandidates(
    { queue: [optimism, base] },
    { maxCandidates: 2 },
  );

  const filtered = await selectMerklCanaryOpportunityPolicyReadyCandidates(selection, {
    maxCandidates: 1,
    evaluateOpportunityPolicyImpl: async ({ intent }) => {
      if (intent.chain === "optimism") {
        return {
          decision: "BLOCK",
          blockers: ["same_chain_unprofitable:need_$18_on_optimism"],
        };
      }
      return { decision: "ALLOW", blockers: [] };
    },
  });

  assert.equal(filtered.selected.length, 1);
  assert.equal(filtered.selected[0].queueItem.opportunityId, "base-policy-pass");
  assert.equal(filtered.deferred.length, 1);
  assert.equal(filtered.deferred[0].status, "filtered");
  assert.equal(filtered.deferred[0].filteredReason, "same_chain_unprofitable:need_$18_on_optimism");
});

test("portfolio graduation requests are selection hints ahead of raw priority score", () => {
  const rawLeader = queueItem({
    opportunityId: "raw-priority-leader",
    priorityScore: 500,
  });
  const proofRequest = queueItem({
    opportunityId: "allocator-proof-request",
    priorityScore: 100,
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: { ticker: "USDC", actual: "5000000", estimatedUsd: 5 },
      matchedNative: { asset: "ETH", actual: "1000000000000000", estimatedUsd: 2 },
    },
  });

  const selection = selectMerklCanaryAutopilotCandidates(
    { queue: [rawLeader, proofRequest] },
    {
      maxCandidates: 1,
      graduationCanaryRequests: [
        {
          opportunityId: "allocator-proof-request",
          chain: "base",
          amountUsd: 5,
          evidenceConfidence: "graduation_ladder_rung_0",
        },
      ],
    },
  );

  assert.equal(selection.selected[0].queueItem.opportunityId, "allocator-proof-request");
  assert.equal(selection.selected[0].queueItem.metadata.portfolioGraduationRequest.evidenceConfidence, "graduation_ladder_rung_0");
});

test("portfolio graduation hints do not force blocked candidates into selection", () => {
  const blockedRequest = queueItem({
    opportunityId: "blocked-proof-request",
    priorityScore: 1,
    executionReadiness: {
      status: "inventory_missing",
      matchedToken: null,
      matchedNative: { asset: "ETH", actual: "1000000000000000", estimatedUsd: 2 },
    },
  });

  const selection = selectMerklCanaryAutopilotCandidates(
    { queue: [blockedRequest] },
    {
      maxCandidates: 1,
      graduationCanaryRequests: [
        {
          opportunityId: "blocked-proof-request",
          chain: "base",
          amountUsd: 5,
          evidenceConfidence: "graduation_ladder_rung_0",
        },
      ],
    },
  );

  assert.equal(selection.selected.length, 0);
  assert.equal(selection.readyCount, 0);
  assert.ok(selection.candidates[0].sizing.blockers.includes("inventory_missing"));
});

test("portfolio graduation hints must match candidate chain and strategy", () => {
  const rawLeader = queueItem({
    opportunityId: "raw-priority-leader",
    priorityScore: 500,
  });
  const mismatchedRequest = queueItem({
    opportunityId: "allocator-proof-request",
    priorityScore: 100,
    chain: "base",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: { ticker: "USDC", actual: "5000000", estimatedUsd: 5 },
      matchedNative: { asset: "ETH", actual: "1000000000000000", estimatedUsd: 2 },
    },
  });

  const selection = selectMerklCanaryAutopilotCandidates(
    { queue: [rawLeader, mismatchedRequest] },
    {
      maxCandidates: 1,
      graduationCanaryRequests: [
        {
          opportunityId: "allocator-proof-request",
          chain: "ethereum",
          strategyId: "gateway_native_asset_conversion_sleeve",
          amountUsd: 5,
          evidenceConfidence: "graduation_ladder_rung_0",
        },
      ],
    },
  );

  assert.equal(selection.selected[0].queueItem.opportunityId, "raw-priority-leader");
});

test("extracts portfolio graduation requests from allocator latest report shape", () => {
  const requests = portfolioGraduationRequestsFromReport({
    plan: {
      graduationCanaryRequests: [
        {
          opportunityId: "opp-proof",
          chain: "sei",
          strategyId: "gateway_native_asset_conversion_sleeve",
          amountUsd: 3.3,
        },
      ],
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].opportunityId, "opp-proof");
});

test("extracts portfolio graduation requests from orchestrator compact report shape", () => {
  const requests = portfolioGraduationRequestsFromReport({
    allocator: {
      graduationCanaryRequests: [
        {
          opportunityId: "opp-compact",
          chain: "base",
          strategyId: "gateway_native_asset_conversion_sleeve",
          amountUsd: 5,
        },
      ],
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].opportunityId, "opp-compact");
});

test("refreshes queue readiness from latest canary executions before selecting", () => {
  const selection = selectMerklCanaryAutopilotCandidate(
    { queue: [queueItem({ opportunityId: "base" })] },
    {
      canaryExecutions: [
        {
          observedAt: new Date().toISOString(),
          mode: "execute",
          queueItem: { opportunityId: "base" },
          execution: { settlementStatus: "delivered" },
        },
      ],
      inventorySnapshot: {
        native: [
          {
            chain: "base",
            actual: "1000000000000000",
            estimatedUsd: 2,
          },
        ],
        tokens: [
          {
            chain: "base",
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            ticker: "USDC",
            actual: "414771",
            estimatedUsd: 0.414771,
          },
        ],
      },
    },
  );

  assert.equal(selection.readyCount, 0);
  assert.equal(selection.selected, null);
  assert.ok(selection.candidates[0].sizing.blockers.includes("cooldown_active"));
});

test("refreshes execute sizing from live balances before Merkl canary execution", async () => {
  const selected = {
    queueItem: queueItem({
      executionReadiness: {
        status: "inventory_ready",
        matchedToken: {
          ticker: "USDC",
          actual: "5370245",
          estimatedUsd: 5.370245,
        },
        matchedNative: {
          asset: "ETH",
          actual: "1000000000000000",
          estimatedUsd: 2,
        },
      },
    }),
    sizing: {
      status: "ready",
      amount: "5370245",
      amountUsd: 5.370245,
    },
  };

  const refreshed = await refreshMerklAutopilotSelectionForExecute({
    selected,
    senderAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    readErc20BalanceImpl: async () => ({ balance: 100024n, rpcUrl: "https://mainnet.base.org" }),
    readNativeBalanceImpl: async () => ({ balanceWei: 1000000000000000n, rpcUrl: "https://mainnet.base.org" }),
  });

  assert.equal(refreshed.queueItem.executionReadiness.matchedToken.actual, "100024");
  assert.equal(refreshed.sizing.status, "ready");
  assert.equal(refreshed.sizing.amount, "100024");
  assert.equal(refreshed.sizing.amountUsd, 0.100024);
});

test("classifies reverted Merkl canary broadcasts as candidate blockers", () => {
  const report = merklExecutionErrorReport({
    execute: true,
    error: Object.assign(new Error("Transaction reverted after broadcast"), {
      name: "EvmReceiptReverted",
    }),
    preflight: {
      status: "ready",
      senderAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      liveBaseline: { liveTrading: "ALLOWED" },
      killSwitchPath: "/tmp/KILL_SWITCH",
    },
    queue: { queue: [queueItem()] },
    queueItem: queueItem({ opportunityId: "reverted" }),
    sizing: { amount: "1000000", amountUsd: 1 },
    readyCount: 1,
    representativeCoverage: { missingRepresentativeChainCount: 0 },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.blockedReason, "execution_reverted");
  assert.equal(report.summary.selectedOpportunityId, "reverted");
});

test("classifies signer execution failures as candidate blockers", () => {
  const report = merklExecutionErrorReport({
    execute: true,
    error: Object.assign(new Error("Signer did not complete approve_asset_to_vault"), {
      name: "SignerExecutionFailed",
    }),
    preflight: {
      status: "ready",
      senderAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      liveBaseline: { liveTrading: "ALLOWED" },
      killSwitchPath: "/tmp/KILL_SWITCH",
    },
    queue: { queue: [queueItem()] },
    queueItem: queueItem({ opportunityId: "signer-failed" }),
    sizing: { amount: "1000000", amountUsd: 1 },
    readyCount: 1,
    representativeCoverage: { missingRepresentativeChainCount: 0 },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.blockedReason, "signer_execution_failed");
  assert.equal(report.summary.selectedOpportunityId, "signer-failed");
});
