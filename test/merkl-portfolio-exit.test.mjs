import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMerklPortfolioRebalanceExitPlan,
  confirmationTimeoutMsForExit,
  executeReadyMerklPortfolioExits,
  evaluateMerklPositionExit,
} from "../src/executor/merkl-portfolio-exit.mjs";
import { executeAavePortfolioExit, executeErc4626PortfolioExit } from "../src/executor/helpers/merkl-portfolio-exit-executors.mjs";
import { validateEvmTransactionSemantics } from "../src/executor/signer/evm-local-signer.mjs";

function position(overrides = {}) {
  return {
    event: "position_opened",
    status: "open",
    positionId: "p1",
    opportunityId: "opp-1",
    chain: "base",
    protocolId: "yo",
    bindingKind: "erc4626_vault_supply_withdraw",
    strategyId: "gateway_native_asset_conversion_sleeve",
    amount: "250000",
    amountUsd: 0.25,
    shareDelta: "239017",
    assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
    minHoldUntil: "2026-04-24T06:46:49.813Z",
    ...overrides,
  };
}

function queueItem(overrides = {}) {
  return {
    opportunityId: "opp-1",
    chain: "base",
    protocolId: "yo",
    priorityScore: 105,
    campaignRemainingHours: 120,
    aprPct: 12,
    tvlUsd: 20_000_000,
    overfitRisk: "low",
    capabilityGaps: [],
    ...overrides,
  };
}

test("exit evaluator holds before min hold expires", () => {
  const result = evaluateMerklPositionExit({
    position: position(),
    queue: { queue: [queueItem({ campaignRemainingHours: 1 })] },
    now: "2026-04-24T06:20:00.000Z",
  });

  assert.equal(result.status, "hold");
  assert.ok(result.triggers.includes("campaign_expires_inside_exit_lookahead"));
  assert.ok(result.blockers.includes("min_hold_not_elapsed"));
});

test("exit evaluator marks position ready when opportunity disappears after min hold", () => {
  const result = evaluateMerklPositionExit({
    position: position(),
    queue: { queue: [] },
    now: "2026-04-24T06:50:00.000Z",
  });

  assert.equal(result.status, "exit_ready");
  assert.ok(result.triggers.includes("opportunity_missing_from_merkl_queue"));
});

test("force exit bypasses min hold blocker", () => {
  const result = evaluateMerklPositionExit({
    position: position(),
    queue: { queue: [queueItem()] },
    now: "2026-04-24T06:20:00.000Z",
    force: true,
  });

  assert.equal(result.status, "exit_ready");
  assert.ok(result.triggers.includes("force_exit_requested"));
  assert.equal(result.blockers.length, 0);
});

test("exit evaluator triggers underperform exits after min hold", () => {
  const result = evaluateMerklPositionExit({
    position: position({
      entryAprPct: 12,
      rewardTokenPriceUsdAtEntry: 2,
      volume24hUsdAtEntry: 1_000_000,
    }),
    queue: {
      queue: [
        queueItem({
          aprPct: 5,
          rewardTokenPriceUsd: 0.9,
          volume24hUsd: 250_000,
        }),
      ],
    },
    now: "2026-04-24T06:50:00.000Z",
  });

  assert.equal(result.status, "exit_ready");
  assert.ok(result.triggers.includes("realized_apr_below_entry_ratio"));
  assert.ok(result.triggers.includes("reward_token_price_drop"));
  assert.ok(result.triggers.includes("volume_24h_drop"));
});

test("rebalance exit plan selects excess-chain positions closest to target", () => {
  const positions = [
    position({
      positionId: "eth-a",
      chain: "ethereum",
      amountUsd: 75,
      score: 117,
    }),
    position({
      positionId: "eth-b",
      chain: "ethereum",
      amountUsd: 50,
      score: 90,
    }),
    position({
      positionId: "eth-c",
      chain: "ethereum",
      amountUsd: 25,
      score: 80,
    }),
    position({
      positionId: "base-a",
      chain: "base",
      amountUsd: 100,
      score: 130,
    }),
  ];

  const plan = buildMerklPortfolioRebalanceExitPlan({
    positions,
    targetChainUsd: {
      ethereum: 75,
      base: 120,
    },
    toleranceUsd: 1,
  });

  assert.equal(plan.status, "rebalance_exit_ready");
  assert.deepEqual(
    plan.positionsToExit.map((item) => item.positionId).sort(),
    ["eth-b", "eth-c"],
  );
  assert.equal(plan.chainPlans.ethereum.currentUsd, 150);
  assert.equal(plan.chainPlans.ethereum.targetUsd, 75);
  assert.equal(plan.chainPlans.ethereum.selectedExitUsd, 75);
  assert.equal(plan.chainPlans.base.selectedExitUsd, 0);
});

test("rebalance exit plan counts external wallet inventory before selecting exits", () => {
  const plan = buildMerklPortfolioRebalanceExitPlan({
    positions: [
      position({ positionId: "base-active", chain: "base", amountUsd: 100, score: 120 }),
      position({ positionId: "eth-active", chain: "ethereum", amountUsd: 150, score: 80 }),
    ],
    externalChainUsd: {
      base: 80,
      ethereum: 130,
    },
    targetChainUsd: {
      base: 180,
      ethereum: 100,
    },
    toleranceUsd: 1,
  });

  assert.deepEqual(plan.chainPlans.base.selectedPositionIds, []);
  assert.deepEqual(plan.chainPlans.ethereum.selectedPositionIds, ["eth-active"]);
  assert.equal(plan.chainPlans.base.currentUsd, 180);
  assert.equal(plan.chainPlans.ethereum.currentUsd, 280);
});

test("exit confirmation timeout stays bounded inside longer orchestrator timeout", () => {
  assert.equal(confirmationTimeoutMsForExit(), 120_000);
  assert.equal(confirmationTimeoutMsForExit(30_000), 30_000);
  assert.equal(confirmationTimeoutMsForExit(300_000), 120_000);
});

test("exit evaluator marks rebalance-selected position ready after min hold", () => {
  const rebalanceExitPlan = {
    positionsById: {
      p1: {
        trigger: "portfolio_chain_target_rebalance",
        chain: "ethereum",
        targetUsd: 15,
        currentUsd: 283,
      },
    },
  };

  const result = evaluateMerklPositionExit({
    position: position({ chain: "ethereum" }),
    queue: { queue: [queueItem()] },
    now: "2026-04-24T06:50:00.000Z",
    rebalanceExitPlan,
  });

  assert.equal(result.status, "exit_ready");
  assert.ok(result.triggers.includes("portfolio_chain_target_rebalance"));
  assert.equal(result.rebalance.chain, "ethereum");
});

test("portfolio exit execution continues after one position errors", async () => {
  const exitReady = [
    {
      positionId: "p1",
      opportunityId: "opp-1",
      triggers: ["portfolio_chain_target_rebalance"],
    },
    {
      positionId: "p2",
      opportunityId: "opp-2",
      triggers: ["portfolio_chain_target_rebalance"],
    },
  ];
  const positions = [
    position({ positionId: "p1", opportunityId: "opp-1" }),
    position({ positionId: "p2", opportunityId: "opp-2" }),
  ];
  const appended = [];

  const executions = await executeReadyMerklPortfolioExits({
    exitReady,
    positions,
    queue: { queue: [queueItem({ opportunityId: "opp-1" }), queueItem({ opportunityId: "opp-2" })] },
    senderAddress: "0x2222222222222222222222222222222222222222",
    executePositionImpl: async ({ position: executionPosition }) => {
      if (executionPosition.positionId === "p1") throw new Error("mock exit revert");
      return {
        observedAt: "2026-04-24T06:55:00.000Z",
        settlementStatus: "position_closed",
        signerResult: { broadcast: { txHash: "0xclosed" } },
        redeemProof: { status: "delivered" },
      };
    },
    appendRecord: async (record) => appended.push(record),
  });

  assert.equal(executions.length, 2);
  assert.equal(executions[0].status, "error");
  assert.equal(executions[0].error.message, "mock exit revert");
  assert.equal(executions[1].status, "position_closed");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].positionId, "p2");
});

test("portfolio exit reconciles zero share balances as closed", async () => {
  const appended = [];
  const executions = await executeReadyMerklPortfolioExits({
    exitReady: [{
      positionId: "p1",
      opportunityId: "opp-1",
      triggers: ["portfolio_chain_target_rebalance"],
    }],
    positions: [position()],
    queue: { queue: [queueItem()] },
    senderAddress: "0x2222222222222222222222222222222222222222",
    executePositionImpl: async () => {
      const error = new Error("No shares available to redeem");
      error.name = "NoPositionShares";
      error.zeroShareProof = {
        status: "reconciled_zero_share_balance",
        proofSource: "erc20_balance_zero",
        shareBalance: "0",
      };
      throw error;
    },
    appendRecord: async (record) => appended.push(record),
  });

  assert.equal(executions[0].status, "position_reconciled_zero_balance");
  assert.equal(appended[0].status, "closed");
  assert.equal(appended[0].event, "position_exit_reconciled_zero_balance");
  assert.equal(appended[0].redeemProof.proofSource, "erc20_balance_zero");
});

test("ERC4626 portfolio exit stamps expected target for signer semantic validation", async () => {
  const calls = [];
  let capturedIntent = null;
  const sender = "0x2222222222222222222222222222222222222222";
  const assetAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const shareTokenAddress = "0x0000000f2eB9f69274678c76222B35eEc7588a65";
  const vaultAddress = "0x9999999999999999999999999999999999999999";
  const result = await executeErc4626PortfolioExit({
    position: position({
      assetAddress,
      shareTokenAddress,
      vaultAddress,
      amount: "250000",
      shareDelta: "250000",
    }),
    senderAddress: sender,
    sendCommand: async ({ message }) => {
      capturedIntent = message.intent;
      return { status: "ok", broadcast: { txHash: "0xerc4626redeem" } };
    },
    estimateGasImpl: async () => ({ gasUnits: 180_000 }),
    readErc20BalanceImpl: async (chain, token, owner) => {
      calls.push({ chain, token, owner });
      if (token.toLowerCase() === assetAddress.toLowerCase()) {
        return {
          rpcUrl: "mock",
          balance: calls.filter((call) => call.token.toLowerCase() === assetAddress.toLowerCase()).length === 1
            ? "1000000"
            : "1240000",
        };
      }
      return {
        rpcUrl: "mock",
        balance: calls.filter((call) => call.token.toLowerCase() === shareTokenAddress.toLowerCase()).length === 1
          ? "250000"
          : "0",
      };
    },
    settlementTimeoutMs: 0,
    pollIntervalMs: 0,
    sleepImpl: async () => {},
  });

  assert.equal(result.settlementStatus, "position_closed");
  assert.equal(capturedIntent.intentType, "erc4626_redeem");
  assert.equal(capturedIntent.executionReason, "risk_unwind");
  assert.equal(capturedIntent.tx.to, vaultAddress);
  assert.equal(capturedIntent.metadata.expectedTxTo, vaultAddress);
  assert.equal(validateEvmTransactionSemantics(capturedIntent), true);
});

test("Aave portfolio exit withdraws through the pool and verifies asset delta", async () => {
  const calls = [];
  let capturedIntent = null;
  const sender = "0x2222222222222222222222222222222222222222";
  const assetAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const shareTokenAddress = "0x3333333333333333333333333333333333333333";
  const poolAddress = "0x1111111111111111111111111111111111111111";
  const result = await executeAavePortfolioExit({
    position: {
      ...position({
        chain: "ethereum",
        protocolId: "aave",
        bindingKind: "aave_v3_pool_supply_withdraw",
        assetAddress,
        shareTokenAddress,
        poolAddress,
        amount: "250000",
        shareDelta: "250000",
      }),
    },
    senderAddress: sender,
    sendCommand: async ({ message }) => {
      capturedIntent = message.intent;
      return { status: "ok", broadcast: { txHash: "0xaavewithdraw" } };
    },
    estimateGasImpl: async () => ({ gasUnits: 180_000 }),
    readErc20BalanceImpl: async (chain, token, owner) => {
      calls.push({ chain, token, owner });
      if (token.toLowerCase() === assetAddress.toLowerCase()) {
        return {
          rpcUrl: "mock",
          balance: calls.filter((call) => call.token.toLowerCase() === assetAddress.toLowerCase()).length === 1
            ? "1000000"
            : "1240000",
        };
      }
      return {
        rpcUrl: "mock",
        balance: calls.filter((call) => call.token.toLowerCase() === shareTokenAddress.toLowerCase()).length === 1
          ? "250000"
          : "0",
      };
    },
    settlementTimeoutMs: 0,
    pollIntervalMs: 0,
    sleepImpl: async () => {},
  });

  assert.equal(result.settlementStatus, "position_closed");
  assert.equal(capturedIntent.intentType, "aave_withdraw");
  assert.equal(capturedIntent.executionReason, "risk_unwind");
  assert.equal(capturedIntent.tx.to, poolAddress);
  assert.equal(capturedIntent.metadata.expectedTxTo, poolAddress);
  assert.equal(validateEvmTransactionSemantics(capturedIntent), true);
  assert.equal(capturedIntent.metadata.poolAddress, poolAddress);
  assert.equal(result.redeemProof.requiredDelta, "237500");
  assert.equal(result.redeemProof.observedDelta, "240000");
});
