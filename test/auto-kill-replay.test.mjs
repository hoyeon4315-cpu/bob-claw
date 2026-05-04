import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAutoKillReplayStatus,
  buildClStatusFromAnchorHealth,
  deriveActiveProtocols,
} from "../src/risk/auto-kill-replay.mjs";

test("auto-kill replay marks an armed kill-switch as stale when current triggers are clear", () => {
  const replay = buildAutoKillReplayStatus({
    auditRecords: [],
    executorRuntime: {
      observedAt: "2026-05-05T00:00:00.000Z",
      killSwitch: {
        halted: true,
        activeReason: "auto_kill:failure_burst_per_strategy",
      },
    },
    activeProtocolsPayload: { protocols: [] },
    campaignStatusPayload: {},
    priceSamplesPayload: { samples: [] },
    oraclePayload: { samples: [] },
    anchorHealthPayload: { positions: [] },
    operatingCapitalUsd: 100,
    now: "2026-05-05T00:00:30.000Z",
  });

  assert.equal(replay.armed, true);
  assert.equal(replay.triggered, false);
  assert.equal(replay.staleArm, true);
  assert.deepEqual(replay.activeTriggerNames, ["failure_burst_per_strategy"]);
});

test("auto-kill replay keeps an armed kill-switch active when triggers still fire", () => {
  const replay = buildAutoKillReplayStatus({
    auditRecords: [
      {
        timestamp: "2026-05-05T00:00:30.000Z",
        strategyId: "alpha",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        timestamp: "2026-05-05T00:00:40.000Z",
        strategyId: "alpha",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        timestamp: "2026-05-05T00:00:50.000Z",
        strategyId: "alpha",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        timestamp: "2026-05-05T00:00:55.000Z",
        strategyId: "alpha",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
      {
        timestamp: "2026-05-05T00:00:58.000Z",
        strategyId: "alpha",
        policyVerdict: "errored",
        lifecycle: { stage: "error" },
      },
    ],
    executorRuntime: {
      observedAt: "2026-05-05T00:01:00.000Z",
      killSwitch: {
        halted: true,
        activeReason: "auto_kill:failure_burst_per_strategy",
      },
    },
    activeProtocolsPayload: { protocols: [] },
    campaignStatusPayload: {},
    priceSamplesPayload: { samples: [] },
    oraclePayload: { samples: [] },
    anchorHealthPayload: { positions: [] },
    operatingCapitalUsd: 100,
    now: "2026-05-05T00:01:00.000Z",
  });

  assert.equal(replay.triggered, true);
  assert.equal(replay.staleArm, false);
  assert.equal(replay.matchingActiveTrigger, true);
  assert.equal(replay.triggerNames.includes("failure_burst_per_strategy"), true);
});

test("auto-kill replay helper derives CL status and active protocols consistently", () => {
  const clStatus = buildClStatusFromAnchorHealth({
    positions: [
      { timeInRange: 70, health: { ilExceedsFeesHours: 5 } },
      { timeInRange: "80%", ilExceedsFeesHours: 3 },
    ],
  });
  const protocols = deriveActiveProtocols(null, {
    positions: [{ protocol: "aerodrome" }],
  });

  assert.equal(clStatus.timeInRangePct24h, 0.75);
  assert.equal(clStatus.ilExceedsFeesHours, 5);
  assert.deepEqual(protocols, ["aerodrome"]);
});
