import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWrappedBtcLoopReceiptContext,
  buildWrappedBtcLoopScenarioPlan,
} from "../src/executor/strategies/wrapped-btc-loop-live.mjs";

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
  });

  assert.equal(plan.entryIntents.length > 3, true);
  assert.equal(plan.unwindIntents.length > 0, true);
  assert.equal(plan.entryIntents.some((item) => item.metadata?.provider === "odos"), true);
  assert.equal(plan.entryIntents.some((item) => item.approval?.mode === "per_tx"), true);
});
