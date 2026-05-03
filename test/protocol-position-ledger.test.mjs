import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeProtocolPositions,
  latestProtocolMarksByPosition,
  mergeProtocolMarksIntoPositions,
} from "../src/treasury/protocol-position-ledger.mjs";

test("activeProtocolPositions returns open entries not subsequently closed by positionId", () => {
  const events = [
    {
      event: "position_opened",
      status: "open",
      positionId: "p1",
      observedAt: "2026-05-03T10:00:00.000Z",
      amountUsd: 5,
    },
    {
      event: "position_opened",
      status: "open",
      positionId: "p2",
      observedAt: "2026-05-03T10:01:00.000Z",
      amountUsd: 7,
    },
    {
      event: "position_exit_confirmed",
      status: "closed",
      positionId: "p1",
      observedAt: "2026-05-03T10:02:00.000Z",
    },
  ];

  assert.deepEqual(
    activeProtocolPositions(events).map((event) => event.positionId),
    ["p2"],
  );
});

test("activeProtocolPositions handles out-of-order events and sorts active entries", () => {
  const events = [
    {
      event: "position_opened",
      status: "open",
      positionId: "late",
      observedAt: "2026-05-03T10:08:00.000Z",
    },
    {
      event: "position_exit_confirmed",
      status: "closed",
      positionId: "closed",
      observedAt: "2026-05-03T10:05:00.000Z",
    },
    {
      event: "position_opened",
      status: "open",
      positionId: "closed",
      observedAt: "2026-05-03T10:01:00.000Z",
    },
    {
      event: "position_opened",
      status: "open",
      positionId: "early",
      observedAt: "2026-05-03T10:03:00.000Z",
    },
  ];

  assert.deepEqual(
    activeProtocolPositions(events).map((event) => event.positionId),
    ["early", "late"],
  );
});

test("activeProtocolPositions lets close events win same-timestamp ties", () => {
  const observedAt = "2026-05-03T10:05:00.000Z";
  const events = [
    {
      event: "position_exit_confirmed",
      status: "closed",
      positionId: "p1",
      observedAt,
    },
    {
      event: "position_opened",
      status: "open",
      positionId: "p1",
      observedAt,
    },
  ];

  assert.deepEqual(activeProtocolPositions(events), []);
});

test("activeProtocolPositions treats undated close events as latest enough to close", () => {
  const events = [
    {
      event: "position_opened",
      status: "open",
      positionId: "p1",
      observedAt: "2026-05-03T10:01:00.000Z",
    },
    {
      event: "position_exit_confirmed",
      status: "closed",
      positionId: "p1",
    },
  ];

  assert.deepEqual(activeProtocolPositions(events), []);
});

test("activeProtocolPositions ignores records missing positionId", () => {
  const events = [
    {
      event: "position_opened",
      status: "open",
      observedAt: "2026-05-03T10:00:00.000Z",
      amountUsd: 99,
    },
    {
      event: "position_opened",
      status: "open",
      positionId: "p1",
      observedAt: "2026-05-03T10:01:00.000Z",
      amountUsd: 5,
    },
  ];

  assert.deepEqual(activeProtocolPositions(events), [events[1]]);
});

test("activeProtocolPositions coalesces repeated entries into one account-level protocol position", () => {
  const events = [
    {
      event: "position_opened",
      status: "open",
      positionId: "entry-1",
      opportunityId: "op",
      chain: "base",
      protocolId: "yo",
      bindingKind: "erc4626_vault_supply_withdraw",
      shareTokenAddress: "0xVault",
      assetAddress: "0xUSDC",
      amountUsd: 5,
      observedAt: "2026-05-03T10:00:00.000Z",
    },
    {
      event: "position_opened",
      status: "open",
      positionId: "entry-2",
      opportunityId: "op",
      chain: "base",
      protocolId: "yo",
      bindingKind: "erc4626_vault_supply_withdraw",
      shareTokenAddress: "0xVault",
      assetAddress: "0xUSDC",
      amountUsd: 7,
      observedAt: "2026-05-03T10:05:00.000Z",
    },
  ];

  const [position] = activeProtocolPositions(events);
  assert.equal(position.positionId, "protocol:base:yo:op:erc4626_vault_supply_withdraw:0xvault");
  assert.equal(position.logicalPositionId, position.positionId);
  assert.deepEqual(position.sourcePositionIds, ["entry-1", "entry-2"]);
  assert.equal(position.sourcePositionCount, 2);
  assert.equal(position.amountUsd, 12);
  assert.equal(position.observedAt, "2026-05-03T10:05:00.000Z");
  assert.equal(position.shareTokenAddress, "0xVault");
});

test("latestProtocolMarksByPosition returns latest mark or failure by positionId", () => {
  const marks = latestProtocolMarksByPosition([
    {
      event: "position_marked",
      positionId: "p1",
      observedAt: "2026-05-03T10:05:00.000Z",
      valueUsd: 5.2,
    },
    {
      event: "position_mark_failed",
      positionId: "p1",
      observedAt: "2026-05-03T10:07:00.000Z",
      failureKind: "rpc_call_failed",
    },
    {
      event: "position_marked",
      observedAt: "2026-05-03T10:08:00.000Z",
      valueUsd: 100,
    },
  ]);

  assert.equal(marks.size, 1);
  assert.equal(marks.get("p1").event, "position_mark_failed");
});

test("mergeProtocolMarksIntoPositions attaches latest mark and mark freshness", () => {
  const positions = [
    { positionId: "p2", opportunityId: "op", chain: "base", protocolId: "yo", amountUsd: 7 },
  ];
  const marks = latestProtocolMarksByPosition([
    {
      event: "position_marked",
      positionId: "p2",
      observedAt: "2026-05-03T10:00:00.000Z",
      valueUsd: 7.01,
    },
    {
      event: "position_marked",
      positionId: "p2",
      observedAt: "2026-05-03T10:03:00.000Z",
      valueUsd: 7.04,
    },
  ]);

  const merged = mergeProtocolMarksIntoPositions(positions, marks);
  assert.equal(merged[0].markUsd, 7.04);
  assert.equal(merged[0].markObservedAt, "2026-05-03T10:03:00.000Z");
  assert.equal(merged[0].markSource, "protocol_position_mark");
});

test("mergeProtocolMarksIntoPositions preserves position when latest success mark has malformed valueUsd", () => {
  const positions = [{ positionId: "p1", valueUsd: 5, currentValueUsd: 5 }];
  const malformed = {
    event: "position_marked",
    positionId: "p1",
    observedAt: "2026-05-03T10:07:00.000Z",
    valueUsd: "not-a-number",
  };
  const marks = latestProtocolMarksByPosition([malformed]);

  const merged = mergeProtocolMarksIntoPositions(positions, marks);
  assert.equal(merged[0].valueUsd, 5);
  assert.equal(merged[0].currentValueUsd, 5);
  assert.equal(merged[0].markUsd, undefined);
  assert.deepEqual(merged[0].markFailure, {
    event: "position_mark_failed",
    positionId: "p1",
    observedAt: "2026-05-03T10:07:00.000Z",
    failureKind: "invalid_mark_value_usd",
    message: "Latest successful protocol position mark has non-finite valueUsd",
    mark: malformed,
  });
});

test("mergeProtocolMarksIntoPositions preserves positions when the latest mark failed", () => {
  const positions = [{ positionId: "p1", valueUsd: 5, currentValueUsd: 5 }];
  const failure = {
    event: "position_mark_failed",
    positionId: "p1",
    observedAt: "2026-05-03T10:07:00.000Z",
    failureKind: "rpc_call_failed",
  };
  const marks = latestProtocolMarksByPosition([
    {
      event: "position_marked",
      positionId: "p1",
      observedAt: "2026-05-03T10:05:00.000Z",
      valueUsd: 5.2,
    },
    failure,
  ]);

  const merged = mergeProtocolMarksIntoPositions(positions, marks);
  assert.equal(merged[0].valueUsd, 5);
  assert.equal(merged[0].currentValueUsd, 5);
  assert.equal(merged[0].markUsd, undefined);
  assert.deepEqual(merged[0].markFailure, failure);
  assert.notEqual(merged[0].markFailure, failure);
});

test("mergeProtocolMarksIntoPositions clones attached successful marks", () => {
  const mark = {
    event: "position_marked",
    positionId: "p1",
    observedAt: "2026-05-03T10:07:00.000Z",
    valueUsd: 5.2,
    valueBtc: 0.00005,
    nested: { adapter: "erc4626" },
  };
  const marks = latestProtocolMarksByPosition([mark]);

  const [merged] = mergeProtocolMarksIntoPositions([{ positionId: "p1" }], marks);
  assert.deepEqual(merged.mark, mark);
  assert.notEqual(merged.mark, mark);
  assert.notEqual(merged.mark.nested, mark.nested);
});

test("mergeProtocolMarksIntoPositions preserves positions without positionId", () => {
  const positions = [{ chain: "base", protocolId: "yo", amountUsd: 7 }];
  const merged = mergeProtocolMarksIntoPositions(positions, new Map());

  assert.deepEqual(merged, positions);
});
