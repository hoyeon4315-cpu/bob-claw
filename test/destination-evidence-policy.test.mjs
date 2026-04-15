import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationEvidencePolicy } from "../src/strategy/destination-evidence-policy.mjs";

test("destination evidence policy assigns stricter checks to arbitrage than yield", () => {
  const workbench = {
    workItems: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        category: "yield",
        score: 0.66,
        overfitRisk: "low",
        values: {
          allowlistDecision: null,
          sourceName: null,
          sourceType: null,
          lastVerifiedAt: null,
          unwindSlippageBps: null,
          withdrawalDelayHours: null,
        },
      },
      {
        templateId: "base:btc_proxy_spread_rebalance",
        chain: "base",
        familyId: "btc_proxy_spread_rebalance",
        label: "Wrapped BTC proxy spread rebalance",
        category: "arbitrage",
        score: 0.18,
        overfitRisk: "high",
        values: {
          allowlistDecision: null,
          sourceName: null,
          sourceType: null,
          lastVerifiedAt: null,
          unwindSlippageBps: null,
        },
      },
    ],
  };

  const report = buildDestinationEvidencePolicy({ workbench });
  const yieldItem = report.items.find((item) => item.familyId === "stablecoin_lending_carry");
  const arbItem = report.items.find((item) => item.familyId === "btc_proxy_spread_rebalance");

  assert.equal(yieldItem.policy.minIndependentChecks, 3);
  assert.equal(arbItem.policy.minIndependentChecks, 30);
  assert.equal(report.summary.strictestFamilies[0].familyId, "btc_proxy_spread_rebalance");
  assert.equal(report.summary.inputsMissingCount, 2);
});
