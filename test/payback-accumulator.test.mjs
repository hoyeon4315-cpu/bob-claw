import assert from "node:assert/strict";
import { test } from "node:test";
import snapshotPaybackAccumulator, {
  buildPriceIndex,
  profitSatsFromRecord,
} from "../src/executor/payback/accumulator.mjs";

function assertAlmostEqual(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("payback accumulator returns zeroed snapshot for empty inputs", () => {
  assert.deepEqual(snapshotPaybackAccumulator([], {}, {}), {
    periodId: "all_time",
    grossProfitSats_period: 0,
    paidBackSats_lifetime: 0,
    pendingDeferredSats: 0,
    profitSatsProvenance: {
      period: {
        directSats: 0,
        projectedSats: 0,
        totalSats: 0,
      },
      lifetime: {
        directSats: 0,
        projectedSats: 0,
        totalSats: 0,
      },
      rolling12m: {
        directSats: 0,
        projectedSats: 0,
        totalSats: 0,
      },
      pendingDeferred: {
        directSats: 0,
        projectedSats: 0,
        totalSats: 0,
        source: "computed_from_profit_sources",
      },
    },
    operatingFloatSats_byChain: {},
    kpi: {
      byr_rolling12m: 0,
      cg_rolling12m: 0,
      tbr_rolling12m: 0,
      roundTripEfficiency_period: 0,
      daysToBreakeven: 0,
    },
    paybackPeriodEfficiencies: [],
    expansionGate: {
      reserveChain: "base",
      targetEfficiency: 0.9,
      requiredConsecutivePeriods: 8,
      consecutivePeriodsMeetingTarget: 0,
      periodsRemaining: 8,
      deliveredPeriodCountOnReserveChain: 0,
      deliveredPeriodCountAllChains: 0,
      eligible: false,
      mostRecent: null,
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
  assert.deepEqual(first.profitSatsProvenance.period, {
    directSats: 0,
    projectedSats: 25_000,
    totalSats: 25_000,
  });
  assert.deepEqual(first.profitSatsProvenance.pendingDeferred, {
    directSats: 0,
    projectedSats: 25_000,
    totalSats: 25_000,
    source: "computed_from_profit_sources",
  });
  assert.equal(first.kpi.roundTripEfficiency_period, 1);
});

test("payback accumulator separates direct receipt sats from USD-projected sats", () => {
  const snapshot = snapshotPaybackAccumulator(
    [
      {
        timestamp: "2026-04-16T01:00:00.000Z",
        realized: {
          realizedNetPnlSats: 320,
        },
      },
      {
        timestamp: "2026-04-16T02:00:00.000Z",
        pricing: {
          btcUsd: 100_000,
        },
        realized: {
          realizedNetPnlUsd: 2.81,
        },
      },
    ],
    {},
    {},
  );

  assert.equal(snapshot.grossProfitSats_period, 3_130);
  assert.equal(snapshot.pendingDeferredSats, 3_130);
  assert.deepEqual(snapshot.profitSatsProvenance.period, {
    directSats: 320,
    projectedSats: 2_810,
    totalSats: 3_130,
  });
  assert.deepEqual(snapshot.profitSatsProvenance.pendingDeferred, {
    directSats: 320,
    projectedSats: 2_810,
    totalSats: 3_130,
    source: "computed_from_profit_sources",
  });
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

test("payback accumulator excludes operating capital ingress records from profit accounting", () => {
  const auditLogLines = [
    {
      timestamp: "2026-04-16T01:00:00.000Z",
      event: "inbound_deposit_detected",
      capitalSource: "operating_capital",
      capitalFlow: "operating_capital_ingress",
      paybackExclusion: true,
      realized: {
        realizedNetPnlUsd: 999,
      },
    },
    {
      timestamp: "2026-04-16T02:00:00.000Z",
      realized: {
        realizedNetPnlUsd: 10,
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

  const snapshot = snapshotPaybackAccumulator(
    [withThreeWayReceipt, missingBitcoinTxid],
    {},
    {
      paybackStrategyIds: ["gateway-btc-offramp"],
    },
  );

  assert.equal(snapshot.paidBackSats_lifetime, 4_200);
});

test("payback accumulator tracks base expansion gate over 8 consecutive delivered periods", () => {
  const CHAIN = "base";
  const buildDelivered = (index, grossProfitSats, realizedRoundTripCostSats, { hoursAgo = 0 } = {}) => {
    const observedAt = new Date(Date.UTC(2026, 3, 10, 0, 0, 0) + index * 7 * 24 * 60 * 60 * 1000);
    return {
      timestamp: observedAt.toISOString(),
      strategyId: "gateway-btc-offramp",
      settlementStatus: "delivered",
      chain: CHAIN,
      periodId: `period-${index}`,
      payback: {
        grossProfitSats,
        realizedRoundTripCostSats,
      },
      signerResult: {
        broadcast: { txHash: `0xsource-${index}` },
      },
      metadata: {
        gatewayOrderId: `order-${index}`,
      },
      destinationProof: {
        status: "delivered",
        observedDelta: String(Math.max(0, grossProfitSats - realizedRoundTripCostSats)),
        txid: `btc-${index}`,
      },
    };
  };

  const eightPassing = Array.from({ length: 8 }, (_, index) => buildDelivered(index, 100_000, 5_000));
  const snapshotPassing = snapshotPaybackAccumulator(
    eightPassing,
    {},
    {
      paybackStrategyIds: ["gateway-btc-offramp"],
      paybackIntentTypes: ["gateway_btc_offramp"],
    },
  );

  assert.equal(snapshotPassing.expansionGate.consecutivePeriodsMeetingTarget, 8);
  assert.equal(snapshotPassing.expansionGate.periodsRemaining, 0);
  assert.equal(snapshotPassing.expansionGate.eligible, true);
  assert.equal(snapshotPassing.paybackPeriodEfficiencies.length, 8);
  assert.equal(snapshotPassing.paybackPeriodEfficiencies.at(-1).meetsTarget, true);

  const withFailure = [
    buildDelivered(0, 100_000, 20_000), // 0.8 efficiency, fails 0.9 target
    ...Array.from({ length: 5 }, (_, index) => buildDelivered(index + 1, 100_000, 5_000)),
  ];
  const snapshotWithFailure = snapshotPaybackAccumulator(
    withFailure,
    {},
    {
      paybackStrategyIds: ["gateway-btc-offramp"],
      paybackIntentTypes: ["gateway_btc_offramp"],
    },
  );
  assert.equal(snapshotWithFailure.expansionGate.consecutivePeriodsMeetingTarget, 5);
  assert.equal(snapshotWithFailure.expansionGate.periodsRemaining, 3);
  assert.equal(snapshotWithFailure.expansionGate.eligible, false);
  assert.equal(snapshotWithFailure.expansionGate.deliveredPeriodCountOnReserveChain, 6);

  const offChain = [buildDelivered(0, 100_000, 5_000), { ...buildDelivered(1, 100_000, 5_000), chain: "avalanche" }];
  const snapshotOffChain = snapshotPaybackAccumulator(
    offChain,
    {},
    {
      paybackStrategyIds: ["gateway-btc-offramp"],
      paybackIntentTypes: ["gateway_btc_offramp"],
    },
  );
  assert.equal(snapshotOffChain.expansionGate.consecutivePeriodsMeetingTarget, 1);
  assert.equal(snapshotOffChain.expansionGate.deliveredPeriodCountOnReserveChain, 1);
  assert.equal(snapshotOffChain.expansionGate.deliveredPeriodCountAllChains, 2);
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

  const snapshot = snapshotPaybackAccumulator(
    [deliveredPayback],
    {},
    {
      paybackStrategyIds: ["gateway-btc-offramp"],
      paybackIntentTypes: ["gateway_btc_offramp"],
    },
  );

  assert.equal(snapshot.grossProfitSats_period, 0);
  assert.equal(snapshot.paidBackSats_lifetime, 4_200);
  assert.equal(snapshot.pendingDeferredSats, 0);
});

test("payback accumulator only counts payback-eligible realized pnl from receipt ledger", () => {
  const snapshot = snapshotPaybackAccumulator(
    [],
    {
      receiptReconciliations: [
        {
          observedAt: "2026-04-16T01:00:00.000Z",
          kind: "token_dex_experiment",
          pnl: {
            classification: "execution_evidence_cost",
            realizedPnlSats: 1000,
            paybackEligibleRealizedPnlSats: 0,
          },
        },
        {
          observedAt: "2026-04-16T02:00:00.000Z",
          kind: "strategy_harvest",
          pnl: {
            classification: "strategy_realized_pnl",
            realizedPnlSats: 5000,
            paybackEligibleRealizedPnlSats: 5000,
          },
        },
      ],
    },
    {},
  );

  assert.equal(snapshot.grossProfitSats_period, 5_000);
  assert.equal(snapshot.pendingDeferredSats, 5_000);
});

test("buildPriceIndex pre-normalizes valid market price snapshots and tracks the latest btcUsd", () => {
  const index = buildPriceIndex([
    { observedAt: "2026-04-16T00:00:00.000Z", btcUsd: 90_000 },
    { observedAt: "2026-04-16T01:00:00.000Z", btcUsd: 95_000 },
    { observedAt: "bad-date", btcUsd: 100_000 },
    { observedAt: "2026-04-16T02:00:00.000Z" },
    { observedAt: "2026-04-16T03:00:00.000Z", btcUsd: 101_000 },
  ]);
  // bad-date snapshot is preserved as ms=0 (parity with legacy latestTimestampMs reducer),
  // observedAt-only snapshot is dropped because btcUsd is missing.
  assert.equal(index.entries.length, 4);
  assert.equal(index.fallbackBtcUsd, 101_000);
});

test("buildPriceIndex skips snapshots missing btcUsd and reflects the legacy ms=0 fallback for timestamp-less entries", () => {
  const index = buildPriceIndex([{ observedAt: "bad" }, { btcUsd: 100_000 }, null]);
  // legacy latestTimestampMs returns 0 for missing/invalid timestamps, so a snapshot with
  // only btcUsd remains in the index with ms=0 (will lose distance comparisons against
  // any record with a real observedAt). Snapshots missing btcUsd are skipped entirely.
  assert.deepEqual(index.entries, [{ ms: 0, btcUsd: 100_000 }]);
  assert.equal(index.fallbackBtcUsd, 100_000);
});

test("buildPriceIndex returns empty index when every snapshot lacks btcUsd", () => {
  const index = buildPriceIndex([{ observedAt: "bad" }, null, { foo: 1 }]);
  assert.deepEqual(index.entries, []);
  assert.equal(index.fallbackBtcUsd, null);
});

test("profitSatsFromRecord returns identical sats via priceIndex and raw scan", () => {
  const marketPriceSnapshots = [
    { observedAt: "2026-04-15T23:00:00.000Z", btcUsd: 88_000 },
    { observedAt: "2026-04-16T00:30:00.000Z", btcUsd: 92_500 },
    { observedAt: "2026-04-16T01:00:00.000Z", btcUsd: 95_000 },
    { observedAt: "2026-04-16T02:00:00.000Z", btcUsd: 96_500 },
  ];
  const priceIndex = buildPriceIndex(marketPriceSnapshots);
  const records = [
    { observedAt: "2026-04-16T00:31:00.000Z", realized: { realizedNetPnlUsd: 50 } },
    { observedAt: "2026-04-16T01:30:00.000Z", realized: { realizedNetPnlUsd: 75 } },
    { observedAt: "2026-04-16T03:00:00.000Z", realized: { realizedNetPnlUsd: 25 } },
  ];
  for (const record of records) {
    const raw = profitSatsFromRecord(record, marketPriceSnapshots, {});
    const indexed = profitSatsFromRecord(record, marketPriceSnapshots, { priceIndex });
    assert.equal(indexed, raw);
  }
});

test("profitSatsFromRecord falls back to latest btcUsd when record has no usable timestamp via priceIndex", () => {
  const marketPriceSnapshots = [
    { observedAt: "2026-04-15T23:00:00.000Z", btcUsd: 88_000 },
    { observedAt: "2026-04-16T05:00:00.000Z", btcUsd: 99_000 },
  ];
  const priceIndex = buildPriceIndex(marketPriceSnapshots);
  const record = { realized: { realizedNetPnlUsd: 100 } };
  const indexed = profitSatsFromRecord(record, marketPriceSnapshots, { priceIndex });
  const raw = profitSatsFromRecord(record, marketPriceSnapshots, {});
  assert.equal(indexed, raw);
});

test("snapshotPaybackAccumulator produces identical grossProfitSats with and without explicit priceIndex pre-build", () => {
  const auditLogLines = [
    { timestamp: "2026-04-15T23:30:00.000Z", realized: { realizedNetPnlUsd: 10 } },
    { timestamp: "2026-04-16T00:45:00.000Z", realized: { realizedNetPnlUsd: 20 } },
    { timestamp: "2026-04-16T02:15:00.000Z", realized: { realizedNetPnlUsd: 30 } },
  ];
  const receiptStore = {
    marketPriceSnapshots: [
      { observedAt: "2026-04-15T22:00:00.000Z", btcUsd: 80_000 },
      { observedAt: "2026-04-16T00:30:00.000Z", btcUsd: 90_000 },
      { observedAt: "2026-04-16T02:00:00.000Z", btcUsd: 95_000 },
    ],
  };
  const snapshot = snapshotPaybackAccumulator(auditLogLines, receiptStore, {
    periodStartAt: "2026-04-15T00:00:00.000Z",
    periodEndAt: "2026-04-17T00:00:00.000Z",
  });
  assert.ok(snapshot.grossProfitSats_period > 0);
  assert.equal(snapshot.profitSatsProvenance.period.directSats, 0);
  assert.equal(snapshot.profitSatsProvenance.period.projectedSats, snapshot.grossProfitSats_period);
});
