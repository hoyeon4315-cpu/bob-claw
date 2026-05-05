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
        observedAt: "2026-05-03T11:00:00.000Z",
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
  assert.equal(slice.confidence, "verified_minimum");
  assert.equal(slice.byChain.base.valueUsd, 2);
  assert.equal(slice.byChain.ethereum.valueUsd, 9);
  assert.equal(slice.byChain.bsc.valueUsd, 7);
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
