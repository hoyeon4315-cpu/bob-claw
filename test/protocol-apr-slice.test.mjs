import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProtocolAprSlice } from "../src/status/protocol-apr-slice.mjs";

test("protocol APR slice builds exact strategy APR entries from wrapped BTC loop slices", () => {
  const slice = buildProtocolAprSlice({
    wrappedBtcLoopSlice: {
      generatedAt: "2026-04-27T04:05:38.735Z",
      strategy: {
        id: "wrapped-btc-loop-base-moonwell",
        protocol: "moonwell",
        chain: "base",
      },
      marketAssumptions: {
        supplyAprBps: 240,
        borrowAprBps: 130,
      },
    },
    recursiveWrappedBtcLoopScaffold: {
      generatedAt: "2026-04-27T04:06:38.735Z",
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        protocol: "moonwell",
        chain: "base",
      },
      marketAssumptions: {
        supplyAprBps: 240,
        borrowAprBps: 130,
      },
    },
  });

  assert.deepEqual(slice["wrapped-btc-loop-base-moonwell"], {
    strategyId: "wrapped-btc-loop-base-moonwell",
    protocol: "moonwell",
    chain: "base",
    source: "strategy_market_assumptions",
    observedAt: "2026-04-27T04:05:38.735Z",
    supplyApyPct: 2.4,
    borrowApyPct: 1.3,
    netApyPct: 1.1,
  });
  assert.deepEqual(slice.recursive_wrapped_btc_lending_loop, {
    strategyId: "recursive_wrapped_btc_lending_loop",
    protocol: "moonwell",
    chain: "base",
    source: "strategy_market_assumptions",
    observedAt: "2026-04-27T04:06:38.735Z",
    supplyApyPct: 2.4,
    borrowApyPct: 1.3,
    netApyPct: 1.1,
  });
});
