import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTransactionLedger, buildTransactionLedgerNav } from "../src/audit/transaction-ledger.mjs";

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

test("transaction ledger prices signer revert receipt fees when native prices are available", () => {
  const ledger = buildTransactionLedger({
    prices: {
      nativeByChain: { base: 2000 },
      tokenByKey: { usd_stable: 1 },
    },
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

  assert.equal(ledger.summary.unquantifiedRevertCount, 0);
  assert.equal(ledger.summary.quantifiedRevertCount, 1);
  assert.equal(ledger.rows[0].category, "failed_tx_cost");
  assert.equal(ledger.rows[0].confidence, "revert_receipt_fee_priced_from_audit");
  assert.equal(ledger.rows[0].knownCostUsd, 0.000569688);
  assert.equal(ledger.rows[0].costUsd, 0.000569688);
  assert.equal(ledger.summary.totalCostUsd, 0.000569688);
});

test("transaction ledger prices signer reverts from RPC receipt cost attributions", () => {
  const ledger = buildTransactionLedger({
    receiptRecords: [],
    signerRevertCostRecords: [
      {
        observedAt: "2026-05-01T00:03:00.000Z",
        chain: "base",
        txHash: "0xrevert",
        feeWei: "284844000000",
        estimatedUsd: 0.00057,
        blockNumber: 123,
        status: 0,
        rpcUrl: "https://mainnet.base.org",
        sourceFile: "data/signer-revert-receipt-costs.jsonl",
      },
    ],
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:01:00.000Z",
        strategyId: "stablecoin_treasury_rotation",
        chain: "base",
        amountUsd: 9.99,
        policyVerdict: "errored",
        lifecycle: { stage: "reverted", txHash: "0xrevert" },
        realized: { actualKnownCostUsd: null },
        error: { message: "Transaction reverted after broadcast" },
      },
    ],
  });

  assert.equal(ledger.summary.unquantifiedRevertCount, 0);
  assert.equal(ledger.summary.quantifiedRevertCount, 1);
  assert.equal(ledger.rows[0].category, "failed_tx_cost");
  assert.equal(ledger.rows[0].confidence, "revert_receipt_fee_priced_from_rpc_receipt");
  assert.equal(ledger.rows[0].knownCostUsd, 0.00057);
  assert.equal(ledger.rows[0].costAttribution.blockNumber, 123);
});

test("transaction ledger counts one signer revert cost per chain tx hash", () => {
  const signerAuditRecords = [
    {
      timestamp: "2026-05-01T00:01:00.000Z",
      strategyId: "stablecoin_treasury_rotation",
      chain: "base",
      amountUsd: 9.99,
      policyVerdict: "errored",
      lifecycle: { stage: "reverted", txHash: "0xrevert" },
      error: { message: "Transaction reverted after broadcast" },
    },
    {
      timestamp: "2026-05-01T00:01:05.000Z",
      strategyId: "stablecoin_treasury_rotation",
      chain: "base",
      amountUsd: 9.99,
      policyVerdict: "errored",
      lifecycle: { stage: "reverted", txHash: "0xrevert" },
      error: { message: "same tx surfaced again" },
    },
  ];

  const ledger = buildTransactionLedger({
    receiptRecords: [],
    signerAuditRecords,
    signerRevertCostRecords: [{
      chain: "base",
      txHash: "0xrevert",
      feeWei: "284844000000",
      estimatedUsd: 0.00057,
    }],
  });

  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.summary.quantifiedRevertCount, 1);
  assert.equal(ledger.summary.totalCostUsd, 0.00057);
});

test("transaction ledger prices existing receipt-cost feeWei when estimatedUsd was missing", () => {
  const ledger = buildTransactionLedger({
    prices: {
      nativeByChain: { base: 2000 },
      tokenByKey: { usd_stable: 1 },
    },
    receiptRecords: [],
    signerRevertCostRecords: [{
      chain: "base",
      txHash: "0xrevert",
      feeWei: "284844000000",
      estimatedUsd: null,
    }],
    signerAuditRecords: [
      {
        timestamp: "2026-05-01T00:01:00.000Z",
        strategyId: "stablecoin_treasury_rotation",
        chain: "base",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted", txHash: "0xrevert" },
      },
    ],
  });

  assert.equal(ledger.summary.unquantifiedRevertCount, 0);
  assert.equal(ledger.summary.quantifiedRevertCount, 1);
  assert.equal(ledger.rows[0].knownCostUsd, 0.000569688);
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

test("transaction ledger attributes inbound balance diffs to exact ERC20 transfer-log records", () => {
  const ledger = buildTransactionLedger({
    transferAttributionRecords: [
      {
        eventId: "evt-transfer",
        observedAt: "2026-05-01T00:01:30.000Z",
        chain: "base",
        token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
        txHash: "0xtransfer",
        blockNumber: 123,
        logIndex: 7,
        from: "0x1111111111111111111111111111111111111111",
        to: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
        amount: "32105",
        amountDecimal: 0.00032105,
        estimatedUsd: 24.89,
        sourceFile: "data/treasury/inbound-transfer-attributions.jsonl",
      },
    ],
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        previousObservedAt: "2026-05-01T00:00:00.000Z",
        eventId: "evt-transfer",
        chain: "base",
        token: "0x0555e30da8f98308edb960aa94c0db47230d2b9c",
        ticker: "wBTC.OFT",
        amount: "32105",
        amountDecimal: 0.00032105,
        estimatedUsd: 24.8967854,
        txHash: null,
        detectionSource: "treasury_inventory_diff",
      },
    ],
  });

  const inbound = ledger.rows.find((row) => row.rowType === "inbound_event");
  assert.equal(inbound.txHash, "0xtransfer");
  assert.equal(inbound.category, "external_or_internal_inbound_tx");
  assert.equal(inbound.confidence, "tx_attributed_erc20_transfer_log");
  assert.equal(inbound.attribution.sourceFile, "data/treasury/inbound-transfer-attributions.jsonl");
  assert.equal(inbound.attribution.matchReason, "erc20_transfer_log_matches_inbound_event_id_chain_token_and_amount");
  assert.equal(ledger.summary.attributedInboundCount, 1);
  assert.equal(ledger.summary.unattributedInboundCount, 0);
});

test("transaction ledger refuses transfer-log attribution when amount does not match", () => {
  const ledger = buildTransactionLedger({
    transferAttributionRecords: [
      {
        eventId: "evt-transfer",
        observedAt: "2026-05-01T00:01:30.000Z",
        chain: "base",
        token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
        txHash: "0xwrongamount",
        amount: "1",
        amountDecimal: 0.00000001,
        sourceFile: "data/treasury/inbound-transfer-attributions.jsonl",
      },
    ],
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        previousObservedAt: "2026-05-01T00:00:00.000Z",
        eventId: "evt-transfer",
        chain: "base",
        token: "0x0555e30da8f98308edb960aa94c0db47230d2b9c",
        ticker: "wBTC.OFT",
        amount: "32105",
        amountDecimal: 0.00032105,
        estimatedUsd: 24.8967854,
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

test("transaction ledger attributes native inbound balance diffs to native transfer history records", () => {
  const ledger = buildTransactionLedger({
    transferAttributionRecords: [
      {
        eventId: "evt-native",
        observedAt: "2026-05-01T00:01:30.000Z",
        chain: "sei",
        token: "0x0000000000000000000000000000000000000000",
        txHash: "0xnative",
        blockNumber: 1110,
        transactionIndex: 3,
        from: "0x1111111111111111111111111111111111111111",
        to: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
        amount: "2035889450612546048",
        amountDecimal: 2.035889450612546,
        estimatedUsd: 0.12348687462690398,
        sourceFile: "explorer:sei:account_txs",
        confidence: "tx_attributed_native_transfer_history",
      },
    ],
    inboundEvents: [
      {
        observedAt: "2026-05-01T00:02:00.000Z",
        previousObservedAt: "2026-05-01T00:00:00.000Z",
        eventId: "evt-native",
        chain: "sei",
        token: "0x0000000000000000000000000000000000000000",
        ticker: "SEI",
        kind: "native",
        amount: "2035889450612546048",
        amountDecimal: 2.035889450612546,
        estimatedUsd: 0.12348687462690398,
        txHash: null,
        detectionSource: "treasury_inventory_diff",
      },
    ],
  });

  const inbound = ledger.rows.find((row) => row.rowType === "inbound_event");
  assert.equal(inbound.txHash, "0xnative");
  assert.equal(inbound.category, "external_or_internal_inbound_tx");
  assert.equal(inbound.confidence, "tx_attributed_native_transfer_history");
  assert.equal(inbound.attribution.sourceFile, "explorer:sei:account_txs");
  assert.equal(inbound.attribution.matchReason, "native_transfer_history_matches_inbound_event_id_chain_token_and_amount");
  assert.equal(inbound.attribution.transactionIndex, 3);
  assert.equal(ledger.summary.attributedInboundCount, 1);
  assert.equal(ledger.summary.unattributedInboundCount, 0);
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
        amount: "5000000",
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

test("transaction ledger NAV prefers full-rpc inventory and preserves forensic caveats", () => {
  const currentNav = buildTransactionLedgerNav({
    inventoryRecords: [
      {
        observedAt: "2026-05-05T00:00:00.000Z",
        totalUsd: 362,
        totals: { tokenUsd: 295, protocolUsd: 67, totalUsd: 362 },
        summary: { walletCoverage: "partial_supported", scanErrorCount: 5, unknownAssetBalanceCount: 0 },
        source: "live_scan",
      },
      {
        observedAt: "2026-05-05T00:01:00.000Z",
        totalUsd: 370,
        totals: { tokenUsd: 303, protocolUsd: 67, totalUsd: 370 },
        summary: { walletCoverage: "full_rpc", scanErrorCount: 0, unknownAssetBalanceCount: 0 },
        source: "live_scan",
      },
      {
        observedAt: "2026-04-28T00:00:00.000Z",
        totalUsd: 700,
        totals: { totalUsd: 700 },
        summary: {
          walletCoverage: "full_external",
          scanErrorCount: 1,
          externalTotalPortfolioUsd: 700,
          externalUnclassifiedUsd: 525,
        },
        source: "live_scan_with_external_portfolio",
      },
    ],
  });
  const ledger = buildTransactionLedger({ currentNav, baselineUsd: 450 });

  assert.equal(ledger.currentNav.observedAt, "2026-05-05T00:01:00.000Z");
  assert.equal(ledger.currentNav.totalUsd, 370);
  assert.equal(ledger.currentNav.walletCoverage, "full_rpc");
  assert.equal(ledger.currentNav.confidence, "verified_current");
  assert.equal(ledger.currentNav.maxExternalReference.totalUsd, 700);
  assert.equal(ledger.currentNav.externalReferenceWarning, "external_reference_not_current_nav");
  assert.equal(ledger.baseline.deltaFromCurrentUsd, 80);
});

test("transaction ledger NAV flags protocol share double-count inventory rows", () => {
  const currentNav = buildTransactionLedgerNav({
    inventoryRecords: [
      {
        observedAt: "2026-05-05T00:00:00.000Z",
        totalUsd: 437,
        totals: { tokenUsd: 370, protocolUsd: 67, totalUsd: 437 },
        summary: { walletCoverage: "full_rpc", scanErrorCount: 0 },
        tokenBalances: [{
          ticker: "yoUSD",
          estimatedUsd: 67,
          trackingStatus: "protocol_reader_covered",
        }],
        protocolPositions: [{
          symbol: "yoUSD",
          estimatedUsd: 67,
        }],
      },
      {
        observedAt: "2026-05-05T00:01:00.000Z",
        totalUsd: 370,
        totals: { tokenUsd: 303, protocolUsd: 67, totalUsd: 370 },
        summary: { walletCoverage: "full_rpc", scanErrorCount: 0 },
        tokenBalances: [{
          ticker: "yoUSD",
          estimatedUsd: 67,
          trackingStatus: "protocol_reader_covered",
          countedInWalletTotal: false,
        }],
        protocolPositions: [{
          symbol: "yoUSD",
          estimatedUsd: 67,
        }],
      },
    ],
  });

  assert.equal(currentNav.totalUsd, 370);
  assert.equal(currentNav.excludedDoubleCountInventoryCount, 1);
});
