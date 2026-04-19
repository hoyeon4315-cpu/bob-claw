import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWrappedBtcLoopReceiptContext,
  classifyIntentResult,
  buildWrappedBtcLoopScenarioPlan,
  finalizeWrappedBtcLoopLiveReceipt,
  prepareLiveLoopIntent,
} from "../src/executor/strategies/wrapped-btc-loop-live.mjs";
import { WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE } from "../src/strategy/wrapped-btc-loop-live-proof.mjs";

function bindingsFixture() {
  return {
    strategies: {
      "wrapped-btc-loop-base-moonwell": {
        scenarios: {
          healthy_baseline: {
            entry: [
              {
                id: "approve",
                amountUsd: 300,
                tx: {
                  to: "0x0000000000000000000000000000000000000001",
                  data: "0xabcdef",
                },
              },
            ],
            unwind: [
              {
                id: "withdraw",
                amountUsd: 300,
                tx: {
                  to: "0x0000000000000000000000000000000000000002",
                  data: "0x123456",
                },
              },
            ],
            receiptContext: {
              observedHealthFactorPath: [1.5, 1.42],
              observedLiquidationBufferPath: [18, 13],
              realizedNetCarryUsd: 0.04,
            },
          },
        },
      },
    },
  };
}

function blockedBindingsFixture() {
  return {
    schemaVersion: 1,
    strategies: {
      "wrapped-btc-loop-base-moonwell": {
        missingFacts: [
          "The repo still does not provide an allowlisted Base swap router/path encoder that can deterministically materialize the USDC↔collateral swap calldata required by the live batch runner.",
        ],
        scenarios: {
          healthy_baseline: {
            entry: [],
            unwind: [],
            receiptContext: {},
          },
        },
      },
    },
  };
}

const estimateGasFixture = async () => ({
  observedAt: "2026-04-17T00:00:01.000Z",
  chain: "base",
  rpcUrl: "https://base-rpc.example",
  latencyMs: 10,
  gasUnits: 180_000,
  gasUnitsHex: "0x2bf20",
  rpcFallbacksTried: 0,
});

test("wrapped loop live plan builds signer intents with batch auto-ingest disabled", async () => {
  const plan = await buildWrappedBtcLoopScenarioPlan({
    bindingsDocument: bindingsFixture(),
    scenarioId: "healthy_baseline",
    now: "2026-04-17T00:00:00.000Z",
  });

  assert.equal(plan.entryIntents.length, 1);
  assert.equal(plan.unwindIntents.length, 1);
  assert.equal(plan.entryIntents[0].metadata.skipAutoIngest, true);
  assert.equal(plan.unwindIntents[0].executionReason, "risk_unwind");
  assert.equal(plan.entryIntents[0].quote.observedAt, "2026-04-17T00:00:00.000Z");
  assert.equal(plan.entryIntents[0].intentId, "wrapped-btc-loop-base-moonwell:entry:approve");
  assert.equal(plan.entryIntents[0].strategyConfig.collateralAsset, "cbBTC");
});

test("wrapped loop receipt context derives fee totals from EVM receipts when bindings omit them", async () => {
  const plan = await buildWrappedBtcLoopScenarioPlan({
    bindingsDocument: bindingsFixture(),
    scenarioId: "healthy_baseline",
  });

  const receiptContext = buildWrappedBtcLoopReceiptContext({
    plan,
    entryResults: [
      {
        intent: { chain: "base" },
        broadcast: { txHash: "0xentry" },
        receipt: {
          fee: "1000000000000000",
        },
      },
    ],
    unwindResults: [
      {
        intent: { chain: "base" },
        broadcast: { txHash: "0xunwind" },
        receipt: {
          fee: "500000000000000",
        },
      },
    ],
    prices: {
      nativeByChain: {
        base: 2000,
      },
    },
  });

  assert.deepEqual(receiptContext.entryTxHashes, ["0xentry"]);
  assert.deepEqual(receiptContext.unwindTxHashes, ["0xunwind"]);
  assert.equal(receiptContext.actualLoopFeesUsd, 2);
  assert.equal(receiptContext.actualUnwindCostUsd, 1);
  assert.equal(receiptContext.realizedNetCarryUsd, 0.04);
});

test("wrapped loop live plan auto-builds Moonwell and Odos steps when bindings stay empty", async () => {
  const odosClient = {
    quote: async () => ({
      latencyMs: 10,
      body: {
        outAmounts: ["1332"],
        pathId: "path-1",
      },
    }),
    assemble: async () => ({
      latencyMs: 12,
      body: {
        transaction: {
          to: "0x0000000000000000000000000000000000000d05",
          data: "0x12345678",
          value: "0",
          gas: 210000,
        },
      },
    }),
  };
  const plan = await buildWrappedBtcLoopScenarioPlan({
    bindingsDocument: blockedBindingsFixture(),
    scenarioId: "healthy_baseline",
    signerAddress: "0x0000000000000000000000000000000000000001",
    prices: {
      btc: 75000,
      tokenByKey: {
        btc: 75000,
        usd_stable: 1,
      },
    },
    odosClient,
    estimateGasImpl: estimateGasFixture,
  });

  assert.equal(plan.entryIntents.length > 3, true);
  assert.equal(plan.unwindIntents.length > 0, true);
  assert.equal(plan.entryIntents.some((item) => item.metadata?.provider === "odos"), true);
  assert.equal(plan.entryIntents.some((item) => item.approval?.mode === "per_tx"), true);
  assert.equal(plan.entryIntents.find((item) => item.intentId.endsWith(":entry:approve-initial-collateral")).metadata.capCheckAmountUsd, 0);
  assert.equal(plan.entryIntents.find((item) => item.intentId.endsWith(":entry:enter-collateral-market")).metadata.capCheckAmountUsd, 0);
  assert.equal(plan.entryIntents.find((item) => item.intentId.endsWith(":entry:mint-initial-collateral")).metadata.capCheckAmountUsd, 300);
  assert.equal(plan.entryIntents.find((item) => item.intentId.endsWith(":entry:borrow-usdc-1")).metadata.capCheckAmountUsd, 0);
});

test("wrapped loop live plan supports tiny per-trade override with collateral-only unwind", async () => {
  const plan = await buildWrappedBtcLoopScenarioPlan({
    bindingsDocument: blockedBindingsFixture(),
    scenarioId: "healthy_baseline",
    signerAddress: "0x0000000000000000000000000000000000000001",
    prices: {
      btc: 75000,
      tokenByKey: {
        btc: 75000,
        usd_stable: 1,
      },
    },
    estimateGasImpl: estimateGasFixture,
    perTradeCapUsdOverride: 7,
  });

  assert.equal(plan.entryIntents.length, 3);
  assert.equal(plan.unwindIntents.length, 1);
  assert.equal(plan.entryIntents.find((item) => item.intentId.endsWith(":entry:mint-initial-collateral")).amountUsd, 7);
  assert.equal(plan.unwindIntents[0].intentId.endsWith(":unwind:redeem-initial-collateral"), true);
  assert.equal(plan.unwindIntents[0].metadata.tinyValidationOnly, true);
});

test("wrapped loop live plan supports tiny borrow cycle override and full unwind path", async () => {
  const odosClient = {
    quote: async () => ({
      latencyMs: 10,
      body: {
        outAmounts: ["4200"],
        pathId: "path-borrow-1",
      },
    }),
    assemble: async () => ({
      latencyMs: 12,
      body: {
        transaction: {
          to: "0x0000000000000000000000000000000000000d05",
          data: "0x12345678",
          value: "0",
          gas: 210000,
        },
      },
    }),
  };
  const plan = await buildWrappedBtcLoopScenarioPlan({
    bindingsDocument: blockedBindingsFixture(),
    scenarioId: "healthy_baseline",
    signerAddress: "0x0000000000000000000000000000000000000001",
    prices: {
      btc: 75000,
      tokenByKey: {
        btc: 75000,
        usd_stable: 1,
      },
    },
    odosClient,
    estimateGasImpl: estimateGasFixture,
    perTradeCapUsdOverride: 7,
    marketAssumptionsOverride: {
      minIncrementUsd: 1,
    },
  });

  assert.equal(plan.entryIntents.some((item) => item.intentId.endsWith(":entry:borrow-usdc-1")), true);
  assert.equal(plan.entryIntents.some((item) => item.intentId.endsWith(":entry:mint-recycled-collateral-1")), true);
  assert.equal(plan.unwindIntents.some((item) => item.intentId.endsWith(":unwind:repay-usdc-1")), true);
  assert.equal(plan.unwindIntents.some((item) => item.intentId.endsWith(":unwind:redeem-collateral-1")), true);
  assert.equal(plan.unwindIntents.some((item) => item.intentId.endsWith(":unwind:redeem-initial-collateral")), true);
});

test("wrapped loop signer result treats reverted EVM receipts as execution failure", () => {
  const result = classifyIntentResult({
    status: "ok",
    receipt: {
      status: 0,
    },
  });

  assert.equal(result.status, "error");
  assert.equal(result.error.name, "EvmReceiptReverted");
});

test("wrapped loop live receipt writes proof before auto-ingest and rewrites final ingest status", async () => {
  const writes = [];
  const ingestCalls = [];

  const finalized = await finalizeWrappedBtcLoopLiveReceipt({
    strategyId: "wrapped-btc-loop-base-moonwell",
    scenarioId: "healthy_baseline",
    perTradeCapUsdOverride: 5,
    entryResults: [
      { broadcast: { txHash: "0xentry1" } },
      { broadcast: { txHash: "0xentry2" } },
    ],
    unwindResults: [
      { broadcast: { txHash: "0xunwind1" } },
    ],
    receiptContext: {
      actualLoopFeesUsd: 0.01,
      actualUnwindCostUsd: 0.02,
      realizedNetCarryUsd: 0,
    },
    now: "2026-04-19T12:00:00.000Z",
    dataDir: "/tmp/bob-claw-test",
    writeTextIfChangedImpl: async (path, contents) => {
      writes.push({
        path,
        proof: JSON.parse(contents),
      });
      return { path, changed: true };
    },
    runReceiptAutoIngestImpl: async ({ context, cwd }) => {
      ingestCalls.push({ context, cwd });
      return {
        ran: true,
        code: 0,
        stdout: "ok",
        stderr: "",
      };
    },
  });

  assert.equal(writes.length, 2);
  assert.equal(writes[0].path.endsWith(WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE), true);
  assert.equal(writes[0].proof.receiptAutoIngest.ran, false);
  assert.deepEqual(writes[0].proof.entryTxHashes, ["0xentry1", "0xentry2"]);
  assert.deepEqual(writes[0].proof.unwindTxHashes, ["0xunwind1"]);
  assert.equal(ingestCalls.length, 1);
  assert.deepEqual(ingestCalls[0].context.entryTxHashes, ["0xentry1", "0xentry2"]);
  assert.deepEqual(ingestCalls[0].context.unwindTxHashes, ["0xunwind1"]);
  assert.equal(writes[1].proof.receiptAutoIngest.ran, true);
  assert.equal(finalized.receiptAutoIngest.ran, true);
  assert.equal(finalized.liveProof.receiptAutoIngest.ran, true);
});

test("wrapped loop live intent refreshes gas limit just before execution", async () => {
  const prepared = await prepareLiveLoopIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    tx: {
      to: "0x0000000000000000000000000000000000000001",
      data: "0xabcdef",
      value: "0",
      gasLimit: "21000",
    },
  }, {
    signerAddress: "0x0000000000000000000000000000000000000001",
    estimateGasImpl: async () => ({
      gasUnits: 100_000,
    }),
  });

  assert.equal(prepared.tx.gasLimit, "120000");
});

test("wrapped loop live intent preserves existing gas limit when refresh estimate fails", async () => {
  const prepared = await prepareLiveLoopIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    tx: {
      to: "0x0000000000000000000000000000000000000001",
      data: "0xabcdef",
      value: "0",
      gasLimit: "21000",
    },
  }, {
    signerAddress: "0x0000000000000000000000000000000000000001",
    estimateGasImpl: async () => {
      throw new Error("estimate failed");
    },
  });

  assert.equal(prepared.tx.gasLimit, "21000");
});

test("wrapped loop live intent refreshes observedAt for non-swap internal steps", async () => {
  const prepared = await prepareLiveLoopIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    intentType: "wrapped_btc_loop_entry",
    observedAt: "2026-04-16T00:00:00.000Z",
    quote: {
      observedAt: "2026-04-16T00:00:00.000Z",
    },
    tx: {
      to: "0x0000000000000000000000000000000000000001",
      data: "0xabcdef",
      value: "0",
      gasLimit: "21000",
    },
  }, {
    signerAddress: null,
  });

  assert.notEqual(prepared.observedAt, "2026-04-16T00:00:00.000Z");
  assert.equal(prepared.quote.observedAt, prepared.observedAt);
});
