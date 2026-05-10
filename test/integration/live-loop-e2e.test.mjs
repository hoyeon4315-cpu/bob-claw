import assert from "node:assert/strict";
import { test } from "node:test";
import snapshotPaybackAccumulator from "../../src/executor/payback/accumulator.mjs";

const BTC_SATS = 100_000_000;

function btcToSats(btc) {
  return Math.round(btc * BTC_SATS);
}

function buildAuditRecord(overrides = {}) {
  return {
    strategyId: overrides.strategyId || "test-strategy",
    timestamp: overrides.timestamp || new Date().toISOString(),
    ...overrides,
  };
}

function buildHarvestRecord(profitUsd, timestamp) {
  return buildAuditRecord({
    strategyId: "yield-strategy",
    timestamp,
    realized: {
      realizedNetPnlUsd: profitUsd,
      realizedNetPnlSats: btcToSats(profitUsd / 90_000),
    },
  });
}

function buildPaybackRecord(settledSats, timestamp, periodId) {
  return buildAuditRecord({
    strategyId: "payback",
    timestamp,
    periodId,
    payback: {
      settledSats,
      paidBackSats: settledSats,
    },
    settlementStatus: "delivered",
    destinationProof: {
      status: "delivered",
      observedDelta: settledSats,
      bitcoinTxid: `txid-${periodId}`,
    },
    broadcast: {
      txHash: `0xhash-${periodId}`,
    },
    metadata: {
      gatewayOrderId: `order-${periodId}`,
      bitcoinTxid: `txid-${periodId}`,
    },
  });
}

function buildInventorySnapshot(btcUsd, timestamp) {
  return {
    observedAt: timestamp,
    native: [],
    tokens: [
      {
        chain: "base",
        ticker: "wBTC",
        actualDecimal: 0.001,
        priceUsd: btcUsd,
      },
    ],
  };
}

test("full tick: deposit detection -> onramp EV -> entry -> harvest -> convert -> compound -> payback accumulator advances", () => {
  const btcUsd = 90_000;
  const now = new Date("2026-05-10T12:00:00.000Z");
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = now.toISOString();

  // Step 1: Deposit detected (inbound deposit)
  const depositRecord = buildAuditRecord({
    strategyId: "inbound-watcher",
    timestamp: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    event: "inbound_deposit_detected",
    classification: { capitalSource: "operating_capital" },
  });

  // Step 2: Onramp EV check passed
  const onrampRecord = buildAuditRecord({
    strategyId: "gateway-onramp",
    timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    realized: {
      realizedNetPnlUsd: -2,
      realizedNetPnlSats: btcToSats(-2 / btcUsd),
    },
  });

  // Step 3: Position entry
  const entryRecord = buildAuditRecord({
    strategyId: "yield-strategy",
    timestamp: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    realized: {
      realizedNetPnlUsd: -1,
      realizedNetPnlSats: btcToSats(-1 / btcUsd),
    },
  });

  // Step 4: Harvest 1
  const harvest1 = buildHarvestRecord(10, new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString());

  // Step 5: Harvest 2
  const harvest2 = buildHarvestRecord(15, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString());

  // Step 6: Convert/compound (no additional profit, just rebalance)
  const compoundRecord = buildAuditRecord({
    strategyId: "yield-strategy",
    timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    realized: {
      realizedNetPnlUsd: 0,
      realizedNetPnlSats: 0,
    },
  });

  // Step 7: Payback period end - no payback yet
  const config = {
    periodId: "period-001",
    periodStartAt: periodStart,
    periodEndAt: periodEnd,
    btcUsd,
    rollingWindowDays: 365,
    paybackStrategyIds: ["payback"],
  };

  const auditLogLines = [depositRecord, onrampRecord, entryRecord, harvest1, harvest2, compoundRecord];
  const receiptStore = {
    treasuryInventory: [buildInventorySnapshot(btcUsd, periodEnd)],
    marketPriceSnapshots: [{ btcUsd, observedAt: periodEnd }],
  };

  const snapshotBeforePayback = snapshotPaybackAccumulator(auditLogLines, receiptStore, config);

  // Gross profit should be positive from harvests only (deposit/entry are capital ingress/cost)
  assert.ok(
    snapshotBeforePayback.grossProfitSats_period > 0,
    "period gross profit should be positive from harvests",
  );
  assert.equal(snapshotBeforePayback.paidBackSats_lifetime, 0, "no paybacks yet");
  assert.ok(
    snapshotBeforePayback.pendingDeferredSats > 0,
    "pending deferred should accumulate gross profit",
  );

  // Step 8: Execute payback
  const paybackAmountSats = Math.floor(snapshotBeforePayback.pendingDeferredSats * 0.2);
  const paybackRecord = buildPaybackRecord(paybackAmountSats, periodEnd, "period-001");

  const auditLogLinesWithPayback = [...auditLogLines, paybackRecord];
  const snapshotAfterPayback = snapshotPaybackAccumulator(auditLogLinesWithPayback, receiptStore, config);

  assert.equal(
    snapshotAfterPayback.paidBackSats_lifetime,
    paybackAmountSats,
    "lifetime paid back should match payback amount",
  );

  assert.ok(
    snapshotAfterPayback.pendingDeferredSats < snapshotBeforePayback.pendingDeferredSats,
    "pending deferred should decrease after payback",
  );

  assert.ok(
    snapshotAfterPayback.kpi.roundTripEfficiency_period >= 0,
    "round trip efficiency should be defined",
  );
});

test("payback accumulator ignores operating capital ingress records", () => {
  const btcUsd = 90_000;
  const now = new Date("2026-05-10T12:00:00.000Z");

  const depositRecord = buildAuditRecord({
    strategyId: "inbound-watcher",
    timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    event: "inbound_deposit_detected",
    realized: {
      realizedNetPnlUsd: 1000,
      realizedNetPnlSats: btcToSats(1000 / btcUsd),
    },
  });

  const config = {
    periodId: "period-002",
    periodStartAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    periodEndAt: now.toISOString(),
    btcUsd,
    rollingWindowDays: 365,
    paybackStrategyIds: ["payback"],
  };

  const snapshot = snapshotPaybackAccumulator([depositRecord], {}, config);

  assert.equal(snapshot.grossProfitSats_period, 0, "operating capital ingress should not count as profit");
  assert.equal(snapshot.pendingDeferredSats, 0, "no profit means no pending payback");
});

test("payback accumulator computes KPIs correctly after two periods", () => {
  const btcUsd = 90_000;
  const period1Start = "2026-04-01T00:00:00.000Z";
  const period1End = "2026-04-07T00:00:00.000Z";
  const period2Start = "2026-04-08T00:00:00.000Z";
  const period2End = "2026-04-14T00:00:00.000Z";

  const harvest1 = buildHarvestRecord(20, "2026-04-03T00:00:00.000Z");
  const harvest2 = buildHarvestRecord(30, "2026-04-10T00:00:00.000Z");

  const payback1 = buildPaybackRecord(btcToSats(0.0001), period1End, "period-001");

  const inventoryStart = buildInventorySnapshot(btcUsd, period1Start);
  const inventoryEnd = buildInventorySnapshot(btcUsd, period2End);

  const config = {
    periodId: "period-002",
    periodStartAt: period2Start,
    periodEndAt: period2End,
    btcUsd,
    rollingWindowDays: 365,
    paybackStrategyIds: ["payback"],
  };

  const auditLogLines = [harvest1, payback1, harvest2];
  const receiptStore = {
    treasuryInventory: [inventoryStart, inventoryEnd],
    marketPriceSnapshots: [{ btcUsd, observedAt: period2End }],
  };

  const snapshot = snapshotPaybackAccumulator(auditLogLines, receiptStore, config);

  assert.equal(snapshot.periodId, "period-002");
  assert.ok(snapshot.grossProfitSats_period > 0, "period-2 gross profit should include harvest2");
  assert.ok(snapshot.paidBackSats_lifetime > 0, "lifetime payback should include payback1");
  assert.ok(Number.isFinite(snapshot.kpi.byr_rolling12m), "BYR should be finite");
  assert.ok(Number.isFinite(snapshot.kpi.cg_rolling12m), "CG should be finite");
  assert.ok(Number.isFinite(snapshot.kpi.tbr_rolling12m), "TBR should be finite");
});

test("accumulator with no records returns zero values", () => {
  const config = {
    periodId: "period-empty",
    periodStartAt: "2026-05-01T00:00:00.000Z",
    periodEndAt: "2026-05-07T00:00:00.000Z",
    btcUsd: 90_000,
  };

  const snapshot = snapshotPaybackAccumulator([], {}, config);

  assert.equal(snapshot.grossProfitSats_period, 0, "empty records should yield zero period profit");
  assert.equal(snapshot.paidBackSats_lifetime, 0, "empty records should yield zero lifetime payback");
  assert.equal(snapshot.pendingDeferredSats, 0, "empty records should yield zero pending");
  assert.equal(snapshot.kpi.byr_rolling12m, 0, "BYR should be 0");
  assert.equal(snapshot.kpi.cg_rolling12m, 0, "CG should be 0");
  assert.equal(snapshot.kpi.tbr_rolling12m, 0, "TBR should be 0");
});

test("live loop: multiple strategies aggregate into accumulator", () => {
  const btcUsd = 90_000;
  const now = new Date("2026-05-10T12:00:00.000Z");
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = now.toISOString();

  const harvestA = buildAuditRecord({
    strategyId: "strategy-a",
    timestamp: "2026-05-05T00:00:00.000Z",
    realized: { realizedNetPnlUsd: 5, realizedNetPnlSats: btcToSats(5 / btcUsd) },
  });

  const harvestB = buildAuditRecord({
    strategyId: "strategy-b",
    timestamp: "2026-05-06T00:00:00.000Z",
    realized: { realizedNetPnlUsd: 8, realizedNetPnlSats: btcToSats(8 / btcUsd) },
  });

  const harvestC = buildAuditRecord({
    strategyId: "strategy-c",
    timestamp: "2026-05-07T00:00:00.000Z",
    realized: { realizedNetPnlUsd: -2, realizedNetPnlSats: btcToSats(-2 / btcUsd) },
  });

  const config = {
    periodId: "period-multi",
    periodStartAt: periodStart,
    periodEndAt: periodEnd,
    btcUsd,
    rollingWindowDays: 365,
  };

  const snapshot = snapshotPaybackAccumulator([harvestA, harvestB, harvestC], {}, config);

  // Only positive profits count
  assert.ok(snapshot.grossProfitSats_period > 0, "multi-strategy should aggregate positive profits");
  assert.equal(snapshot.paidBackSats_lifetime, 0, "no paybacks yet");
});
