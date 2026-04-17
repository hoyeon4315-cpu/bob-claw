import assert from "node:assert/strict";
import { test } from "node:test";
import snapshotPaybackAccumulator from "../src/executor/payback/accumulator.mjs";

function assertAlmostEqual(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("payback accumulator returns zeroed snapshot for empty inputs", () => {
  assert.deepEqual(snapshotPaybackAccumulator([], {}, {}), {
    periodId: "all_time",
    grossProfitSats_period: 0,
    paidBackSats_lifetime: 0,
    pendingDeferredSats: 0,
    operatingFloatSats_byChain: {},
    kpi: {
      byr_rolling12m: 0,
      cg_rolling12m: 0,
      tbr_rolling12m: 0,
      roundTripEfficiency_period: 0,
      daysToBreakeven: 0,
    },
  });
});

test("payback accumulator projects usd receipts and inventory into sats deterministically", () => {
  const auditLogLines = [
    {
      timestamp: "2026-04-16T01:00:00.000Z",
      realized: {
        realizedNetPnlUsd: 25,
      },
    },
  ];

  const receiptStore = {
    marketPriceSnapshots: [
      {
        observedAt: "2026-04-16T00:59:00.000Z",
        btcUsd: 100_000,
      },
    ],
    treasuryInventory: [
      {
        observedAt: "2026-04-16T01:10:00.000Z",
        native: [
          {
            chain: "base",
            asset: "ETH",
            actualDecimal: 0.01,
            priceUsd: 2_000,
            estimatedUsd: 20,
          },
        ],
        tokens: [
          {
            chain: "base",
            ticker: "wBTC.OFT",
            actualDecimal: 0.00012345,
            priceUsd: 100_000,
          },
        ],
      },
    ],
  };

  const first = snapshotPaybackAccumulator(auditLogLines, receiptStore, {
    depositedSats: 1_000_000,
  });
  const second = snapshotPaybackAccumulator(auditLogLines, receiptStore, {
    depositedSats: 1_000_000,
  });

  assert.deepEqual(first, second);
  assert.equal(first.grossProfitSats_period, 25_000);
  assert.equal(first.pendingDeferredSats, 25_000);
  assert.deepEqual(first.operatingFloatSats_byChain, {
    base: 32_345,
  });
  assert.equal(first.kpi.roundTripEfficiency_period, 1);
});

test("payback accumulator uses record pricing before newer market snapshots", () => {
  const auditLogLines = [
    {
      timestamp: "2026-04-16T01:00:00.000Z",
      pricing: {
        btcUsd: 100_000,
      },
      realized: {
        realizedNetPnlUsd: 10,
      },
    },
  ];

  const receiptStore = {
    marketPriceSnapshots: [
      {
        observedAt: "2026-04-17T00:00:00.000Z",
        btcUsd: 50_000,
      },
    ],
  };

  const snapshot = snapshotPaybackAccumulator(auditLogLines, receiptStore, {});
  assert.equal(snapshot.grossProfitSats_period, 10_000);
  assert.equal(snapshot.pendingDeferredSats, 10_000);
});

test("payback accumulator computes documented KPI formulas from rolling capital and settled payback", () => {
  const auditLogLines = [
    {
      timestamp: "2026-04-01T00:00:00.000Z",
      realized: {
        grossProfitSats: 100_000,
      },
    },
    {
      timestamp: "2026-04-02T00:00:00.000Z",
      realized: {
        grossProfitSats: 100_000,
      },
    },
    {
      timestamp: "2026-04-10T00:00:00.000Z",
      payback: {
        paidBackSats: 200_000,
        offrampCostSats: 20_000,
      },
    },
  ];

  const receiptStore = {
    treasuryInventory: [
      {
        observedAt: "2025-04-16T00:00:00.000Z",
        tokens: [
          {
            chain: "base",
            ticker: "wBTC.OFT",
            operatingFloatSats: 1_000_000,
          },
        ],
      },
      {
        observedAt: "2026-04-16T00:00:00.000Z",
        tokens: [
          {
            chain: "base",
            ticker: "wBTC.OFT",
            operatingFloatSats: 1_200_000,
          },
        ],
      },
    ],
  };

  const snapshot = snapshotPaybackAccumulator(auditLogLines, receiptStore, {
    periodStartAt: "2026-04-01T00:00:00.000Z",
    periodEndAt: "2026-04-30T00:00:00.000Z",
    initialRoundTripEntrySats: 500_000,
  });

  assert.equal(snapshot.grossProfitSats_period, 200_000);
  assert.equal(snapshot.paidBackSats_lifetime, 200_000);
  assertAlmostEqual(snapshot.kpi.byr_rolling12m, 0.2);
  assertAlmostEqual(snapshot.kpi.cg_rolling12m, 0.2);
  assertAlmostEqual(snapshot.kpi.tbr_rolling12m, 0.4);
  assertAlmostEqual(snapshot.kpi.roundTripEfficiency_period, 0.9);
  assertAlmostEqual(snapshot.kpi.daysToBreakeven, 1.5);
});

test("payback accumulator only counts delivered payback when three-way receipt is present", () => {
  const withThreeWayReceipt = {
    timestamp: "2026-04-16T01:00:00.000Z",
    strategyId: "gateway-btc-offramp",
    settlementStatus: "delivered",
    signerResult: {
      broadcast: {
        txHash: "0xabc",
      },
    },
    metadata: {
      gatewayOrderId: "order-123",
    },
    destinationProof: {
      status: "delivered",
      observedDelta: "4200",
      txid: "btc123",
    },
  };
  const missingBitcoinTxid = {
    timestamp: "2026-04-16T02:00:00.000Z",
    strategyId: "gateway-btc-offramp",
    settlementStatus: "delivered",
    signerResult: {
      broadcast: {
        txHash: "0xdef",
      },
    },
    metadata: {
      gatewayOrderId: "order-456",
      gatewayExpectedBitcoinSats: "5000",
    },
    destinationProof: {
      status: "delivered",
      observedDelta: "5000",
      requiredDelta: "5000",
    },
  };

  const snapshot = snapshotPaybackAccumulator([withThreeWayReceipt, missingBitcoinTxid], {}, {
    paybackStrategyIds: ["gateway-btc-offramp"],
  });

  assert.equal(snapshot.paidBackSats_lifetime, 4_200);
});

test("payback accumulator excludes delivered payback receipts from gross profit", () => {
  const deliveredPayback = {
    timestamp: "2026-04-16T01:00:00.000Z",
    strategyId: "gateway-btc-offramp",
    settlementStatus: "delivered",
    pricing: {
      btcUsd: 100_000,
    },
    realized: {
      realizedNetPnlUsd: 10,
    },
    signerResult: {
      broadcast: {
        txHash: "0xpayback",
      },
    },
    metadata: {
      gatewayOrderId: "order-123",
    },
    destinationProof: {
      status: "delivered",
      observedDelta: "4200",
      txid: "btc123",
    },
  };

  const snapshot = snapshotPaybackAccumulator([deliveredPayback], {}, {
    paybackStrategyIds: ["gateway-btc-offramp"],
    paybackIntentTypes: ["gateway_btc_offramp"],
  });

  assert.equal(snapshot.grossProfitSats_period, 0);
  assert.equal(snapshot.paidBackSats_lifetime, 4_200);
  assert.equal(snapshot.pendingDeferredSats, 0);
});
