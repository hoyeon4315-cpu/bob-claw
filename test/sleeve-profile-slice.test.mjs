import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSleeveProfileSlice } from "../src/status/sleeve-profile-slice.mjs";

test("sleeve profile slice exposes committed profile fields and resolved cap matrix", () => {
  const slice = buildSleeveProfileSlice({
    generatedAt: "2026-05-05T00:00:00.000Z",
    strategies: [
      {
        strategyId: "example",
        autoExecute: true,
        exposure: {
          btcDenominated: false,
        },
        caps: {
          perTxUsd: 500,
          perDayUsd: 1_000,
          tinyLivePerTxUsd: 250,
          perChainUsd: {
            base: 900,
          },
        },
      },
    ],
  });

  assert.equal(slice.schemaVersion, 1);
  assert.equal(slice.generatedAt, "2026-05-05T00:00:00.000Z");
  assert.equal(slice.activeProfile, "smallCapital_v1");
  assert.deepEqual(slice.anchorPct, { min: 0.55, max: 0.70 });
  assert.equal(slice.opportunisticPct, 0.30);
  assert.equal(slice.microTestPct, 0.10);
  assert.equal(slice.btcFloorPct, 0.20);
  assert.equal(slice.perProtocolMaxPct, 0.25);
  assert.equal(slice.perChainMaxPct, 0.35);
  assert.equal(slice.resolvedStrategyCapMatrix.length, 1);
  assert.equal(slice.resolvedStrategyCapMatrix[0].strategyId, "example");
  assert.equal(slice.resolvedStrategyCapMatrix[0].resolvedCaps.perTxUsd, 150);
});
