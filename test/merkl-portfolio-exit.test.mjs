import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMerklPositionExit } from "../src/executor/merkl-portfolio-exit.mjs";
import { executeAavePortfolioExit } from "../src/executor/helpers/merkl-portfolio-exit-executors.mjs";

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
  assert.equal(capturedIntent.tx.to, poolAddress);
  assert.equal(capturedIntent.metadata.poolAddress, poolAddress);
  assert.equal(result.redeemProof.requiredDelta, "237500");
  assert.equal(result.redeemProof.observedDelta, "240000");
});
