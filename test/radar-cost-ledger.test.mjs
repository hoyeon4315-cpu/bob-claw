import assert from "node:assert/strict";
import test from "node:test";

import { buildRadarCostLedger } from "../src/strategy/radar/cost-ledger.mjs";

test("buildRadarCostLedger returns sparse-sample buffered p90 costs by route and chain", () => {
  const ledger = buildRadarCostLedger({
    auditRecords: [
      {
        chain: "base",
        intent: {
          entryRoute: "base:moonwell",
          protocol: "moonwell",
          rewardToken: "USDC",
        },
        realized: {
          bridgeCostUsd: 0.1,
          gasCostUsd: 0.2,
          claimCostUsd: 0.3,
          rewardSwapCostUsd: 0.4,
        },
      },
      {
        chain: "base",
        intent: {
          entryRoute: "base:moonwell",
          protocol: "moonwell",
          rewardToken: "USDC",
        },
        realized: {
          bridgeCostUsd: 0.2,
          gasCostUsd: 0.4,
          claimCostUsd: 0.6,
          rewardSwapCostUsd: 0.8,
        },
      },
    ],
  });

  assert.equal(ledger.p90BridgeCostUsdForRoute("base:moonwell"), 0.3);
  assert.equal(ledger.p90GasCostUsdForChain("base"), 0.6);
  assert.equal(ledger.p90ClaimCostUsdForProtocol("moonwell"), 0.9);
  assert.equal(ledger.p90RewardSwapCostUsdForToken("USDC"), 1.2);
});

test("buildRadarCostLedger defers gas fallback when no chain samples exist", () => {
  const ledger = buildRadarCostLedger({ auditRecords: [] });

  assert.equal(ledger.p90BridgeCostUsdForRoute("unknown"), 0);
  assert.equal(ledger.p90GasCostUsdForChain("base"), null);
  assert.equal(ledger.p90ClaimCostUsdForProtocol("moonwell"), 0.2);
  assert.equal(ledger.p90RewardSwapCostUsdForToken("TOKEN"), 0.3);
});
