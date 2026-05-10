import assert from "node:assert/strict";
import { test } from "node:test";

import { clearPortfolioCache, fetchRealtimePortfolio } from "../src/executor/realtime-portfolio.mjs";

test("realtime portfolio exposes protocol reader failures instead of silently skipping", async () => {
  clearPortfolioCache();
  const snapshot = await fetchRealtimePortfolio("0x0000000000000000000000000000000000000001", {
    chains: [],
    useCache: false,
    includeProtocols: true,
    aerodromeTokenEnumeratorImpl: async () => [],
    protocolReadersImpl: {
      moonwell: async () => {
        throw new Error("moonwell rpc failed");
      },
      yoProtocol: async () => [{
        chain: "base",
        protocol: "yo",
        symbol: "yoUSD",
        allocatedUsd: 1,
      }],
      aerodrome: async () => [],
    },
  });

  assert.equal(snapshot.protocolPositions.length, 1);
  assert.equal(snapshot.protocolReadErrors.length, 1);
  assert.equal(snapshot.protocolReadErrors[0].protocol, "moonwell");
  assert.equal(snapshot.summary.protocolReadErrorCount, 1);
});
