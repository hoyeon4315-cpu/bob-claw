import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyDispatchPlanningBridge } from "../src/session/strategy-dispatch-planning-bridge.mjs";

test("strategy dispatch planning bridge stays planning-only while exposing top candidates", () => {
  const bridge = buildStrategyDispatchPlanningBridge({
    autonomousDiscoveryBoard: {
      generatedAt: "2026-04-26T00:00:00.000Z",
      summary: {
        opportunityCount: 2,
        readyNowCount: 1,
      },
      opportunities: [
        {
          id: "wrapped-btc-loop-base-moonwell",
          label: "Wrapped BTC loop",
          type: "deterministic_strategy",
          lane: "strategy",
          status: "receipt_backed_validation_ready",
          selectionScore: 0.91,
          researchLoop: { recommendedDecision: "keep" },
          nextAction: { code: "review_live_receipts" },
        },
        {
          id: "base:stablecoin_lending_carry",
          label: "Base lending carry",
          type: "destination_candidate",
          lane: "destination",
          status: "allocation_ready",
          priorityScore: 0.88,
          researchLoop: { recommendedDecision: "keep" },
          nextAction: { code: "review_destination_allocation_plan" },
        },
      ],
    },
    executionSurfaces: {
      strategies: [
        {
          id: "wrapped-btc-loop-base-moonwell",
          selectedMode: "live",
          currentLiveEligible: true,
        },
      ],
    },
  });

  assert.equal(bridge.authority, "planning_only");
  assert.equal(bridge.dispatchAuthority, "strategy_execution_surfaces_and_runtime_guards_only");
  assert.equal(bridge.topCandidateId, "wrapped-btc-loop-base-moonwell");
  assert.deepEqual(bridge.liveEligibleStrategyIds, ["wrapped-btc-loop-base-moonwell"]);
  assert.equal(bridge.candidates[0].matchedExecutionSurfaceId, "wrapped-btc-loop-base-moonwell");
  assert.equal(bridge.candidates[0].matchedLiveEligibility, true);
  assert.equal(bridge.candidates[1].matchedExecutionSurfaceId, null);
});
