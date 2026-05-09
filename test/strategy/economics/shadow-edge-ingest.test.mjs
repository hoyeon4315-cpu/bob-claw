import assert from "node:assert/strict";
import { test } from "node:test";
import { buildShadowEdgeRecords } from "../../../src/strategy/economics/shadow-edge-ingest.mjs";

test("shadow edge ingest derives haircut-ready strategy economics from simulation runs", () => {
  const records = buildShadowEdgeRecords({
    simulationRuns: [
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        chain: "base",
        family: "btc_wrappers",
        status: "simulated_ok",
        observedAt: "2026-05-09T01:00:00.000Z",
        notionalUsd: 100,
        netEdgeUsd: 0.2,
        estimatedGasUsd: 0.05,
      },
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        chain: "base",
        family: "btc_wrappers",
        status: "simulated_ok",
        observedAt: "2026-05-09T01:05:00.000Z",
        notionalUsd: 100,
        executableNetEdgeUsd: 0.1,
        estimatedGasUsd: 0.07,
      },
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        chain: "base",
        family: "btc_wrappers",
        status: "simulation_failed",
        observedAt: "2026-05-09T01:10:00.000Z",
        notionalUsd: 100,
        netEdgeUsd: 10,
        estimatedGasUsd: 9,
      },
    ],
  });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    strategyId: "recursive_wrapped_btc_lending_loop",
    chain: "base",
    family: "btc_wrappers",
    evidenceClass: "shadow",
    estimatedEdgeBpsPerDay: 15,
    estimatedRoundTripCostUsd: 0.07,
    sampleCount: 2,
    lastSimAt: "2026-05-09T01:05:00.000Z",
    confidence: 0.5,
  });
});

test("shadow edge ingest skips records without strategy or notional evidence", () => {
  const records = buildShadowEdgeRecords({
    simulationRuns: [
      { status: "simulated_ok", chain: "base", netEdgeUsd: 1, notionalUsd: 10 },
      { status: "simulated_ok", strategyId: "s1", chain: "base", netEdgeUsd: 1 },
    ],
  });
  assert.deepEqual(records, []);
});
