import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildShadowOpportunityObservation,
  shouldPersistShadowObservation,
} from "../src/shadow/opportunity-observation.mjs";

test("shadow opportunity observation is always non-tradeable and carries reason codes", () => {
  const observation = buildShadowOpportunityObservation({
    score: {
      observedAt: "2026-04-11T07:00:00.000Z",
      routeKey: "bob:0x1->base:0x1",
      amount: "10000",
      srcChain: "bob",
      dstChain: "base",
      quoteType: "layerZero",
      tradeReadiness: "reject_no_net_edge",
      dataGaps: ["exact_src_execution_gas_not_estimated"],
      treasuryAdjustedExecutableNetEdgeUsd: -0.04,
      treasuryAdjustedExecutableNetEdgePct: -0.004,
      treasuryAdjustedBreakEvenPct: 0.01,
      netEdgeUsd: 0.02,
      executableNetEdgeUsd: -0.01,
      effectiveSystemNetPnlUsd: -0.06,
      inputUsd: 10,
      outputUsd: 10.02,
      routeStats: { failureRate: 0.08 },
      gasSnapshotAgeMinutes: 2,
      latencyMs: 180,
      estimatedTimeInSecs: 45,
      dex: { provider: "odos", ageMinutes: 1 },
      treasuryExecutionRefillCostUsd: 0.03,
      treasuryReserveReplenishmentCostUsd: null,
    },
    fundingSourcePlan: {
      decision: "REVIEW_REFILL_PLAN",
      reasons: ["reserve_replenishment_unmodelled"],
    },
    now: "2026-04-11T07:05:00.000Z",
    priceObservedAt: "2026-04-11T07:01:00.000Z",
    inventoryObservedAt: "2026-04-11T07:02:00.000Z",
  });

  assert.equal(observation.tradeable, false);
  assert.equal(observation.requiredEdgePct, 0.01);
  assert.equal(observation.observedEdgeUsd, -0.04);
  assert.equal(observation.rejectionReasons.includes("reject_no_net_edge"), true);
  assert.equal(observation.rejectionReasons.includes("reject_treasury_execution_refill_cost"), true);
  assert.equal(observation.rejectionReasons.includes("treasury_reserve_replenishment_unmodelled"), true);
});

test("shadow opportunity observations skip unchanged rewrites inside the recent window", () => {
  const previous = {
    observedAt: "2026-04-11T07:00:00.000Z",
    routeKey: "bob:0x1->base:0x1",
    amount: "10000",
    tradeable: false,
    rejectionReasons: ["reject_no_net_edge"],
  };
  const recentSame = {
    ...previous,
    observedAt: "2026-04-11T07:10:00.000Z",
  };
  const staleSame = {
    ...previous,
    observedAt: "2026-04-11T07:20:00.000Z",
  };

  assert.deepEqual(shouldPersistShadowObservation(previous, recentSame), {
    shouldPersist: false,
    reason: "recently_unchanged",
  });
  assert.deepEqual(shouldPersistShadowObservation(previous, staleSame), {
    shouldPersist: true,
    reason: "stale_rollover",
  });
});
