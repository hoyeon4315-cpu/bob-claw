import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWrappedBtcLoopDepositHandoffPlan,
  buildWrappedBtcLoopHandoffCommands,
  executeWrappedBtcLoopDepositHandoffPlan,
  isWrappedBtcLoopDepositHandoffCandidate,
} from "../src/executor/helpers/wrapped-btc-loop-handoff.mjs";

function odosClientFixture() {
  return {
    quote: async () => ({
      latencyMs: 111,
      body: {
        inAmounts: ["10000"],
        outAmounts: ["9900"],
        inValues: [7.5],
        outValues: [7.4],
        netOutValue: 7.35,
        gasEstimate: 200000,
        gasEstimateValue: 0.003,
        priceImpact: 0,
        percentDiff: -0.1,
        pathId: "path-123",
        blockNumber: 1,
      },
    }),
    assemble: async () => ({
      latencyMs: 55,
      body: {
        transaction: {
          to: "0x7777777777777777777777777777777777777777",
          data: "0xabcdef",
          value: "0",
          gas: "210000",
        },
      },
    }),
  };
}

function estimateGasFixture() {
  return {
    observedAt: "2026-04-21T08:00:01.000Z",
    chain: "base",
    rpcUrl: "https://base-rpc.example",
    latencyMs: 12,
    gasUnits: 100_000,
    gasUnitsHex: "0x186a0",
    rpcFallbacksTried: 0,
  };
}

function gasSnapshotFixture() {
  return {
    observedAt: "2026-04-21T08:00:02.000Z",
    chain: "base",
    rpcUrl: "https://base-rpc.example",
    latencyMs: 9,
    blockNumber: 1,
    gasPriceWei: "100",
    baseFeeWei: "80",
    priorityFeeWei: "20",
  };
}

test("wrapped BTC handoff candidate matches Base wBTC.OFT to cbBTC", () => {
  assert.equal(
    isWrappedBtcLoopDepositHandoffCandidate({
      chain: "base",
      landedAsset: "wBTC.OFT",
      targetAsset: "cbBTC",
    }),
    true,
  );
  assert.equal(
    isWrappedBtcLoopDepositHandoffCandidate({
      chain: "base",
      landedAsset: "USDC",
      targetAsset: "cbBTC",
    }),
    false,
  );
});

test("wrapped BTC handoff commands include preview and execute surfaces", () => {
  const commands = buildWrappedBtcLoopHandoffCommands({
    amountSats: 10000,
    senderAddress: "0x1111111111111111111111111111111111111111",
  });
  assert.match(commands.previewHandoff, /executor:wrapped-btc-loop-handoff/);
  assert.match(commands.previewHandoff, /--amount-sats="10000"/);
  assert.match(commands.executeHandoff, /--execute/);
  assert.match(commands.loopIntentPreview, /--command=sign_only/);
});

test("wrapped BTC handoff plan wraps token dex conversion into cbBTC", async () => {
  const plan = await buildWrappedBtcLoopDepositHandoffPlan({
    amountSats: 10000,
    senderAddress: "0x1111111111111111111111111111111111111111",
    client: odosClientFixture(),
    estimateGasImpl: async () => estimateGasFixture(),
    gasSnapshotImpl: async () => gasSnapshotFixture(),
    now: "2026-04-21T08:00:00.000Z",
  });

  assert.equal(plan.handoffStatus, "conversion_ready");
  assert.equal(plan.sourceAsset, "wBTC.OFT");
  assert.equal(plan.targetAsset, "cbBTC");
  assert.equal(plan.conversionPlan.outputAsset.ticker, "cbBTC");
  assert.match(plan.commands.executeHandoff, /executor:wrapped-btc-loop-handoff/);
  assert.deepEqual(plan.nextCommands, [
    "npm run executor:wrapped-btc-loop -- --command=sign_only --json",
    "npm run run:wrapped-btc-loop-dry-run -- --json",
    "npm run report:wrapped-btc-loop -- --json",
  ]);
});

test("wrapped BTC handoff execution delegates to token dex settlement proof", async () => {
  const plan = await buildWrappedBtcLoopDepositHandoffPlan({
    amountSats: 10000,
    senderAddress: "0x1111111111111111111111111111111111111111",
    client: odosClientFixture(),
    estimateGasImpl: async () => estimateGasFixture(),
    gasSnapshotImpl: async () => gasSnapshotFixture(),
    now: "2026-04-21T08:00:00.000Z",
  });

  let stepIndex = 0;
  const execution = await executeWrappedBtcLoopDepositHandoffPlan({
    handoffPlan: plan,
    destinationSettlementTimeoutMs: 1000,
    destinationPollIntervalMs: 0,
    readErc20BalanceImpl: async (_chain, token) => ({
      rpcUrl: "https://base-rpc.example",
      balance: BigInt(String(token).toLowerCase() === String(plan.conversionPlan.inputToken).toLowerCase()
        ? (stepIndex > 1 ? 0 : 10000)
        : (stepIndex > 1 ? 9900 : 0)),
    }),
    sendCommand: async () => {
      stepIndex += 1;
      return {
        status: "ok",
        broadcast: {
          txHash: `0xhash${stepIndex}`,
        },
        receipt: {
          hash: `0xhash${stepIndex}`,
          status: 1,
        },
      };
    },
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
  });

  assert.equal(execution.handoffStatus, "converted");
  assert.equal(execution.conversionExecution.settlementStatus, "delivered");
  assert.equal(execution.conversionExecution.destinationProof.requiredDelta, "9850");
});
