import assert from "node:assert/strict";
import { test } from "node:test";
import { observationClearsRequiredEdge, summarizeQuoteDecay } from "../src/shadow/quote-decay.mjs";

test("quote decay summary tracks coverage and survival by window", () => {
  const summary = summarizeQuoteDecay([
    {
      observedAt: "2026-04-10T00:00:00.000Z",
      routeKey: "bob:wbtc->base:wbtc",
      amount: "10000",
      observedEdgePct: 0.012,
      requiredEdgePct: 0.01,
    },
    {
      observedAt: "2026-04-10T00:00:08.000Z",
      routeKey: "bob:wbtc->base:wbtc",
      amount: "10000",
      observedEdgePct: 0.011,
      requiredEdgePct: 0.01,
    },
    {
      observedAt: "2026-04-10T00:00:18.000Z",
      routeKey: "bob:wbtc->base:wbtc",
      amount: "10000",
      observedEdgePct: 0.009,
      requiredEdgePct: 0.01,
    },
  ]);

  assert.equal(summary.coveredGroups, 1);
  assert.deepEqual(
    summary.windows.map((item) => ({
      windowSeconds: item.windowSeconds,
      coveredGroups: item.coveredGroups,
      profitableStartGroups: item.profitableStartGroups,
      survivedGroups: item.survivedGroups,
    })),
    [
      { windowSeconds: 5, coveredGroups: 1, profitableStartGroups: 1, survivedGroups: 1 },
      { windowSeconds: 15, coveredGroups: 1, profitableStartGroups: 1, survivedGroups: 0 },
      { windowSeconds: 30, coveredGroups: 0, profitableStartGroups: 0, survivedGroups: 0 },
      { windowSeconds: 60, coveredGroups: 0, profitableStartGroups: 0, survivedGroups: 0 },
    ],
  );
});

test("quote decay edge evaluation falls back to positive usd edge", () => {
  assert.equal(observationClearsRequiredEdge({ observedEdgeUsd: 0.01 }), true);
  assert.equal(observationClearsRequiredEdge({ observedEdgeUsd: -0.01 }), false);
});
