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
