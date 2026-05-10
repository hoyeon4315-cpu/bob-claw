import assert from "node:assert/strict";
import { test } from "node:test";
import { runHarvestCycle } from "../src/cli/run-harvest-cycle.mjs";

test("runHarvestCycle dry-run outputs intents without enqueuing", async () => {
  let enqueued = 0;
  const result = await runHarvestCycle({
    positions: [
      {
        strategyId: "test-strat",
        chain: "base",
        protocol: "aerodrome",
        positionId: "pos-1",
        estimatedRewardUsd: 12.5,
        nextHarvestAt: "2026-05-12T09:00:00.000Z",
        rewardToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        baseToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      },
    ],
    dryRun: true,
    now: "2026-05-12T10:00:00.000Z",
    enqueueImpl: async () => {
      enqueued++;
      return { status: "approved" };
    },
  });
  assert.equal(result.dryRun, true);
  assert.ok(Array.isArray(result.intents));
  assert.ok(result.intents.length > 0);
  assert.equal(enqueued, 0);
  assert.ok(result.summary);
});

test("runHarvestCycle no-op when all features disabled", async () => {
  const result = await runHarvestCycle({
    positions: [],
    dryRun: true,
    now: "2026-05-12T10:00:00.000Z",
    profile: {
      harvestScheduler: false,
      autoConvert: false,
      autoCompound: false,
    },
  });
  assert.equal(result.intents.length, 0);
});
