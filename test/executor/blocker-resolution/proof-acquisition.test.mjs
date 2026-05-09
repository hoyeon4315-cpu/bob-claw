import assert from "node:assert/strict";
import { test } from "node:test";
import { planProofAcquisition } from "../../../src/executor/blocker-resolution/proof-acquisition.mjs";

test("proof acquisition planner surfaces ROI, deposit needs, and does not increment skipped attempts", async () => {
  const plan = await planProofAcquisition({
    strategyId: "s1",
    code: "economic_no_go:capital_too_small",
    params: { requiredUsd: 20, availableUsd: 3, expectedDailyUsdOnResolve: 1.5 },
    paramsKey: "key1",
    observedAt: "2026-05-09T00:00:00.000Z",
    context: {},
    attemptCount: 2,
    mode: "preview",
  });
  assert.equal(plan.status, "proof_not_applicable");
  assert.equal(plan.attemptCountUpdate, "unchanged");
  assert.equal(plan.requiresExternalDeposit, true);
  assert.equal(plan.expectedDailyUsdOnResolve, 1.5);
});

test("operational planner marks enqueue as pending receipt instead of success", async () => {
  const plan = await planProofAcquisition({
    strategyId: "s1",
    code: "refill_or_inventory:chain_under_target",
    params: { strategyId: "s1", chain: "base", shortfallUsd: 8 },
    paramsKey: "key2",
    observedAt: "2026-05-09T00:00:00.000Z",
    context: { readyForLiveBroadcast: true },
    attemptCount: 0,
    mode: "execute",
    executeAction: async () => ({ ok: true, enqueued: true }),
  });
  assert.equal(plan.status, "pending_receipt");
  assert.equal(plan.attemptCountUpdate, "unchanged");
  assert.equal(plan.actions[0].intentHash.length, 16);
});
