import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GAS_ZIP_NATIVE_REFUEL_STRATEGY_ID,
  buildGasZipNativeRefuelPlan,
  executeGasZipNativeRefuelPlan,
} from "../src/executor/helpers/gas-zip-refuel.mjs";
import { buildTreasuryRefillExecutionPlan, refillExecutorForJob } from "../src/executor/helpers/treasury-refill-job.mjs";

function pricesFixture() {
  return {
    btc: 100_000,
    tokenByKey: {
      btc: 100_000,
      ethereum: 2_000,
      usd_stable: 1,
    },
    nativeByChain: {
      base: 2_000,
      bsc: 600,
    },
  };
}

test("Gas.Zip refill executor is selected for gas-only native fallback jobs", () => {
  assert.equal(refillExecutorForJob({
    executionMethod: "gas_refuel_bridge_gas_zip",
    type: "refill_native",
  }), "gas_zip_native_refuel");
});

test("Gas.Zip build plan wires direct-deposit tx and destination proof target", async () => {
  const plan = await buildGasZipNativeRefuelPlan({
    srcChain: "base",
    dstChain: "bsc",
    amountWei: "1000000000000000",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    priceReader: async () => pricesFixture(),
    quoteFetcher: async () => ({
      calldata: "0x010e",
      quotes: [
        {
          chain: 56,
          expected: "990000000000000",
          gas: "10000000000000",
          usd: 0.594,
          speed: 7,
        },
      ],
    }),
    estimateGasImpl: async () => ({
      gasUnits: 120_000,
      rpcUrl: "https://base.example",
    }),
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.strategyId, GAS_ZIP_NATIVE_REFUEL_STRATEGY_ID);
  assert.equal(plan.gasZip.directAddress, "0x391E7C679d29bD940d63be94AD22A25d25b5A604");
  assert.equal(plan.gasZip.destinationShortId, 14);
  assert.equal(plan.intent.intentType, "gas_zip_native_refuel");
  assert.equal(plan.intent.tx.to, plan.gasZip.directAddress);
  assert.equal(plan.intent.tx.data, "0x010e");
  assert.equal(plan.quote.expectedOutputWei, "990000000000000");
});

test("Gas.Zip refill preparation becomes ready once executor exists and proof is post-settlement only", async () => {
  let capturedInput = null;
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-gaszip",
      type: "refill_native",
      chain: "bsc",
      targetAmount: "1000000000000000",
      estimatedAssetValueUsd: 0.6,
      executionMethod: "gas_refuel_bridge_gas_zip",
      fundingSource: {
        selectionStatus: "ready",
        source: {
          chain: "base",
          token: "0x0000000000000000000000000000000000000000",
          actual: "10000000000000000",
          actualDecimal: 0.01,
          estimatedUsd: 20,
        },
      },
    },
    senderAddress: "0x1111111111111111111111111111111111111111",
    buildGasZipPlanImpl: async (input) => {
      capturedInput = input;
      return {
      planStatus: "ready",
      quote: { expectedOutputWei: "1100000000000000" },
      };
    },
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.executor, "gas_zip_native_refuel");
  assert.equal(capturedInput.amountWei, "312000000000000");
  assert.equal(capturedInput.minimumDestinationWei, "1000000000000000");
  assert.equal(preparation.coverage.coversTarget, true);
});

test("Gas.Zip refill preparation blocks when expected destination output is below target", async () => {
  const preparation = await buildTreasuryRefillExecutionPlan({
    job: {
      jobId: "job-gaszip-underfilled",
      type: "refill_native",
      chain: "bsc",
      targetAmount: "1000000000000000",
      estimatedAssetValueUsd: 0.6,
      executionMethod: "gas_refuel_bridge_gas_zip",
      fundingSource: {
        selectionStatus: "ready",
        source: {
          chain: "base",
          token: "0x0000000000000000000000000000000000000000",
          actual: "10000000000000000",
          actualDecimal: 0.01,
          estimatedUsd: 20,
        },
      },
    },
    senderAddress: "0x1111111111111111111111111111111111111111",
    buildGasZipPlanImpl: async () => ({
      planStatus: "ready",
      quote: { expectedOutputWei: "990000000000000" },
    }),
  });

  assert.equal(preparation.status, "blocked");
  assert.equal(preparation.executor, "gas_zip_native_refuel");
  assert.equal(preparation.blockedReason, "executor_output_below_refill_target");
  assert.equal(preparation.coverage.coversTarget, false);
});

test("Gas.Zip execution waits for destination native delta and ingests receipt", async () => {
  let balanceReads = 0;
  const execution = await executeGasZipNativeRefuelPlan({
    plan: {
      intent: {
        strategyId: GAS_ZIP_NATIVE_REFUEL_STRATEGY_ID,
      },
      gasPreflight: { gasLimit: 140_000 },
      srcChain: "base",
      dstChain: "bsc",
      recipient: "0x2222222222222222222222222222222222222222",
      dstAsset: {
        chain: "bsc",
        token: "0x0000000000000000000000000000000000000000",
        ticker: "BNB",
        decimals: 18,
        isNative: true,
        priceKey: "bsc",
      },
      quote: {
        expectedOutputWei: "1000",
      },
      minimumDestinationWei: "990",
    },
    sendCommand: async () => ({
      status: "ok",
      broadcast: {
        txHash: "0xgaszip",
      },
      receipt: {
        status: 1,
        gasUsed: "21000",
        effectiveGasPrice: "1000000000",
      },
      signed: {
        metadata: {
          from: "0x1111111111111111111111111111111111111111",
          to: "0x391E7C679d29bD940d63be94AD22A25d25b5A604",
          nonce: 1,
        },
      },
    }),
    readNativeBalanceImpl: async () => {
      balanceReads += 1;
      return {
        rpcUrl: "https://bsc.example",
        balanceWei: balanceReads === 1 ? 2000n : 2990n,
      };
    },
    destinationSettlementTimeoutMs: 1,
    destinationPollIntervalMs: 0,
    sleepImpl: async () => {},
    receiptIngest: async ({ execution: record }) => ({
      appended: true,
      reason: record.destinationProof.status,
    }),
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.destinationProof.observedDelta, "990");
  assert.equal(execution.destinationProof.requiredDelta, "990");
  assert.equal(execution.receiptIngest.appended, true);
});
