import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { appendExecutionReceiptReconciliation } from "../src/executor/ingestor/execution-receipt-ingest.mjs";

test("execution receipt ingest reconciles Gas.Zip native refuel with destination native delta", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-gaszip-ingest-"));
  const result = await appendExecutionReceiptReconciliation({
    dataDir,
    priceReader: async () => ({
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
    }),
    execution: {
      observedAt: "2026-04-20T10:00:00.000Z",
      plan: {
        strategyId: "gas-zip-native-refuel",
        srcChain: "base",
        dstChain: "bsc",
        amountWei: "1000000000000000",
        amountUsd: 2,
        quote: {
          outputValueUsd: 0.594,
        },
      },
      signerResult: {
        broadcast: {
          txHash: "0xgaszip-ingest",
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
            nonce: 9,
          },
        },
      },
      destinationProof: {
        status: "delivered",
        observedDelta: "990000000000000",
      },
    },
  });

  assert.equal(result.appended, true);
  assert.equal(result.receiptRecord.kind, "gas_zip_native_refuel");
  assert.equal(result.receiptRecord.routeContext.routeKey, "base:native->bsc:native");
  assert.equal(result.receiptRecord.output.actualOutputUnits, "990000000000000");
});

test("execution receipt ingest reconciles Across bridge output token delta", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-across-ingest-"));
  const result = await appendExecutionReceiptReconciliation({
    dataDir,
    priceReader: async () => ({
      btc: 100_000,
      tokenByKey: { usd_stable: 1 },
      nativeByChain: { base: 2_000, optimism: 2_000 },
    }),
    execution: {
      observedAt: "2026-04-22T10:00:00.000Z",
      plan: {
        strategyId: "across-bridge",
        srcChain: "base",
        dstChain: "optimism",
        srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        dstToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        amountUsd: 100,
        quote: {
          inputAmount: "100000000",
          outputAmount: "99000000",
        },
        intent: {
          tx: {
            to: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
            value: "0",
          },
        },
      },
      signerResult: {
        broadcast: { txHash: "0xacross-ingest" },
        receipt: {
          status: 1,
          gasUsed: "150000",
          effectiveGasPrice: "1000000000",
        },
        signed: {
          metadata: {
            from: "0x1111111111111111111111111111111111111111",
            to: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
            nonce: 10,
          },
        },
      },
      destinationProof: {
        status: "delivered",
        observedDelta: "99000000",
      },
    },
  });

  assert.equal(result.appended, true);
  assert.equal(result.receiptRecord.kind, "across_bridge");
  assert.equal(
    result.receiptRecord.routeContext.routeKey,
    "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->optimism:0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  );
  assert.equal(result.receiptRecord.output.actualOutputUnits, "99000000");
});
