import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCapitalAuditReport, buildCapitalAuditScope, matchBitcoinSettlements } from "../src/audit/capital-audit.mjs";

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
  assert.equal(report.issues.some((entry) => entry.code === "broadcast_missing_helper_trace"), true);
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
  assert.equal(report.broadcastBreakdown.some((cell) => cell.result === "no_receipt"), true);
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
  assert.ok(Math.abs(report.summary.combinedDeltaUsd - (-7.6)) < 1e-9);
});
