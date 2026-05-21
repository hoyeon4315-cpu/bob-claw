import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCapitalAuditReport,
  buildCapitalAuditScope,
  collectBroadcastTransactionsAndReceipts,
  matchBitcoinSettlements,
} from "../src/audit/capital-audit.mjs";

test("capital audit scope collects EVM and bitcoin addresses from audit sources", () => {
  const scope = buildCapitalAuditScope({
    signerAuditRecords: [
      {
        timestamp: "2026-04-16T00:00:00.000Z",
        lifecycle: { stage: "broadcasted" },
        broadcast: {
          txHash: "0xabc",
          from: "0x111",
          to: "0x222",
        },
      },
    ],
    treasurySnapshots: [{ address: "0x333" }],
    gatewayBtcOfframpExecutions: [{ plan: { senderAddress: "0x444", recipient: "bc1test" } }],
  });

  assert.deepEqual(scope.evmAddresses, ["0x111", "0x222", "0x333", "0x444"]);
  assert.deepEqual(scope.bitcoinAddresses, ["bc1test"]);
});

test("capital audit bounds broadcast transaction and receipt RPC collection", async () => {
  const signerAuditRecords = Array.from({ length: 6 }, (_, index) => ({
    timestamp: `2026-04-19T00:40:1${index}.000Z`,
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    intentHash: `intent-${index}`,
    lifecycle: { stage: "broadcasted" },
    broadcast: {
      txHash: `0xbounded${index}`,
      from: "0xfrom",
      to: "0xto",
    },
  }));
  let activeTxReads = 0;
  let activeReceiptReads = 0;
  let maxTxReads = 0;
  let maxReceiptReads = 0;
  const delay = () => new Promise((resolve) => setTimeout(resolve, 5));

  const result = await collectBroadcastTransactionsAndReceipts({
    signerAuditRecords,
    concurrency: 2,
    txReader: async (_chain, txHash) => {
      activeTxReads += 1;
      maxTxReads = Math.max(maxTxReads, activeTxReads);
      await delay();
      activeTxReads -= 1;
      return { hash: txHash, value: 0n };
    },
    receiptReader: async (_chain, txHash) => {
      activeReceiptReads += 1;
      maxReceiptReads = Math.max(maxReceiptReads, activeReceiptReads);
      await delay();
      activeReceiptReads -= 1;
      return { transactionHash: txHash, status: 1, gasUsed: 1n, effectiveGasPrice: 1n };
    },
  });

  assert.equal(Object.keys(result.transactionsByTxHash).length, 6);
  assert.equal(Object.keys(result.receiptsByTxHash).length, 6);
  assert.equal(result.issues.length, 0);
  assert.ok(maxTxReads <= 2);
  assert.ok(maxReceiptReads <= 2);
});

test("capital audit matches BTC history to off-ramp settlement proofs by amount", () => {
  const matches = matchBitcoinSettlements({
    gatewayBtcOfframpExecutions: [
      {
        observedAt: "2026-04-16T06:20:15.395Z",
        plan: {
          recipient: "bc1audit",
          quote: { outputAmount: { amount: "4549" } },
        },
        signerResult: {
          broadcast: {
            txHash: "0xofframp",
          },
        },
        destinationProof: {
          observedDelta: "4549",
        },
      },
    ],
    bitcoinHistoriesByAddress: {
      bc1audit: {
        transactions: [
          {
            txid: "btc123",
            status: { confirmed: true, block_time: 1776321546 },
            vin: [{}],
            vout: [
              {
                scriptpubkey_address: "bc1audit",
                value: 4549,
              },
            ],
          },
        ],
        balance: {
          balanceSats: 4549,
          confirmedBalanceSats: 4549,
          mempoolBalanceSats: 0,
        },
      },
    },
  });

  assert.equal(matches.matchesByTxHash.get("0xofframp").txid, "btc123");
  assert.equal(matches.addresses.bc1audit.unmatchedTxs.length, 0);
});

test("capital audit classifies approved operator BTC deposits separately from off-ramp gaps", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [],
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    approvedOperatorBtcAddresses: ["bc1operator"],
    operatorFundingBtcAddresses: ["bc1operator"],
    bitcoinHistoriesByAddress: {
      bc1operator: {
        transactions: [
          {
            txid: "funding-deposit",
            status: { confirmed: true, block_time: 1778388062 },
            vin: [{ prevout: { scriptpubkey_address: "bc1external", value: 617833 } }],
            vout: [{ scriptpubkey_address: "bc1operator", value: 617833 }],
          },
          {
            txid: "operator-spend",
            status: { confirmed: true, block_time: 1778389000 },
            vin: [{ prevout: { scriptpubkey_address: "bc1operator", value: 10000 } }],
            vout: [
              { scriptpubkey_address: "bc1external", value: 8500 },
              { scriptpubkey_address: "bc1operator", value: 1200 },
            ],
          },
        ],
        balance: {
          balanceSats: 617833,
          confirmedBalanceSats: 617833,
          mempoolBalanceSats: 0,
        },
      },
    },
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { base: 3000 },
    },
  });

  assert.equal(report.status, "complete_with_residual_checks");
  assert.equal(report.summary.bitcoinOperatorFundingTxCount, 1);
  assert.equal(report.summary.bitcoinOperatorFundingSats, 617833);
  assert.equal(report.summary.bitcoinNonSettlementTxCount, 1);
  assert.equal(report.summary.bitcoinUnmatchedTxCount, 0);
  assert.equal(report.bitcoinAddresses[0].operatorFundingTxs[0].txid, "funding-deposit");
  assert.equal(report.bitcoinAddresses[0].nonSettlementTxs[0].receivedSats, 1200);
  assert.equal(
    report.issues.some((entry) => entry.code === "bitcoin_tx_unmatched_to_offramp"),
    false,
  );
});

test("capital audit report flags broadcasts that still lack helper traceability", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [
      {
        timestamp: "2026-04-16T00:00:00.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "base",
        amountUsd: 3.75,
        lifecycle: { stage: "broadcasted" },
        broadcast: {
          txHash: "0xmissing",
          from: "0x111",
          to: "0x222",
        },
      },
    ],
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { base: 3000 },
    },
  });

  assert.equal(report.status, "incomplete_traceability");
  assert.equal(report.summary.unmatchedBroadcastCount, 1);
  assert.equal(
    report.issues.some((entry) => entry.code === "broadcast_missing_helper_trace"),
    true,
  );
});

test("capital audit decomposes broadcast gas by category chain result and preserves total gas", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [
      {
        timestamp: "2026-04-16T00:00:00.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "base",
        intent: { intentType: "capital_rebalance" },
        lifecycle: { stage: "broadcasted" },
        broadcast: { txHash: "0xok", from: "0x111", to: "0x222" },
      },
      {
        timestamp: "2026-04-16T00:01:00.000Z",
        strategyId: "native-gas-refill",
        chain: "ethereum",
        intent: { intentType: "gas_topup" },
        lifecycle: { stage: "broadcasted" },
        broadcast: { txHash: "0xrevert", from: "0x111", to: "0x333" },
      },
      {
        timestamp: "2026-04-16T00:02:00.000Z",
        strategyId: "idle",
        chain: "sonic",
        intent: { intentType: "idle_consolidation_step" },
        lifecycle: { stage: "broadcasted" },
        broadcast: { txHash: "0xnoreceipt", from: "0x111", to: "0x444" },
      },
    ],
    receiptsByTxHash: {
      "0xok": { status: 1, gasUsed: "100000", effectiveGasPrice: "1000000000" },
      "0xrevert": { status: 0, gasUsed: "200000", effectiveGasPrice: "1000000000" },
    },
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { base: 3000, ethereum: 3000, sonic: 1 },
    },
  });

  assert.equal(report.summary.broadcastBreakdownGasDriftUsd <= 0.01, true);
  assert.equal(report.summary.topGasCategory, "gas_topup");
  assert.equal(report.summary.topGasChain, "ethereum");
  assert.equal(report.summary.gasFromRevertedTxsUsd, 0.6);
  assert.equal(report.summary.gasFromNoReceiptTxsUsd, 0);
  assert.equal(
    report.broadcastBreakdown.some((cell) => cell.result === "no_receipt"),
    true,
  );
});

test("capital audit matches legacy funding-transfer broadcasts from signer audit helper traces", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [
      {
        timestamp: "2026-04-16T00:55:20.883Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "avalanche",
        intentId: "gateway-btc-funding-transfer:avalanche:d5c452048e7451dc",
        intentHash: "2040780579403cab01207f4128415bc6a77371495450cdd44c655712b8a73c8b",
        intent: {
          intentType: "funding_transfer",
          amountUsd: 16.9668162125,
          mode: "live",
        },
        amountUsd: 16.9668162125,
        lifecycle: {
          stage: "signed",
          txHash: "0xlegacy",
        },
        broadcast: null,
      },
      {
        timestamp: "2026-04-16T00:55:21.427Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "avalanche",
        intentId: "gateway-btc-funding-transfer:avalanche:d5c452048e7451dc",
        intentHash: "2040780579403cab01207f4128415bc6a77371495450cdd44c655712b8a73c8b",
        intent: {
          intentType: "funding_transfer",
          amountUsd: 16.9668162125,
          mode: "live",
        },
        amountUsd: 16.9668162125,
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xlegacy",
        },
        broadcast: {
          txHash: "0xlegacy",
          from: "0x111",
          to: "0x222",
        },
      },
    ],
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { avalanche: 20 },
    },
  });

  assert.equal(report.status, "complete_with_residual_checks");
  assert.equal(report.summary.unmatchedBroadcastCount, 0);
  assert.equal(report.transactions[0].helperMatched, true);
  assert.equal(report.transactions[0].helperMatchSource, "signer_audit");
  assert.equal(report.transactions[0].helperMatchRule, "tx_hash+strategy_chain");
  assert.equal(report.transactions[0].evidenceType, "gateway_btc_transfer_audit_trace");
});

test("capital audit keeps ambiguous timestamp-window helper traces unmatched", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [
      {
        timestamp: "2026-04-16T00:55:00.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "avalanche",
        intentId: "legacy-a",
        intentHash: "hash-a",
        intent: {
          intentType: "funding_transfer",
          amountUsd: 16.9,
          mode: "live",
        },
        amountUsd: 16.9,
        lifecycle: {
          stage: "signed",
          txHash: "0xaaa",
        },
        broadcast: null,
      },
      {
        timestamp: "2026-04-16T00:55:20.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "avalanche",
        intentId: "legacy-a",
        intentHash: "hash-a",
        intent: {
          intentType: "funding_transfer",
          amountUsd: 16.9,
          mode: "live",
        },
        amountUsd: 16.9,
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xaaa",
        },
        broadcast: {
          txHash: "0xaaa",
          from: "0x111",
          to: "0x222",
        },
      },
      {
        timestamp: "2026-04-16T00:55:10.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "avalanche",
        intentId: "legacy-b",
        intentHash: "hash-b",
        intent: {
          intentType: "funding_transfer",
          amountUsd: 16.9,
          mode: "live",
        },
        amountUsd: 16.9,
        lifecycle: {
          stage: "signed",
          txHash: "0xbbb",
        },
        broadcast: null,
      },
      {
        timestamp: "2026-04-16T00:55:40.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "avalanche",
        intentId: "legacy-b",
        intentHash: "hash-b",
        intent: {
          intentType: "funding_transfer",
          amountUsd: 16.9,
          mode: "live",
        },
        amountUsd: 16.9,
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xbbb",
        },
        broadcast: {
          txHash: "0xbbb",
          from: "0x111",
          to: "0x222",
        },
      },
      {
        timestamp: "2026-04-16T00:55:30.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "avalanche",
        intentId: "missing-exec",
        intentHash: "hash-missing",
        intent: {
          intentType: "other_intent",
          amountUsd: 16.9,
          mode: "live",
        },
        amountUsd: 16.9,
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xmissing",
        },
        broadcast: {
          txHash: "0xmissing",
          from: "0x111",
          to: "0x222",
        },
      },
    ],
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { avalanche: 20 },
    },
  });

  const missing = report.transactions.find((entry) => entry.txHash === "0xmissing");
  assert.equal(missing.helperMatched, false);
  assert.equal(missing.helperMatchRule, null);
});

test("capital audit matches non-legacy signer-audit helper traces with composite tx context", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [
      {
        timestamp: "2026-04-16T20:48:16.376Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "wrapped-btc-loop-base-moonwell:entry:approve-initial-collateral",
        intentHash: "4435cc4cfa2580f58c7b6a7b4f81403bb3a7362ce86f0d72be33fee328fe711e",
        intent: {
          intentType: "wrapped_btc_loop_entry",
          amountUsd: 300,
          mode: "live",
        },
        amountUsd: 300,
        lifecycle: {
          stage: "signed",
          txHash: "0xloop",
        },
        broadcast: null,
      },
      {
        timestamp: "2026-04-16T20:48:16.619Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "wrapped-btc-loop-base-moonwell:entry:approve-initial-collateral",
        intentHash: "4435cc4cfa2580f58c7b6a7b4f81403bb3a7362ce86f0d72be33fee328fe711e",
        intent: {
          intentType: "wrapped_btc_loop_entry",
          amountUsd: 300,
          mode: "live",
        },
        amountUsd: 300,
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xloop",
        },
        broadcast: {
          txHash: "0xloop",
          from: "0x111",
          to: "0x222",
        },
      },
    ],
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { base: 3000 },
    },
  });

  assert.equal(report.status, "complete_with_residual_checks");
  assert.equal(report.summary.unmatchedBroadcastCount, 0);
  assert.equal(report.transactions[0].helperMatched, true);
  assert.equal(report.transactions[0].helperMatchRule, "tx_hash+strategy_chain");
  assert.equal(report.transactions[0].evidenceType, "signer_audit_trace");
});

function auditReportWithReceiptJoinFixtures({ signerAuditRecords, capitalAuditPairs = [] }) {
  return buildCapitalAuditReport({
    signerAuditRecords,
    capitalAuditPairs,
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { base: 3000 },
    },
  });
}

function signerLifecycleFixture({
  stage,
  txHash,
  strategyId,
  intentHash,
  intentType,
  amountUsd,
  timestamp,
  chain = "base",
}) {
  return {
    timestamp,
    strategyId,
    chain,
    intentHash,
    intent: { intentType, amountUsd, mode: "live" },
    amountUsd,
    lifecycle: { stage, txHash },
    broadcast: stage === "signed" ? null : { txHash, from: "0x111", to: "0x222" },
  };
}

function terminalSignerFixture(fields) {
  return {
    ...signerLifecycleFixture(fields),
    realized: fields.realized,
  };
}

function capitalAuditPairFixture({ txHash, reconciliationStatus, chain = "base" }) {
  return {
    status: "closed",
    stage: "post_reconciliation",
    source: "signer_terminal_backfill",
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain,
    intentHash: "btc-intent",
    txHash,
    reconciliationStatus,
    validation: { ok: true, method: "signer_terminal_backfill" },
  };
}

test("capital audit reconciles stable terminal signer receipts without live RPC receipt", () => {
  const common = {
    txHash: "0xstable",
    strategyId: "stablecoin_treasury_rotation",
    intentHash: "stable-intent",
    intentType: "swap",
    amountUsd: 9.999,
  };
  const report = auditReportWithReceiptJoinFixtures({
    signerAuditRecords: [
      signerLifecycleFixture({ ...common, stage: "broadcasted", timestamp: "2026-04-24T20:17:49.400Z" }),
      terminalSignerFixture({
        ...common,
        stage: "confirmed",
        timestamp: "2026-04-24T20:17:54.076Z",
        realized: {
          hash: "0xstable",
          blockNumber: 45136262,
          status: 1,
          gasUsed: "53000",
          gasPrice: "6000000",
        },
      }),
    ],
  });

  assert.equal(report.transactions[0].txHash, "0xstable");
  assert.equal(report.transactions[0].result, "ok");
  assert.equal(report.transactions[0].receiptStatus, 1);
});

test("capital audit reconciles BTC wrapper terminal signer receipts without live RPC receipt", () => {
  const common = {
    txHash: "0xbtc",
    strategyId: "wrapped-btc-loop-base-moonwell",
    intentHash: "btc-intent",
    intentType: "wrapped_btc_loop_entry",
    amountUsd: 300,
  };
  const report = auditReportWithReceiptJoinFixtures({
    signerAuditRecords: [
      signerLifecycleFixture({ ...common, stage: "broadcasted", timestamp: "2026-04-16T20:54:01.915Z" }),
      terminalSignerFixture({
        ...common,
        stage: "confirmed",
        timestamp: "2026-05-18T02:25:58.620Z",
        realized: {
          hash: null,
          blockNumber: 44791748,
          status: 1,
          gasUsed: "99020",
          effectiveGasPrice: "6000000",
        },
      }),
    ],
  });

  assert.equal(report.transactions[0].txHash, "0xbtc");
  assert.equal(report.transactions[0].result, "ok");
  assert.equal(report.transactions[0].receiptStatus, 1);
});

test("capital audit rejects terminal signer receipt evidence from mismatched chain", () => {
  const common = {
    txHash: "0xstable",
    strategyId: "stablecoin_treasury_rotation",
    intentHash: "stable-intent",
    intentType: "swap",
    amountUsd: 9.999,
  };
  const report = auditReportWithReceiptJoinFixtures({
    signerAuditRecords: [
      signerLifecycleFixture({ ...common, stage: "broadcasted", timestamp: "2026-04-24T20:17:49.400Z" }),
      terminalSignerFixture({
        ...common,
        chain: "optimism",
        stage: "confirmed",
        timestamp: "2026-04-24T20:17:54.076Z",
        realized: {
          hash: "0xstable",
          blockNumber: 45136262,
          status: 1,
          gasUsed: "53000",
          effectiveGasPrice: "6000000",
        },
      }),
    ],
  });

  assert.equal(report.transactions[0].result, "no_receipt");
  assert.equal(report.transactions[0].receiptStatus, null);
});

test("capital audit rejects malformed terminal signer receipt evidence", () => {
  const common = {
    txHash: "0xbtc",
    strategyId: "wrapped-btc-loop-base-moonwell",
    intentHash: "btc-intent",
    intentType: "wrapped_btc_loop_entry",
    amountUsd: 300,
  };
  const report = auditReportWithReceiptJoinFixtures({
    signerAuditRecords: [
      signerLifecycleFixture({ ...common, stage: "broadcasted", timestamp: "2026-04-16T20:54:01.915Z" }),
      terminalSignerFixture({
        ...common,
        stage: "confirmed",
        timestamp: "2026-05-18T02:25:58.620Z",
        realized: {
          hash: "0xbtc",
          blockNumber: 44791748,
          status: 1,
          gasUsed: "not-a-number",
          effectiveGasPrice: "6000000",
        },
      }),
    ],
  });

  assert.equal(report.transactions[0].result, "no_receipt");
  assert.equal(report.transactions[0].receiptStatus, null);
});

test("capital audit treats closed capital audit pairs as generic reconciliation proof", () => {
  const report = auditReportWithReceiptJoinFixtures({
    signerAuditRecords: [
      signerLifecycleFixture({
        timestamp: "2026-04-16T21:12:49.966Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentHash: "btc-intent",
        intentType: "wrapped_btc_loop_entry",
        amountUsd: 7,
        txHash: "0xpaired",
        stage: "broadcasted",
      }),
    ],
    capitalAuditPairs: [capitalAuditPairFixture({ txHash: "0xpaired", reconciliationStatus: "reconciled" })],
  });

  assert.equal(report.transactions[0].result, "reconciled");
  assert.equal(report.transactions[0].reconciliationStatus, "reconciled");
  assert.equal(report.transactions[0].receiptStatus, null);
});

test("capital audit treats closed failed capital audit pairs as terminal reverted proof", () => {
  const report = auditReportWithReceiptJoinFixtures({
    signerAuditRecords: [
      signerLifecycleFixture({
        timestamp: "2026-04-16T21:31:31.857Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentHash: "btc-intent",
        intentType: "risk_unwind",
        amountUsd: 3.14,
        txHash: "0xfailed",
        stage: "broadcasted",
      }),
    ],
    capitalAuditPairs: [capitalAuditPairFixture({ txHash: "0xfailed", reconciliationStatus: "failed" })],
  });

  assert.equal(report.transactions[0].result, "reverted");
  assert.equal(report.transactions[0].reconciliationStatus, "failed");
  assert.equal(report.transactions[0].receiptStatus, null);
});

test("capital audit rejects closed capital audit pairs from mismatched chain", () => {
  const report = auditReportWithReceiptJoinFixtures({
    signerAuditRecords: [
      signerLifecycleFixture({
        timestamp: "2026-04-16T21:12:49.966Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        intentHash: "btc-intent",
        intentType: "wrapped_btc_loop_entry",
        amountUsd: 7,
        txHash: "0xpaired",
        stage: "broadcasted",
      }),
    ],
    capitalAuditPairs: [
      capitalAuditPairFixture({ txHash: "0xpaired", reconciliationStatus: "reconciled", chain: "optimism" }),
    ],
  });

  assert.equal(report.transactions[0].result, "no_receipt");
  assert.equal(report.transactions[0].reconciliationStatus, null);
});

test("capital audit does not match signer-audit helper traces on tx hash alone", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [
      {
        timestamp: "2026-04-16T20:48:16.376Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "wrapped-btc-loop-base-moonwell:entry:approve-initial-collateral",
        intentHash: "4435cc4cfa2580f58c7b6a7b4f81403bb3a7362ce86f0d72be33fee328fe711e",
        intent: {
          intentType: "wrapped_btc_loop_entry",
          amountUsd: 300,
          mode: "live",
        },
        amountUsd: 300,
        lifecycle: {
          stage: "signed",
          txHash: "0xloop",
        },
        broadcast: null,
      },
      {
        timestamp: "2026-04-16T20:48:16.619Z",
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "wrapped-btc-loop-base-moonwell:entry:approve-initial-collateral",
        intentHash: "4435cc4cfa2580f58c7b6a7b4f81403bb3a7362ce86f0d72be33fee328fe711e",
        intent: {
          intentType: "wrapped_btc_loop_entry",
          amountUsd: 300,
          mode: "live",
        },
        amountUsd: 300,
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xloop",
        },
        broadcast: {
          txHash: "0xloop",
          from: "0x111",
          to: "0x222",
        },
      },
      {
        timestamp: "2026-04-16T20:48:16.700Z",
        strategyId: "token-dex-experiment",
        chain: "base",
        intentId: "token-dex-experiment:base:25c43bb02d2f5680",
        intentHash: "different-intent",
        intent: {
          intentType: "approve_exact",
          amountUsd: 300,
          mode: "live",
        },
        amountUsd: 300,
        lifecycle: {
          stage: "broadcasted",
          txHash: "0xloop",
        },
        broadcast: {
          txHash: "0xloop",
          from: "0x111",
          to: "0x222",
        },
      },
    ],
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { base: 3000 },
    },
  });

  const mismatched = report.transactions.find((entry) => entry.strategyId === "token-dex-experiment");
  assert.equal(mismatched.helperMatched, false);
  assert.equal(mismatched.helperMatchRule, null);
});

test("capital audit report includes combined EVM and native BTC totals", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [],
    treasurySnapshots: [
      {
        observedAt: "2026-04-16T00:00:00.000Z",
        summary: { estimatedWalletUsd: 70 },
      },
      {
        observedAt: "2026-04-16T01:00:00.000Z",
        summary: { estimatedWalletUsd: 52 },
      },
    ],
    gatewayBtcOfframpExecutions: [
      {
        plan: {
          recipient: "bc1test",
        },
        signerResult: {
          broadcast: {
            txHash: "0xbtcscope",
          },
        },
      },
    ],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {
      bc1test: {
        transactions: [],
        balance: {
          balanceSats: 13000,
          confirmedBalanceSats: 13000,
          mempoolBalanceSats: 0,
        },
      },
    },
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { base: 3000 },
    },
  });

  assert.equal(report.summary.currentNativeBtcSats, 13000);
  assert.ok(Math.abs(report.summary.currentNativeBtcUsd - 10.4) < 1e-9);
  assert.ok(Math.abs(report.summary.currentCombinedUsd - 62.4) < 1e-9);
  assert.ok(Math.abs(report.summary.combinedDeltaUsd - -7.6) < 1e-9);
});

test("capital audit report injects protocol position marks into treasury inventory", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [],
    treasurySnapshots: [
      {
        observedAt: "2026-05-10T00:00:00.000Z",
        summary: { estimatedWalletUsd: 400 },
      },
      {
        observedAt: "2026-05-11T00:00:00.000Z",
        summary: { estimatedWalletUsd: 468 },
      },
    ],
    protocolPositionMarks: [
      {
        event: "position_marked",
        observedAt: "2026-05-11T01:00:00.000Z",
        positionId: "protocol:base:yo:1:erc4626",
        chain: "base",
        protocolId: "yo",
        assetSymbol: "USDC",
        valueUsd: 65.24,
      },
      {
        event: "position_marked",
        observedAt: "2026-05-10T12:00:00.000Z",
        positionId: "protocol:ethereum:morpho:2:erc4626",
        chain: "ethereum",
        protocolId: "morpho",
        assetSymbol: "USDC",
        valueUsd: 75.0,
      },
    ],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcOnrampExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: { btc: 80000, tokenByKey: { btc: 80000 } },
  });

  const protocolDeltas = report.inventory.deltas.filter((d) => d.kind === "protocol_position");
  assert.equal(protocolDeltas.length, 2);
  const yoDelta = protocolDeltas.find((d) => d.asset === "USDC" && d.chain === "base");
  assert.ok(Math.abs(yoDelta.delta - 65.24) < 1e-9);
  assert.ok(Math.abs(report.summary.treasuryEndUsd - (468 + 65.24 + 75)) < 1e-6);
  assert.ok(Math.abs(report.summary.treasuryDeltaUsd - (468 + 65.24 + 75 - 400)) < 1e-6);
  assert.ok(Math.abs(report.summary.combinedDeltaUsd - (468 + 65.24 + 75 - 400)) < 1e-6);
});

test("capital audit prefers latest position mark per positionId", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [],
    treasurySnapshots: [
      {
        observedAt: "2026-05-10T00:00:00.000Z",
        summary: { estimatedWalletUsd: 100 },
      },
      {
        observedAt: "2026-05-11T00:00:00.000Z",
        summary: { estimatedWalletUsd: 100 },
      },
    ],
    protocolPositionMarks: [
      {
        event: "position_marked",
        observedAt: "2026-05-10T00:00:00.000Z",
        positionId: "p1",
        chain: "base",
        protocolId: "yo",
        valueUsd: 10,
      },
      {
        event: "position_marked",
        observedAt: "2026-05-11T02:00:00.000Z",
        positionId: "p1",
        chain: "base",
        protocolId: "yo",
        valueUsd: 20,
      },
    ],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcOnrampExecutions: [],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: { btc: 80000, tokenByKey: { btc: 80000 } },
  });

  const protocolDeltas = report.inventory.deltas.filter((d) => d.kind === "protocol_position");
  assert.equal(protocolDeltas.length, 1);
  assert.ok(Math.abs(protocolDeltas[0].delta - 20) < 1e-9);
});

test("capital audit scope includes onramp recipient in EVM addresses", () => {
  const scope = buildCapitalAuditScope({
    signerAuditRecords: [],
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcOnrampExecutions: [{ plan: { senderAddress: "bc1sender", recipient: "0xBaseRecipient" } }],
    approvedOperatorBtcAddresses: [],
  });

  assert.deepEqual(scope.evmAddresses, ["0xBaseRecipient"]);
  assert.deepEqual(scope.bitcoinAddresses, ["bc1sender"]);
});

test("capital audit report matches gateway-btc-onramp execution to broadcast trace", () => {
  const report = buildCapitalAuditReport({
    signerAuditRecords: [
      {
        timestamp: "2026-05-11T01:51:48.000Z",
        strategyId: "gateway-btc-onramp",
        chain: "bitcoin",
        lifecycle: { stage: "broadcasted" },
        broadcast: {
          txHash: "21372cacaabbccdd",
          from: "bc1sender",
          to: "0xBaseRecipient",
        },
        intentHash: "onramp-intent-1",
      },
    ],
    treasurySnapshots: [],
    gatewayBtcOfframpExecutions: [],
    gatewayBtcOnrampExecutions: [
      {
        observedAt: "2026-05-11T01:51:48.000Z",
        plan: {
          senderAddress: "bc1sender",
          recipient: "0xBaseRecipient",
          dstChain: "base",
          dstAsset: { ticker: "USDC" },
          amountSats: 100000,
          quote: {
            outputAmount: { amount: "50000000" },
            fees: { amount: "1000" },
          },
        },
        signerResult: {
          broadcast: {
            txHash: "21372cacaabbccdd",
          },
        },
        destinationProof: {
          observedDelta: "50000000",
        },
      },
    ],
    gatewayBtcConsolidationExecutions: [],
    nativeDexExperimentExecutions: [],
    transactionsByTxHash: {},
    receiptsByTxHash: {},
    bitcoinHistoriesByAddress: {},
    prices: {
      btc: 80000,
      tokenByKey: { btc: 80000, usd_stable: 1, ethereum: 3000 },
      nativeByChain: { base: 3000 },
    },
  });

  const tx = report.transactions.find((t) => t.txHash === "21372cacaabbccdd");
  assert.equal(tx.helperMatched, true);
  assert.equal(tx.evidenceType, "gateway_btc_onramp");
  assert.equal(tx.helperMatchSource, "execution_jsonl");
  assert.equal(tx.helperMatchRule, "tx_hash");
  assert.equal(report.executions.gatewayBtcOnramps.length, 1);
  assert.equal(report.executions.gatewayBtcOnramps[0].sourceAmountSats, "100000");
  assert.equal(report.executions.gatewayBtcOnramps[0].observedOutputUnits, "50000000");
  assert.equal(report.status, "complete_with_residual_checks");
});
