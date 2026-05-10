import assert from "node:assert/strict";
import { test } from "node:test";
import {
  featureEnabled,
  scheduleHarvests,
} from "../src/executor/harvest/auto-harvest-scheduler.mjs";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ harvestScheduler: true }), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ harvestScheduler: false }), false);
});

test("scheduleHarvests emits harvest intent for position due", () => {
  const now = "2026-05-12T10:00:00.000Z";
  const positions = [
    {
      strategyId: "test-strat",
      chain: "base",
      protocol: "aerodrome",
      positionId: "pos-1",
      estimatedRewardUsd: 12.5,
      nextHarvestAt: "2026-05-12T09:00:00.000Z",
    },
  ];
  const result = scheduleHarvests({ positions, policy: {}, now });
  assert.equal(result.intents.length, 1);
  assert.equal(result.summary.scheduledCount, 1);
  assert.equal(result.summary.skippedCount, 0);
  const intent = result.intents[0];
  assert.equal(intent.intentType, "harvest");
  assert.equal(intent.strategyId, "test-strat");
  assert.equal(intent.chain, "base");
  assert.equal(intent.protocol, "aerodrome");
  assert.equal(intent.positionId, "pos-1");
  assert.equal(intent.amountUsd, 12.5);
});

test("scheduleHarvests skips position not yet due", () => {
  const now = "2026-05-12T10:00:00.000Z";
  const positions = [
    {
      strategyId: "test-strat",
      chain: "base",
      protocol: "aerodrome",
      positionId: "pos-1",
      estimatedRewardUsd: 12.5,
      nextHarvestAt: "2026-05-12T11:00:00.000Z",
    },
  ];
  const result = scheduleHarvests({ positions, policy: {}, now });
  assert.equal(result.intents.length, 0);
  assert.equal(result.summary.scheduledCount, 0);
  assert.equal(result.summary.skippedCount, 1);
});

test("scheduleHarvests no-op when feature disabled", () => {
  const now = "2026-05-12T10:00:00.000Z";
  const positions = [
    {
      strategyId: "test-strat",
      chain: "base",
      protocol: "aerodrome",
      positionId: "pos-1",
      estimatedRewardUsd: 12.5,
      nextHarvestAt: "2026-05-12T09:00:00.000Z",
    },
  ];
  const result = scheduleHarvests({
    positions,
    policy: { profile: { harvestScheduler: false } },
    now,
  });
  assert.equal(result.intents.length, 0);
  assert.equal(result.summary.scheduledCount, 0);
});
