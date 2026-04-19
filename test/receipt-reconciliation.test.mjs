import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildReceiptLedgerSummary, buildReceiptReconciliation } from "../src/ledger/receipt-reconciliation.mjs";

function pricesFixture() {
  return {
    btc: 73000,
    nativeByChain: {
      bob: 2200,
      base: 2200,
    },
    tokenByKey: {
      btc: 73000,
      usd_stable: 1,
    },
  };
}

function routeContextFixture(overrides = {}) {
  return {
    routeKey: "bob:0x0555->base:0x0555",
    amount: "10000",
    srcChain: "bob",
    dstChain: "base",
    inputUsd: 7.3,
    outputUsd: 7.28,
    executableOutputUsd: null,
    netEdgeUsd: -0.83,
    executableNetEdgeUsd: null,
    executionGasUsd: 0.001,
    nativeCostUsd: 0.79,
    tradeReadiness: "reject_no_net_edge",
    srcAsset: {
      chain: "bob",
      token: WBTC_OFT_TOKEN,
      ticker: "wBTC.OFT",
      decimals: 8,
      priceKey: "btc",
      isNative: false,
    },
    dstAsset: {
      chain: "base",
      token: WBTC_OFT_TOKEN,
      ticker: "wBTC.OFT",
      decimals: 8,
      priceKey: "btc",
      isNative: false,
    },
    price: {
      dstRawUsd: 73000,
    },
    ...overrides,
  };
}

function receiptFixture(overrides = {}) {
  return {
    status: 1,
    blockNumber: 123,
    gasUsed: 300000n,
    effectiveGasPrice: 1_000_000n,
    from: "0xfrom",
    to: "0xto",
    ...overrides,
  };
}

function transactionFixture(overrides = {}) {
  return {
    from: "0xfrom",
    to: "0xto",
    nonce: 1,
    value: 100000000000000n,
    ...overrides,
  };
}

test("receipt reconciliation computes realized pnl for successful route execution", () => {
  const record = buildReceiptReconciliation({
    chain: "bob",
    txHash: "0xabc",
    routeContext: routeContextFixture(),
    receipt: receiptFixture({
      gasCostWei: "600000000000",
    }),
    transaction: transactionFixture(),
    prices: pricesFixture(),
    output: {
      actualOutputUnits: "10000",
    },
  });

  assert.equal(record.reconciliationStatus, "reconciled");
  assert.equal(Number.isFinite(record.realized.receiptGasUsd), true);
  assert.equal(Number.isFinite(record.realized.actualKnownCostUsd), true);
  assert.equal(Number.isFinite(record.realized.realizedNetPnlUsd), true);
  assert.equal(Number.isInteger(record.realized.realizedNetPnlSats), true);
  assert.equal(record.flags.failed, false);
  assert.equal(record.output.asset.ticker, "wBTC.OFT");
  assert.equal(record.pricing.btcUsd, 73000);
  assert.equal(record.receipt.gasCostWei, "600000000000");
});

test("receipt reconciliation records failed transaction cost even without output", () => {
  const record = buildReceiptReconciliation({
    chain: "bob",
    txHash: "0xdef",
    routeContext: routeContextFixture(),
    receipt: receiptFixture({ status: 0 }),
    transaction: transactionFixture(),
    prices: pricesFixture(),
  });

  assert.equal(record.reconciliationStatus, "failed");
  assert.equal(record.flags.failed, true);
  assert.equal(record.realized.realizedNetPnlUsd < 0, true);
});

test("receipt reconciliation treats zero output as failed when output was expected", () => {
  const record = buildReceiptReconciliation({
    chain: "bob",
    txHash: "0xzero",
    routeContext: routeContextFixture(),
    receipt: receiptFixture(),
    transaction: transactionFixture(),
    prices: pricesFixture(),
    output: {
      actualOutputUnits: "0",
    },
  });

  assert.equal(record.reconciliationStatus, "failed");
  assert.equal(record.output.actualOutputUsd, 0);
});

test("receipt reconciliation infers OFT output units from source receipt logs", () => {
  const record = buildReceiptReconciliation({
    chain: "base",
    txHash: "0xinferred",
    routeContext: routeContextFixture({
      srcChain: "base",
      dstChain: "bsc",
      srcAsset: {
        chain: "base",
        token: WBTC_OFT_TOKEN,
        ticker: "wBTC.OFT",
        decimals: 8,
        priceKey: "btc",
        isNative: false,
      },
      dstAsset: {
        chain: "bsc",
        token: WBTC_OFT_TOKEN,
        ticker: "wBTC.OFT",
        decimals: 8,
        priceKey: "btc",
        isNative: false,
      },
    }),
    receipt: receiptFixture({
      raw: {
        logs: [
          {
            address: WBTC_OFT_TOKEN,
            topics: [
              "0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a",
              "0xguid",
              "0x00000000000000000000000096262be63aa687563789225c2fe898c27a3b0ae4",
            ],
            data: "0x000000000000000000000000000000000000000000000000000000000000759600000000000000000000000000000000000000000000000000000000000003e900000000000000000000000000000000000000000000000000000000000003e9",
          },
        ],
      },
    }),
    transaction: transactionFixture(),
    prices: pricesFixture(),
  });

  assert.equal(record.reconciliationStatus, "reconciled");
  assert.equal(record.output.actualOutputUnits, "1001");
  assert.equal(record.output.outputInference, "oft_sent_log");
  assert.equal(Number.isFinite(record.output.actualOutputUsd), true);
});

test("receipt ledger summary aggregates realized records", () => {
  const success = buildReceiptReconciliation({
    chain: "bob",
    txHash: "0x1",
    routeContext: routeContextFixture(),
    receipt: receiptFixture(),
    transaction: transactionFixture(),
    prices: pricesFixture(),
    output: { actualOutputUnits: "10000" },
  });
  const failed = buildReceiptReconciliation({
    chain: "bob",
    txHash: "0x2",
    routeContext: routeContextFixture(),
    receipt: receiptFixture({ status: 0 }),
    transaction: transactionFixture(),
    prices: pricesFixture(),
  });
  const summary = buildReceiptLedgerSummary([success, failed]);

  assert.equal(summary.summary.recordCount, 2);
  assert.equal(summary.summary.reconciledCount, 1);
  assert.equal(summary.summary.failedCount, 1);
  assert.equal(Number.isFinite(summary.summary.realizedNetPnlUsd), true);
  assert.equal(Number.isFinite(summary.summary.totalEstimatedNetPnlUsd), true);
  assert.equal(Number.isFinite(summary.summary.totalNetDriftUsd), true);
  assert.equal(Number.isFinite(summary.summary.totalExecutionGasDriftUsd), true);
  assert.equal(summary.routes.length, 1);
  assert.equal(Number.isFinite(summary.routes[0].totalEstimatedNetPnlUsd), true);
  assert.equal(Number.isFinite(summary.routes[0].totalNetDriftUsd), true);
  assert.equal(Number.isFinite(summary.routes[0].totalExecutionGasDriftUsd), true);
});

test("receipt reconciliation tolerates transaction objects without value", () => {
  const record = buildReceiptReconciliation({
    chain: "bob",
    txHash: "0x123",
    routeContext: routeContextFixture(),
    receipt: receiptFixture(),
    transaction: transactionFixture({ value: undefined }),
    prices: pricesFixture(),
    output: { actualOutputUnits: "10000" },
  });

  assert.equal(record.transaction.value, null);
  assert.equal(record.transaction.valueDecimal, null);
  assert.equal(Number.isFinite(record.realized.realizedNetPnlUsd), true);
});
