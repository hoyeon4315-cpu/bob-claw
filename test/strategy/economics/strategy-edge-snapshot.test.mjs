import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyEdgeSnapshots } from "../../../src/strategy/economics/strategy-edge-snapshot.mjs";

const STRATEGY = Object.freeze({
  strategyId: "s1",
  autoExecute: true,
  caps: { perTxUsd: 200, perDayUsd: 500, perChainUsd: { base: 500 }, maxDailyLossUsd: 25 },
});

test("strategy edge snapshot derives edge, p90 cost, cost variance, and freshness from receipts", () => {
  const [snapshot] = buildStrategyEdgeSnapshots({
    strategies: [STRATEGY],
    receiptRecords: [
      {
        strategyId: "s1",
        chain: "base",
        intentType: "fund_strategy",
        observedAt: "2026-05-08T00:00:00.000Z",
        notionalUsd: 100,
        holdingPeriodDays: 1,
        realized: { actualKnownCostUsd: 1, realizedNetPnlUsd: 0.12 },
      },
      {
        strategyId: "s1",
        chain: "base",
        intentType: "fund_strategy",
        observedAt: "2026-05-08T01:00:00.000Z",
        notionalUsd: 100,
        holdingPeriodDays: 1,
        realized: { actualKnownCostUsd: 1.4, realizedNetPnlUsd: 0.16 },
      },
    ],
    strategyTickStatus: {
      strategies: [{ strategyId: "s1", scoredAllocation: { allocatedSats: 10_000 }, observedNotionalUsd: 42 }],
    },
    now: "2026-05-09T00:00:00.000Z",
    policy: { minProfitFloorUsd: 0.25, minSamples: 2 },
  });
  assert.equal(snapshot.strategyId, "s1");
  assert.ok(snapshot.measuredEdgeBpsPerDay > 133);
  assert.ok(snapshot.measuredEdgeBpsPerDay < 135);
  assert.equal(snapshot.measuredRoundTripCostUsd, 1.4);
  assert.ok(snapshot.slippageVarianceUsd > 0);
  assert.equal(snapshot.varianceFloorUsd, 0.25);
  assert.equal(snapshot.observedNotionalUsd, 42);
  assert.deepEqual(snapshot.freshness, {
    lastReceiptAt: "2026-05-08T01:00:00.000Z",
    sampleCount: 2,
    isThin: false,
  });
});

test("strategy edge snapshot marks missing, thin, and stale evidence without throwing", () => {
  const snapshots = buildStrategyEdgeSnapshots({
    strategies: [
      STRATEGY,
      { ...STRATEGY, strategyId: "s2" },
      { ...STRATEGY, strategyId: "s3" },
    ],
    receiptRecords: [
      {
        strategyId: "s2",
        chain: "base",
        intentType: "fund_strategy",
        observedAt: "2026-05-08T00:00:00.000Z",
        notionalUsd: 50,
        realized: { actualKnownCostUsd: 0.5, realizedNetPnlUsd: 0.01 },
      },
      {
        strategyId: "s3",
        chain: "base",
        intentType: "fund_strategy",
        observedAt: "2026-04-01T00:00:00.000Z",
        notionalUsd: 50,
        realized: { actualKnownCostUsd: 0.5, realizedNetPnlUsd: 0.01 },
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
    freshnessMaxAgeDays: 7,
    policy: { minProfitFloorUsd: 0.1, minSamples: 2 },
  });
  const byId = new Map(snapshots.map((item) => [item.strategyId, item]));
  assert.equal(byId.get("s1").measuredEdgeBpsPerDay, null);
  assert.equal(byId.get("s1").freshness.sampleCount, 0);
  assert.equal(byId.get("s1").freshness.isThin, true);
  assert.equal(byId.get("s2").freshness.sampleCount, 1);
  assert.equal(byId.get("s2").freshness.isThin, true);
  assert.equal(byId.get("s3").freshness.isThin, true);
});

test("strategy edge snapshot prefers receipt, yield shadow, shadow, sibling proxy, then transport one-shot evidence", () => {
  const snapshots = buildStrategyEdgeSnapshots({
    strategies: [
      STRATEGY,
      { ...STRATEGY, strategyId: "yield-shadow-only" },
      { ...STRATEGY, strategyId: "shadow-only" },
      { ...STRATEGY, strategyId: "proxy-only" },
      { ...STRATEGY, strategyId: "transport-only" },
    ],
    receiptRecords: [
      {
        strategyId: "s1",
        chain: "base",
        intentType: "fund_strategy",
        observedAt: "2026-05-08T00:00:00.000Z",
        notionalUsd: 100,
        holdingPeriodDays: 1,
        realized: { actualKnownCostUsd: 1, realizedNetPnlUsd: 0.1 },
      },
    ],
    shadowEdgeRecords: [
      {
        strategyId: "s1",
        chain: "base",
        evidenceClass: "shadow",
        estimatedEdgeBpsPerDay: 99,
        estimatedRoundTripCostUsd: 9,
        sampleCount: 9,
        lastSimAt: "2026-05-08T02:00:00.000Z",
        confidence: 0.5,
      },
      {
        strategyId: "yield-shadow-only",
        chain: "base",
        evidenceClass: "yield_shadow",
        estimatedEdgeBpsPerDay: 24,
        estimatedRoundTripCostUsd: 0.21,
        sampleCount: 2,
        lastSimAt: "2026-05-08T04:00:00.000Z",
        confidence: 0.5,
      },
      {
        strategyId: "yield-shadow-only",
        chain: "base",
        evidenceClass: "shadow",
        estimatedEdgeBpsPerDay: 99,
        estimatedRoundTripCostUsd: 0.01,
        sampleCount: 9,
        lastSimAt: "2026-05-08T05:00:00.000Z",
        confidence: 0.5,
      },
      {
        strategyId: "shadow-only",
        chain: "base",
        evidenceClass: "shadow",
        estimatedEdgeBpsPerDay: 20,
        estimatedRoundTripCostUsd: 0.25,
        sampleCount: 3,
        lastSimAt: "2026-05-08T03:00:00.000Z",
        confidence: 0.5,
      },
      {
        strategyId: "transport-only",
        chain: "base",
        evidenceClass: "transport_one_shot",
        estimatedEdgeBpsPerDay: null,
        estimatedRoundTripCostUsd: 0.12,
        oneShotNetEdgeUsd: 0.08,
        sampleCount: 1,
        lastSimAt: "2026-05-08T06:00:00.000Z",
        confidence: 0,
      },
    ],
    siblingProxyRecords: [
      {
        strategyId: "proxy-only",
        chain: "base",
        evidenceClass: "sibling_proxy",
        proxyEdgeBpsPerDay: 12,
        proxyRoundTripCostUsd: 0.3,
        borrowedFromStrategyId: "sibling",
        borrowedFromChain: "optimism",
        confidence: 0.4,
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
    freshnessMaxAgeDays: 7,
    policy: { minProfitFloorUsd: 0.1, minSamples: 1 },
  });

  const byId = new Map(snapshots.map((item) => [item.strategyId, item]));
  assert.equal(byId.get("s1").evidenceClass, "receipt");
  assert.equal(byId.get("yield-shadow-only").evidenceClass, "yield_shadow");
  assert.equal(byId.get("yield-shadow-only").measuredEdgeBpsPerDay, 24);
  assert.equal(byId.get("yield-shadow-only").measuredRoundTripCostUsd, 0.21);
  assert.equal(byId.get("shadow-only").evidenceClass, "shadow");
  assert.equal(byId.get("shadow-only").measuredEdgeBpsPerDay, 20);
  assert.equal(byId.get("shadow-only").evidenceConfidence, 0.5);
  assert.equal(byId.get("proxy-only").evidenceClass, "sibling_proxy");
  assert.equal(byId.get("proxy-only").measuredRoundTripCostUsd, 0.3);
  assert.equal(byId.get("proxy-only").evidenceConfidence, 0.4);
  assert.equal(byId.get("transport-only").evidenceClass, "transport_one_shot");
  assert.equal(byId.get("transport-only").measuredEdgeBpsPerDay, null);
  assert.equal(byId.get("transport-only").measuredRoundTripCostUsd, 0.12);
});
