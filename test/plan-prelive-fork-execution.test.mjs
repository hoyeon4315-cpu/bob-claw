import assert from "node:assert/strict";
import { test } from "node:test";

import { mergePlans } from "../src/cli/plan-prelive-fork-execution.mjs";

test("mergePlans preserves existing fork plans for other routes while replacing same selection", () => {
  const existing = {
    source: "objective",
    selectedCount: 1,
    plans: [
      {
        planId: "exact-1",
        routeKey: "avalanche:wbtc->soneium:wbtc",
        amount: "10000",
        selectionSource: "exact_route",
      },
      {
        planId: "queue-1",
        routeKey: "unichain:wbtc->sonic:wbtx",
        amount: "10000",
        selectionSource: "queue",
      },
    ],
  };
  const next = {
    source: "objective",
    selectedCount: 1,
    plans: [
      {
        planId: "queue-2",
        routeKey: "unichain:wbtc->sonic:wbtx",
        amount: "10000",
        selectionSource: "queue",
      },
    ],
  };

  const merged = mergePlans(existing, next);
  assert.equal(merged.source, "objective");
  assert.equal(merged.selectedCount, 2);
  assert.deepEqual(
    merged.plans.map((plan) => plan.planId),
    ["queue-2", "exact-1"],
  );
});

test("mergePlans marks mixed sources when exact-route and objective plans coexist", () => {
  const existing = {
    source: "exact_route",
    selectedCount: 1,
    plans: [{ planId: "exact-1", routeKey: "a", amount: "1", selectionSource: "exact_route" }],
  };
  const next = {
    source: "objective",
    selectedCount: 1,
    plans: [{ planId: "queue-1", routeKey: "b", amount: "1", selectionSource: "queue" }],
  };

  const merged = mergePlans(existing, next);
  assert.equal(merged.source, "mixed");
  assert.equal(merged.selectedCount, 2);
});
