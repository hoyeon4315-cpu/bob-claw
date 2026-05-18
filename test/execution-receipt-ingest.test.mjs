import assert from "node:assert/strict";
import { test } from "node:test";

import { backfillPendingSignerConfirmations } from "../src/executor/ingestor/execution-receipt-ingest.mjs";

function broadcastedAuditRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    timestamp: "2026-05-18T02:06:19.687Z",
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    intentId: "wrapped-btc-loop-base-moonwell:entry:approve-initial-collateral",
    intentHash: "intent-hash-1",
    intent: {
      intentType: "wrapped_btc_loop_entry",
      amountUsd: 25.000315,
      mode: "live",
      metadata: {
        phase: "entry",
      },
      approval: {
        token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        spender: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
        amount: "32417",
        mode: "per_tx",
      },
    },
    amountUsd: 25.000315,
    policyVerdict: "approved",
    lifecycle: {
      stage: "broadcasted",
      txHash: "0xabc",
      signer: {
        nonce: 3578,
        from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
        to: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      },
    },
    broadcast: {
      txHash: "0xabc",
      nonce: 3578,
      from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      to: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    },
    realized: null,
    error: null,
    ...overrides,
  };
}

test("pending signer confirmation backfill appends confirmed audit and receipt reconciliation once receipt exists", async () => {
  const receiptWrites = [];
  const auditWrites = [];
  const result = await backfillPendingSignerConfirmations({
    auditRecords: [broadcastedAuditRecord()],
    existingReceiptRecords: [],
    store: {
      append: async (name, record) => {
        receiptWrites.push({ name, record });
      },
    },
    appendSignerAuditRecordImpl: async (record) => {
      auditWrites.push(record);
    },
    readTransactionReceiptImpl: async () => ({
      hash: "0xabc",
      status: 1,
      blockNumber: 46140315,
      gasUsed: 59940n,
      effectiveGasPrice: 6000000n,
      fee: 359640000000n,
    }),
    readTransactionByHashImpl: async () => ({
      from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      to: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      value: "0",
    }),
    priceReader: async () => ({
      btc: 100_000,
      tokenByKey: { btc: 100_000 },
      nativeByChain: { base: 2_000 },
    }),
    now: "2026-05-18T02:20:00.000Z",
  });

  assert.equal(result.processedCount, 1);
  assert.equal(receiptWrites.length, 2);
  assert.equal(receiptWrites[0].name, "receipt-reconciliations");
  assert.equal(receiptWrites[0].record.txHash, "0xabc");
  assert.equal(receiptWrites[0].record.reconciliationStatus, "reconciled");
  assert.equal(receiptWrites[1].name, "capital-audit-pairs");
  assert.equal(receiptWrites[1].record.intentHash, "intent-hash-1");
  assert.equal(receiptWrites[1].record.txHash, "0xabc");
  assert.equal(receiptWrites[1].record.status, "closed");
  assert.equal(receiptWrites[1].record.reconciliationStatus, "reconciled");
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0].intentHash, "intent-hash-1");
  assert.equal(auditWrites[0].lifecycle.stage, "confirmed");
  assert.equal(auditWrites[0].lifecycle.txHash, "0xabc");
  assert.equal(auditWrites[0].realized.hash, "0xabc");
});

test("pending signer confirmation backfill infers dex swap output from receipt logs", async () => {
  const writes = [];
  const auditWrites = [];
  const result = await backfillPendingSignerConfirmations({
    auditRecords: [
      broadcastedAuditRecord({
        strategyId: "token-dex-experiment",
        intentHash: "intent-hash-dex-1",
        intentId: "token-dex-experiment:base:dex-1",
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xdex1",
          signer: {
            nonce: 3612,
            from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
            to: "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05",
          },
        },
        broadcast: {
          txHash: "0xdex1",
          nonce: 3612,
          from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
          to: "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05",
        },
        intent: {
          intentType: "dex_swap",
          amountUsd: 17.1,
          mode: "live",
          metadata: {
            executionReason: "capital_rebalance",
            outputToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
          },
        },
      }),
    ],
    existingReceiptRecords: [],
    store: {
      append: async (name, record) => {
        writes.push({ name, record });
      },
    },
    appendSignerAuditRecordImpl: async (record) => {
      auditWrites.push(record);
    },
    readTransactionReceiptImpl: async () => ({
      hash: "0xdex1",
      status: 1,
      blockNumber: 46149704,
      gasUsed: 154372n,
      effectiveGasPrice: 6000000n,
      fee: 926232000000n,
      from: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      to: "0x0d05a7d3448512b78fa8a9e46c4872c88c4a0d05",
      logs: [
        {
          address: "0x0555e30da8f98308edb960aa94c0db47230d2b9c",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x0000000000000000000000000d05a7d3448512b78fa8a9e46c4872c88c4a0d05",
            "0x00000000000000000000000096262be63aa687563789225c2fe898c27a3b0ae4",
          ],
          data: "0x0000000000000000000000000000000000000000000000000000000000005710",
        },
      ],
    }),
    readTransactionByHashImpl: async () => ({
      from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      to: "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05",
      value: "0",
    }),
    priceReader: async () => ({
      btc: 100_000,
      tokenByKey: { btc: 100_000 },
      nativeByChain: { base: 2_000 },
    }),
    now: "2026-05-18T07:30:00.000Z",
  });

  assert.equal(result.processedCount, 1);
  assert.equal(result.processed[0].receiptReconciled, "reconciled");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].name, "receipt-reconciliations");
  assert.equal(writes[0].record.reconciliationStatus, "reconciled");
  assert.equal(writes[0].record.output.actualOutputUnits, "22288");
  assert.equal(writes[1].name, "capital-audit-pairs");
  assert.equal(writes[1].record.status, "closed");
  assert.equal(writes[1].record.reconciliationStatus, "reconciled");
  assert.equal(auditWrites[0].lifecycle.stage, "confirmed");
});

test("pending signer confirmation backfill upgrades existing pending dex swap reconciliation to closed capital audit", async () => {
  const writes = [];
  const result = await backfillPendingSignerConfirmations({
    auditRecords: [
      broadcastedAuditRecord({
        strategyId: "token-dex-experiment",
        intentHash: "intent-hash-dex-2",
        intentId: "token-dex-experiment:base:dex-2",
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xdex2",
          signer: {
            nonce: 3613,
            from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
            to: "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05",
          },
        },
        broadcast: {
          txHash: "0xdex2",
          nonce: 3613,
          from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
          to: "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05",
        },
        intent: {
          intentType: "dex_swap",
          amountUsd: 17.1,
          mode: "live",
          metadata: {
            executionReason: "capital_rebalance",
            outputToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
          },
        },
      }),
    ],
    existingReceiptRecords: [
      {
        schemaVersion: 1,
        observedAt: "2026-05-18T07:29:58.626Z",
        kind: "dex_swap",
        chain: "base",
        txHash: "0xdex2",
        reconciliationStatus: "pending_output",
        output: {
          actualOutputUnits: null,
          actualOutputUsd: null,
        },
        realized: {
          actualKnownCostUsd: 0.0019,
        },
      },
    ],
    store: {
      append: async (name, record) => {
        writes.push({ name, record });
      },
    },
    appendSignerAuditRecordImpl: async () => {},
    readTransactionReceiptImpl: async () => ({
      hash: "0xdex2",
      status: 1,
      blockNumber: 46149704,
      gasUsed: 154372n,
      effectiveGasPrice: 6000000n,
      fee: 926232000000n,
      from: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      to: "0x0d05a7d3448512b78fa8a9e46c4872c88c4a0d05",
      logs: [
        {
          address: "0x0555e30da8f98308edb960aa94c0db47230d2b9c",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x0000000000000000000000000d05a7d3448512b78fa8a9e46c4872c88c4a0d05",
            "0x00000000000000000000000096262be63aa687563789225c2fe898c27a3b0ae4",
          ],
          data: "0x0000000000000000000000000000000000000000000000000000000000005710",
        },
      ],
    }),
    readTransactionByHashImpl: async () => ({
      from: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      to: "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05",
      value: "0",
    }),
    priceReader: async () => ({
      btc: 100_000,
      tokenByKey: { btc: 100_000 },
      nativeByChain: { base: 2_000 },
    }),
    now: "2026-05-18T07:30:00.000Z",
  });

  assert.equal(result.processedCount, 1);
  assert.equal(result.processed[0].receiptReconciled, "reconciled");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, "capital-audit-pairs");
  assert.equal(writes[0].record.status, "closed");
  assert.equal(writes[0].record.reconciliationStatus, "reconciled");
});
