import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSignerRevertReceiptCostReport,
  normalizeSignerRevertReceiptCost,
} from "../src/audit/signer-revert-receipt-costs.mjs";

test("normalizeSignerRevertReceiptCost converts receipt gas fee to USD", () => {
  const record = normalizeSignerRevertReceiptCost({
    row: {
      chain: "base",
      txHash: "0xabc",
      strategyId: "test-strategy",
      kind: "dex_swap",
    },
    receipt: {
      transactionHash: "0xabc",
      blockNumber: 123,
      status: 0,
      gasUsed: 47_474n,
      effectiveGasPrice: 6_000_000n,
      rpcUrl: "https://mainnet.base.org",
    },
    prices: {
      nativeByChain: { base: 2000 },
      tokenByKey: { usd_stable: 1 },
    },
    observedAt: "2026-05-06T00:00:00.000Z",
  });

  assert.equal(record.txHash, "0xabc");
  assert.equal(record.feeWei, "284844000000");
  assert.equal(record.estimatedUsd, 0.000569688);
  assert.equal(record.confidence, "revert_receipt_fee_priced_from_rpc_receipt");
});

test("buildSignerRevertReceiptCostReport fetches only still-unquantified signer reverts", async () => {
  const report = await buildSignerRevertReceiptCostReport({
    prices: {
      nativeByChain: { base: 2000 },
      tokenByKey: { usd_stable: 1 },
    },
    receiptRecords: [],
    existingCostRecords: [{
      chain: "base",
      txHash: "0xexisting",
      estimatedUsd: 0.01,
    }],
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:00:00.000Z",
        strategyId: "already-priced",
        chain: "base",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted", txHash: "0xexisting" },
      },
      {
        timestamp: "2026-05-01T00:01:00.000Z",
        strategyId: "needs-rpc",
        chain: "base",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted", txHash: "0xmissing" },
      },
    ],
    receiptReader: async (chain, txHash) => {
      assert.equal(chain, "base");
      assert.equal(txHash, "0xmissing");
      return {
        transactionHash: txHash,
        blockNumber: 456,
        status: 0,
        gasUsed: 10n,
        effectiveGasPrice: 20n,
      };
    },
    now: "2026-05-06T00:00:00.000Z",
  });

  assert.equal(report.summary.candidateCount, 1);
  assert.equal(report.summary.attributedCount, 1);
  assert.equal(report.records[0].txHash, "0xmissing");
  assert.equal(report.records[0].estimatedUsd, 4e-13);
});

test("buildSignerRevertReceiptCostReport retries existing cost records without usable USD cost", async () => {
  const report = await buildSignerRevertReceiptCostReport({
    prices: {
      nativeByChain: { base: 2000 },
      tokenByKey: { usd_stable: 1 },
    },
    receiptRecords: [],
    existingCostRecords: [{
      chain: "base",
      txHash: "0xmissing",
      estimatedUsd: null,
      feeWei: null,
    }],
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:01:00.000Z",
        strategyId: "needs-rpc",
        chain: "base",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted", txHash: "0xmissing" },
      },
    ],
    receiptReader: async (chain, txHash) => {
      assert.equal(chain, "base");
      assert.equal(txHash, "0xmissing");
      return {
        transactionHash: txHash,
        blockNumber: 456,
        status: 0,
        gasUsed: 10n,
        effectiveGasPrice: 20n,
      };
    },
    now: "2026-05-06T00:00:00.000Z",
  });

  assert.equal(report.summary.candidateCount, 1);
  assert.equal(report.summary.attributedCount, 1);
});
