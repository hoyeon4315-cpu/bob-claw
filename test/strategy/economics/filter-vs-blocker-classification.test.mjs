import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyFloorFeasibility } from "../../../src/strategy/economics/floor-feasibility-classifier.mjs";

test("floor feasibility marks current-capital mismatch as filter metadata", () => {
  const [row] = classifyFloorFeasibility({
    snapshots: [{
      strategyId: "stablecoin_spread_loop",
      chain: "base",
      measuredEdgeBpsPerDay: 100,
      measuredRoundTripCostUsd: 1,
      varianceFloorUsd: 0.1,
      observedNotionalUsd: 0,
      evidenceClass: "receipt",
    }],
    minViableByStrategy: {
      stablecoin_spread_loop: {
        minNotionalUsd: 50,
        reason: "ok",
      },
    },
    treasury: {
      freeCapitalUsd: 10,
      sources: [{ chain: "base", asset: "USDC", freeUsd: 10 }],
    },
    strategyCapsById: {
      stablecoin_spread_loop: {
        caps: {
          perTxUsd: 30,
          perChainUsd: { base: 100 },
        },
      },
    },
  });

  assert.equal(row.classification, "needs_capital_acquisition");
  assert.equal(row.isFilter, true);
  assert.equal(row.filterCode, "filter:capital_mismatch");
  assert.equal(row.blockerCode, null);
  assert.equal(row.capitalDeltaNeededUsd, 50);
});
