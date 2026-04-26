import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStrategyParitySlice } from "../src/status/strategy-parity-slice.mjs";

test("strategy parity carries tick timing and allocation through to dashboard rows", () => {
  const slice = buildStrategyParitySlice({
    strategyTickStatus: {
      strategies: [
        {
          strategyId: "wrapped-btc-loop-base-moonwell",
          lastTickAt: "2026-04-24T20:34:49.307Z",
          lastTickMode: "live_candidate",
          lastTickBlockers: [],
          receiptCountTotal: 3,
          receiptCountSignerBacked: 2,
          scoredAllocation: {
            strategyId: "wrapped-btc-loop-base-moonwell",
            chain: "base",
            protocol: "moonwell",
            allocatedSats: 499999,
            score: 0.905,
          },
        },
      ],
      strategyStage: {
        byStrategy: {
          "wrapped-btc-loop-base-moonwell": {
            promotionVerdict: "live_ready",
            topBlocker: null,
          },
        },
      },
      microCanary: {
        byStrategy: {},
      },
    },
  });

  assert.equal(
    slice.byStrategy["wrapped-btc-loop-base-moonwell"].lastTickAt,
    "2026-04-24T20:34:49.307Z",
  );
  assert.deepEqual(
    slice.byStrategy["wrapped-btc-loop-base-moonwell"].scoredAllocation,
    {
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
      protocol: "moonwell",
      allocatedSats: 499999,
      score: 0.905,
    },
  );
  assert.equal(slice.byStrategy["wrapped-btc-loop-base-moonwell"].promotionVerdict, "live_ready");
});
