import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProtocolPositionMarksSlice } from "../src/status/protocol-position-marks-slice.mjs";

test("buildProtocolPositionMarksSlice totals latest fresh marks by chain and exposes confidence", () => {
  const slice = buildProtocolPositionMarksSlice(
    [
      {
        event: "position_marked",
        positionId: "p1",
        chain: "base",
        protocolId: "yo",
        valueUsd: 4.99,
        observedAt: "2026-05-03T11:59:00.000Z",
        confidence: "verified_current",
        freshness: "fresh",
      },
      {
        event: "position_marked",
        positionId: "p1",
        chain: "base",
        protocolId: "yo",
        valueUsd: 5.01,
        observedAt: "2026-05-03T12:00:00.000Z",
        confidence: "verified_current",
        freshness: "fresh",
      },
      {
        event: "position_marked",
        positionId: "p2",
        chain: "ethereum",
        protocolId: "morpho",
        valueUsd: 33.7,
        observedAt: "2026-05-03T12:00:10.000Z",
        confidence: "verified_current",
        freshness: "recent",
      },
    ],
    { generatedAt: "2026-05-03T12:01:00.000Z" },
  );

  assert.equal(slice.totalMarkedUsd, 38.71);
  assert.equal(slice.markedPositionCount, 2);
  assert.equal(slice.failedPositionCount, 0);
  assert.equal(slice.confidence, "verified_current");
  assert.equal(slice.byChain.base.valueUsd, 5.01);
  assert.equal(slice.byChain.base.count, 1);
  assert.equal(slice.byChain.ethereum.valueUsd, 33.7);
  assert.deepEqual(slice.items.map((item) => item.positionId), ["p1", "p2"]);
});

test("buildProtocolPositionMarksSlice reports failed stale and expired latest marks as verified minimum", () => {
  const slice = buildProtocolPositionMarksSlice(
    [
      {
        event: "position_marked",
        positionId: "fresh",
        chain: "base",
        valueUsd: 2,
        observedAt: "2026-05-03T12:00:00.000Z",
        confidence: "verified_current",
        freshness: "fresh",
      },
      {
        event: "position_mark_failed",
        positionId: "failed",
        chain: "base",
        observedAt: "2026-05-03T12:00:10.000Z",
        confidence: "adapter_missing",
        freshness: "failed",
      },
      {
        event: "position_marked",
        positionId: "stale",
        chain: "ethereum",
        valueUsd: 9,
        observedAt: "2026-05-03T11:30:00.000Z",
        confidence: "verified_minimum",
        freshness: "stale",
      },
      {
        event: "position_marked",
        positionId: "expired",
        chain: "bsc",
        valueUsd: 7,
        observedAt: "2026-05-03T10:00:00.000Z",
        confidence: "verified_minimum",
        freshness: "expired",
      },
    ],
    { generatedAt: "2026-05-03T12:01:00.000Z" },
  );

  assert.equal(slice.totalMarkedUsd, 18);
  assert.equal(slice.markedPositionCount, 3);
  assert.equal(slice.failedPositionCount, 1);
  assert.equal(slice.stalePositionCount, 1);
  assert.equal(slice.expiredPositionCount, 1);
  assert.equal(slice.oldestMaterialSourceObservedAt, "2026-05-03T10:00:00.000Z");
  assert.equal(slice.confidence, "verified_minimum");
  assert.equal(slice.byChain.base.valueUsd, 2);
  assert.equal(slice.byChain.ethereum.valueUsd, 9);
  assert.equal(slice.byChain.bsc.valueUsd, 7);
  assert.equal(slice.items.find((item) => item.positionId === "stale").source, "protocol_position_mark");
  assert.equal(slice.items.find((item) => item.positionId === "stale").sourceObservedAt, "2026-05-03T11:30:00.000Z");
});

test("buildProtocolPositionMarksSlice ignores marks for inactive source entries when active ids are supplied", () => {
  const slice = buildProtocolPositionMarksSlice(
    [
      {
        event: "position_mark_failed",
        positionId: "old-entry",
        chain: "base",
        observedAt: "2026-05-03T12:00:00.000Z",
        confidence: "adapter_missing",
        freshness: "failed",
      },
      {
        event: "position_marked",
        positionId: "protocol:base:yo:op:erc4626_vault_supply_withdraw:0xvault",
        chain: "base",
        protocolId: "yo",
        valueUsd: 45.77,
        observedAt: "2026-05-03T12:00:10.000Z",
        confidence: "verified_current",
        freshness: "fresh",
      },
    ],
    {
      generatedAt: "2026-05-03T12:01:00.000Z",
      activePositionIds: ["protocol:base:yo:op:erc4626_vault_supply_withdraw:0xvault"],
    },
  );

  assert.equal(slice.latestPositionCount, 1);
  assert.equal(slice.markedPositionCount, 1);
  assert.equal(slice.failedPositionCount, 0);
  assert.equal(slice.confidence, "verified_current");
  assert.equal(slice.totalMarkedUsd, 45.77);
  assert.equal(slice.refreshSuccessRatio.rolling24h, 1);
});

test("buildProtocolPositionMarksSlice treats an explicit empty active id list as no active positions", () => {
  const slice = buildProtocolPositionMarksSlice(
    [
      {
        event: "position_mark_failed",
        positionId: "closed-entry",
        chain: "base",
        observedAt: "2026-05-03T12:00:00.000Z",
        confidence: "adapter_missing",
        freshness: "failed",
      },
      {
        event: "position_marked",
        positionId: "closed-success",
        chain: "base",
        valueUsd: 45.77,
        observedAt: "2026-05-03T12:00:10.000Z",
        confidence: "verified_current",
        freshness: "fresh",
      },
    ],
    {
      generatedAt: "2026-05-03T12:01:00.000Z",
      activePositionIds: [],
    },
  );

  assert.equal(slice.latestPositionCount, 0);
  assert.equal(slice.markedPositionCount, 0);
  assert.equal(slice.failedPositionCount, 0);
  assert.equal(slice.totalMarkedUsd, 0);
  assert.equal(slice.confidence, "verified_current");
  assert.deepEqual(slice.items, []);
});

test("buildProtocolPositionMarksSlice recomputes successful mark freshness from observation age", () => {
  const slice = buildProtocolPositionMarksSlice(
    [
      {
        event: "position_marked",
        positionId: "old-success",
        chain: "base",
        valueUsd: 45.77,
        observedAt: "2026-05-03T10:00:00.000Z",
        confidence: "verified_current",
        freshness: "fresh",
      },
    ],
    { generatedAt: "2026-05-03T12:01:00.000Z" },
  );

  assert.equal(slice.items[0].freshness, "expired");
  assert.equal(slice.expiredPositionCount, 1);
  assert.equal(slice.stalePositionCount, 0);
  assert.equal(slice.confidence, "verified_minimum");
});

test("buildProtocolPositionMarksSlice emits rolling refresh success ratios and transient frequency", () => {
  const slice = buildProtocolPositionMarksSlice(
    [
      {
        event: "position_marked",
        positionId: "p1",
        chain: "base",
        valueUsd: 5,
        observedAt: "2026-05-03T20:00:00.000Z",
        confidence: "verified_current",
      },
      {
        event: "position_mark_failed",
        positionId: "p1",
        chain: "base",
        observedAt: "2026-05-03T20:02:00.000Z",
        failureKind: "rpc_failed",
        confidence: "adapter_missing",
      },
      {
        event: "position_marked",
        positionId: "p2",
        chain: "base",
        valueUsd: 6,
        observedAt: "2026-05-03T22:00:00.000Z",
        confidence: "verified_current",
      },
      {
        event: "position_marked",
        positionId: "p3",
        chain: "ethereum",
        valueUsd: 7,
        observedAt: "2026-05-04T00:00:00.000Z",
        confidence: "verified_current",
      },
      {
        event: "position_marked",
        positionId: "p4",
        chain: "ethereum",
        valueUsd: 8,
        observedAt: "2026-04-30T00:00:00.000Z",
        confidence: "verified_current",
      },
    ],
    { generatedAt: "2026-05-04T00:30:00.000Z" },
  );

  assert.equal(slice.refreshSuccessRatio.rolling1h, 1);
  assert.equal(slice.transientFrequency.rolling1h, 0);
  assert.equal(slice.refreshSuccessRatio.rolling3h, 1);
  assert.equal(slice.transientFrequency.rolling3h, 0);
  assert.equal(slice.refreshSuccessRatio.rolling24h, 0.75);
  assert.equal(slice.transientFrequency.rolling24h, 0.25);
  assert.equal(slice.refreshSuccessRatio.rolling7d, 0.8);
  assert.equal(slice.transientFrequency.rolling7d, 0.2);
  assert.equal(slice.reliability.latestAttempt.successObservedAt, "2026-05-04T00:00:00.000Z");
  assert.equal(slice.reliability.latestAttempt.failureObservedAt, "2026-05-03T20:02:00.000Z");
  assert.equal(slice.reliability.latestAttempt.failureKind, "rpc_failed");
  assert.equal(slice.reliability.latestAttempt.failurePositionId, "p1");
  assert.equal(slice.reliability.recovery24h.stageB.successesNeeded, 16);
  assert.equal(slice.reliability.recovery24h.stageB.earliestRecoveryAt, "2026-05-04T20:02:00.001Z");
  assert.equal(slice.reliability.recovery24h.hysteresis.successesNeeded, 6);
  assert.equal(slice.reliability.recovery24h.hysteresis.earliestRecoveryAt, "2026-05-04T20:02:00.001Z");
});

test("buildProtocolPositionMarksSlice attributes 24h failures by position and root-cause class", () => {
  const slice = buildProtocolPositionMarksSlice(
    [
      {
        event: "position_marked",
        positionId: "base-yo",
        chain: "base",
        protocolId: "yo",
        strategyId: "gateway_native_asset_conversion_sleeve",
        valueUsd: 5,
        observedAt: "2026-05-04T11:00:00.000Z",
        confidence: "verified_current",
      },
      {
        event: "position_mark_failed",
        positionId: "base-yo",
        chain: "base",
        protocolId: "yo",
        strategyId: "gateway_native_asset_conversion_sleeve",
        observedAt: "2026-05-04T11:05:00.000Z",
        failureKind: "adapter_error",
        message: "missing revert data (action=\"call\", reason=null)",
      },
      {
        event: "position_mark_failed",
        positionId: "base-yo",
        chain: "base",
        protocolId: "yo",
        strategyId: "gateway_native_asset_conversion_sleeve",
        observedAt: "2026-05-04T11:06:00.000Z",
        failureKind: "adapter_error",
        message: "CALL_EXCEPTION: missing revert data",
      },
      {
        event: "position_mark_failed",
        positionId: "eth-morpho",
        chain: "ethereum",
        protocolId: "morpho",
        observedAt: "2026-05-04T11:07:00.000Z",
        failureKind: "adapter_missing",
        message: "unsupported binding",
      },
      {
        event: "position_marked",
        positionId: "base-yo",
        chain: "base",
        protocolId: "yo",
        strategyId: "gateway_native_asset_conversion_sleeve",
        valueUsd: 5.1,
        observedAt: "2026-05-04T12:00:00.000Z",
        confidence: "verified_current",
      },
    ],
    { generatedAt: "2026-05-04T12:30:00.000Z" },
  );

  assert.equal(slice.reliability.failureAttribution.window24h.failureCount, 3);
  assert.deepEqual(slice.reliability.failureAttribution.window24h.byFailureClass, [
    { failureClass: "rpc_transient", failureCount: 2, failureShare: 2 / 3 },
    { failureClass: "binding_stale", failureCount: 1, failureShare: 1 / 3 },
  ]);
  assert.equal(slice.reliability.failureAttribution.window24h.byPosition[0].positionId, "base-yo");
  assert.equal(slice.reliability.failureAttribution.window24h.byPosition[0].failureClass, "rpc_transient");
  assert.equal(slice.reliability.failureAttribution.window24h.byPosition[0].failureShare, 2 / 3);
  assert.equal(slice.reliability.failureAttribution.window24h.byPosition[0].latestSuccessAt, "2026-05-04T12:00:00.000Z");
  assert.equal(slice.reliability.failureAttribution.window24h.byChain[0].chain, "base");
  assert.equal(slice.reliability.failureAttribution.window24h.byChain[0].failureClass, "rpc_transient");
});

test("buildProtocolPositionMarksSlice flags sustained sub-0.90 refresh hysteresis", () => {
  const slice = buildProtocolPositionMarksSlice(
    [
      {
        event: "position_mark_failed",
        positionId: "p1",
        chain: "base",
        observedAt: "2026-05-03T11:00:00.000Z",
        failureKind: "reader_throw",
        confidence: "adapter_missing",
      },
      {
        event: "position_mark_failed",
        positionId: "p2",
        chain: "base",
        observedAt: "2026-05-03T11:20:00.000Z",
        failureKind: "reader_throw",
        confidence: "adapter_missing",
      },
      {
        event: "position_mark_failed",
        positionId: "p3",
        chain: "base",
        observedAt: "2026-05-03T11:40:00.000Z",
        failureKind: "reader_throw",
        confidence: "adapter_missing",
      },
      {
        event: "position_marked",
        positionId: "p4",
        chain: "base",
        valueUsd: 5,
        observedAt: "2026-05-03T12:10:00.000Z",
        confidence: "verified_current",
      },
    ],
    { generatedAt: "2026-05-03T13:20:00.000Z" },
  );

  assert.equal(slice.reliability.hysteresis.refreshBelow90SustainedFor1h, true);
  assert.equal(slice.reliability.hysteresis.refreshBelow90Since, "2026-05-03T11:00:00.000Z");
  assert.equal(slice.reliability.recovery24h.hysteresis.earliestRecoveryAt, "2026-05-04T11:40:00.001Z");
});
