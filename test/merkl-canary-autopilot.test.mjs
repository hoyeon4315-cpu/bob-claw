import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMerklCanaryOpportunityIntent,
  evaluateMerklCanaryOpportunityPolicy,
  merklExecutionErrorReport,
  refreshMerklAutopilotSelectionForExecute,
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
        observedAt: "2026-05-01T00:00:00.000Z",
        mode: "execute",
        status: "delivered",
        queueItem: {
          opportunityId: "opp-a",
          chain: "base",
          protocolId: "morpho",
          mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        },
        sizing: { amountUsd: 5 },
        execution: { settlementStatus: "delivered", txHash: "0xaaa" },
        realized: { netUsd: 0.05 },
      },
      {
        observedAt: "2026-05-01T01:00:00.000Z",
        mode: "execute",
        status: "delivered",
        queueItem: {
          opportunityId: "opp-b",
          chain: "base",
          protocolId: "morpho",
          mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        },
        sizing: { amountUsd: 10 },
        execution: { settlementStatus: "delivered", txHash: "0xbbb" },
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
    }),
    sizing: {
      status: "ready",
      amount: "10000000",
      amountUsd: 10,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith("same_chain_unprofitable")));
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

test("blocks Ethereum canaries when committed caps are below the gas-efficiency notional floor", () => {
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

  assert.equal(sizing.status, "blocked");
  assert.ok(sizing.blockers.includes("cap_too_low_for_ethereum_gas_efficiency"));
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
