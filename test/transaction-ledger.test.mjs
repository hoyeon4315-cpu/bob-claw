import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTransactionLedger } from "../src/audit/transaction-ledger.mjs";

test("transaction ledger turns reconciled receipts into cost rows without double-counting gas", () => {
  const ledger = buildTransactionLedger({
    baselineUsd: 450,
    currentNav: {
      observedAt: "2026-05-06T00:00:00.000Z",
      totalUsd: 370,
      walletCoverage: "full_rpc",
      scanErrorCount: 0,
      unknownAssetBalanceCount: 0,
    },
    receiptRecords: [
      {
        observedAt: "2026-05-01T00:00:00.000Z",
        kind: "token_dex_experiment",
        chain: "base",
        txHash: "0xswap",
        reconciliationStatus: "reconciled",
        routeContext: {
          routeKey: "base:cbBTC->base:USDC",
          estimatedInputUsd: 10,
          estimatedOutputUsd: 9.9,
        },
        output: { actualOutputUsd: 9.75 },
        realized: {
          receiptGasUsd: 0.02,
          actualKnownCostUsd: 0.02,
          realizedNetPnlUsd: -0.27,
        },
        pnl: { classification: "execution_evidence_cost" },
      },
    ],
  });

  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].ledgerRowId, "receipt:0xswap");
  assert.equal(ledger.rows[0].sourceFile, "data/receipt-reconciliations.jsonl");
  assert.equal(ledger.rows[0].txHash, "0xswap");
  assert.equal(ledger.rows[0].category, "swap_execution_cost");
  assert.equal(ledger.rows[0].realizedNetPnlUsd, -0.27);
  assert.equal(ledger.rows[0].costUsd, 0.27);
  assert.equal(ledger.summary.realizedNetPnlUsd, -0.27);
  assert.equal(ledger.summary.totalCostUsd, 0.27);
  assert.equal(ledger.summary.receiptGasUsd, 0.02);
});

test("transaction ledger adds unreconciled signer reverts as unquantified gaps", () => {
  const ledger = buildTransactionLedger({
    receiptRecords: [],
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:01:00.000Z",
        strategyId: "stablecoin_treasury_rotation",
        chain: "base",
        amountUsd: 9.99,
        policyVerdict: "errored",
        lifecycle: { stage: "reverted", txHash: "0xrevert" },
        realized: { gasUsed: "47474", fee: "284844000000" },
        error: { message: "Transaction reverted after broadcast" },
      },
    ],
  });

  assert.equal(ledger.summary.unquantifiedRevertCount, 1);
  assert.equal(ledger.rows[0].ledgerRowId, "signer_revert:0xrevert");
  assert.equal(ledger.rows[0].category, "unquantified_revert_cost");
  assert.equal(ledger.rows[0].confidence, "needs_receipt_price");
});

test("transaction ledger keeps inbound balance diffs separate from external-deposit proof", () => {
  const ledger = buildTransactionLedger({
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        eventId: "evt1",
        chain: "base",
        ticker: "USDC",
        estimatedUsd: 5,
        txHash: null,
        detectionSource: "treasury_inventory_diff",
      },
    ],
  });

  assert.equal(ledger.summary.inboundDiffUsd, 5);
  assert.equal(ledger.rows[0].ledgerRowId, "inbound:evt1");
  assert.equal(ledger.rows[0].category, "inbound_inventory_diff");
  assert.equal(ledger.rows[0].confidence, "balance_diff_not_tx_attributed");
});

test("transaction ledger attributes inbound balance diffs to matching receipt outputs", () => {
  const ledger = buildTransactionLedger({
    receiptRecords: [
      {
        observedAt: "2026-05-01T00:01:00.000Z",
        kind: "token_dex_experiment",
        chain: "base",
        txHash: "0xrouteout",
        reconciliationStatus: "reconciled",
        output: {
          actualOutputUsd: 5.01,
          asset: {
            chain: "base",
            token: "0xUSDC",
            ticker: "USDC",
          },
        },
        realized: {
          receiptGasUsd: 0.01,
          realizedNetPnlUsd: -0.02,
        },
      },
    ],
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        previousObservedAt: "2026-05-01T00:00:00.000Z",
        eventId: "evt-internal",
        chain: "base",
        token: "0xusdc",
        ticker: "USDC",
        estimatedUsd: 5,
        txHash: null,
        detectionSource: "treasury_inventory_diff",
      },
    ],
  });

  const inbound = ledger.rows.find((row) => row.rowType === "inbound_event");
  assert.equal(inbound.txHash, "0xrouteout");
  assert.equal(inbound.category, "internal_route_output");
  assert.equal(inbound.confidence, "tx_attributed_internal_route_output");
  assert.equal(inbound.attribution.sourceFile, "data/receipt-reconciliations.jsonl");
  assert.equal(ledger.summary.attributedInboundCount, 1);
  assert.equal(ledger.summary.unattributedInboundCount, 0);
});

test("transaction ledger attributes inbound balance diffs to confirmed signer strategy outputs", () => {
  const ledger = buildTransactionLedger({
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:01:00.000Z",
        chain: "base",
        strategyId: "gateway_native_asset_conversion_sleeve",
        intent: {
          intentType: "erc4626_redeem",
          metadata: {
            protocol: "yo",
            assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
          },
        },
        lifecycle: {
          stage: "confirmed",
          txHash: "0xredeem",
        },
      },
    ],
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        previousObservedAt: "2026-05-01T00:00:00.000Z",
        eventId: "evt-redeem-usdc",
        chain: "base",
        token: "0x833589fcD6edB6E08F4c7C32D4F71b54bDA02913",
        ticker: "USDC",
        estimatedUsd: 4.98,
        txHash: null,
        detectionSource: "treasury_inventory_diff",
      },
    ],
  });

  const inbound = ledger.rows.find((row) => row.rowType === "inbound_event");
  assert.equal(inbound.txHash, "0xredeem");
  assert.equal(inbound.category, "internal_strategy_output");
  assert.equal(inbound.confidence, "tx_attributed_signer_strategy_output");
  assert.equal(inbound.strategyId, "gateway_native_asset_conversion_sleeve");
  assert.equal(inbound.attribution.sourceFile, "logs/signer-audit.jsonl");
  assert.equal(inbound.attribution.matchReason, "signer_output_matches_inbound_chain_token_and_snapshot_window");
  assert.equal(ledger.summary.attributedInboundCount, 1);
  assert.equal(ledger.summary.unattributedInboundCount, 0);
});

test("transaction ledger maps Moonwell collateral withdraw signer output to Base cbBTC inbound", () => {
  const ledger = buildTransactionLedger({
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:04:00.000Z",
        chain: "base",
        strategyId: "wrapped-btc-loop-base-moonwell",
        amountUsd: 25,
        intent: {
          intentType: "risk_unwind",
          metadata: {
            kind: "withdraw_initial_collateral",
            phase: "unwind",
            appliedCollateralUnits: "31462",
          },
        },
        lifecycle: {
          stage: "confirmed",
          txHash: "0xwithdrawcbbtc",
        },
      },
    ],
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        previousObservedAt: "2026-05-01T00:00:00.000Z",
        eventId: "evt-cbbtc",
        chain: "base",
        token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        ticker: "cbBTC",
        estimatedUsd: 23.98,
        txHash: null,
        detectionSource: "treasury_inventory_diff",
      },
    ],
  });

  const inbound = ledger.rows.find((row) => row.rowType === "inbound_event");
  assert.equal(inbound.txHash, "0xwithdrawcbbtc");
  assert.equal(inbound.category, "internal_strategy_output");
  assert.equal(inbound.confidence, "tx_attributed_signer_strategy_output");
  assert.equal(inbound.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(inbound.attribution.kind, "risk_unwind");
  assert.equal(inbound.attribution.outputUsd, 25);
  assert.equal(ledger.summary.attributedInboundCount, 1);
  assert.equal(ledger.summary.unattributedInboundCount, 0);
});

test("transaction ledger does not attribute approvals as signer outputs", () => {
  const ledger = buildTransactionLedger({
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:01:00.000Z",
        chain: "base",
        strategyId: "wrapped-btc-loop-base-moonwell",
        intent: {
          intentType: "approve_exact",
          metadata: {
            inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            outputToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
          },
        },
        lifecycle: {
          stage: "confirmed",
          txHash: "0xapprove",
        },
      },
    ],
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        previousObservedAt: "2026-05-01T00:00:00.000Z",
        eventId: "evt-cbbtc",
        chain: "base",
        token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        ticker: "cbBTC",
        estimatedUsd: 8.28,
        txHash: null,
        detectionSource: "treasury_inventory_diff",
      },
    ],
  });

  const inbound = ledger.rows.find((row) => row.rowType === "inbound_event");
  assert.equal(inbound.txHash, null);
  assert.equal(inbound.category, "inbound_inventory_diff");
  assert.equal(inbound.confidence, "balance_diff_not_tx_attributed");
  assert.equal(ledger.summary.attributedInboundCount, 0);
  assert.equal(ledger.summary.unattributedInboundCount, 1);
});

test("transaction ledger maps Moonwell collateral repay swap signer output to Base USDC inbound", () => {
  const ledger = buildTransactionLedger({
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:01:30.000Z",
        chain: "base",
        strategyId: "wrapped-btc-loop-base-moonwell",
        amountUsd: 5.02,
        intent: {
          intentType: "risk_unwind",
          metadata: {
            kind: "swap_collateral_to_repay_asset",
            phase: "unwind",
            plannedBorrowTopUpUnits: "5021879",
          },
        },
        lifecycle: {
          stage: "confirmed",
          txHash: "0xswaprepay",
        },
      },
    ],
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        previousObservedAt: "2026-05-01T00:00:00.000Z",
        eventId: "evt-usdc",
        chain: "base",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        ticker: "USDC",
        estimatedUsd: 5.02,
        txHash: null,
        detectionSource: "treasury_inventory_diff",
      },
    ],
  });

  const inbound = ledger.rows.find((row) => row.rowType === "inbound_event");
  assert.equal(inbound.txHash, "0xswaprepay");
  assert.equal(inbound.category, "internal_strategy_output");
  assert.equal(inbound.confidence, "tx_attributed_signer_strategy_output");
  assert.equal(inbound.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(ledger.summary.attributedInboundCount, 1);
  assert.equal(ledger.summary.unattributedInboundCount, 0);
});

test("transaction ledger summarizes current NAV against baseline", () => {
  const ledger = buildTransactionLedger({
    baselineUsd: 450,
    currentNav: {
      observedAt: "2026-05-06T00:00:00.000Z",
      totalUsd: 370,
      walletCoverage: "full_rpc",
      scanErrorCount: 0,
      unknownAssetBalanceCount: 0,
    },
  });

  assert.equal(ledger.currentNav.confidence, "verified_current");
  assert.equal(ledger.baseline.deltaFromCurrentUsd, 80);
});
