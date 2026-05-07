import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationAllowlistBoard } from "../src/strategy/destination-allowlist-board.mjs";

test("destination allowlist board surfaces candidate, policy review, and blocked items", () => {
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
        overrideStatus: "partially_seeded",
        values: {
          sourceName: "BOB Gateway Overview",
          sourceType: "official_docs",
          lastVerifiedAt: "2026-04-14",
        },
      },
      {
        templateId: "base:custom_destination_actions",
        chain: "base",
        familyId: "custom_destination_actions",
        label: "Gateway custom destination actions",
        category: "platform",
        score: 0.59,
        overfitRisk: "low",
        overrideStatus: "partially_seeded",
        values: {
          sourceName: "BOB Gateway Overview",
          sourceType: "official_docs",
          lastVerifiedAt: "2026-04-14",
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
        overrideStatus: "empty",
        values: {},
      },
    ],
  };

  const researchQueue = {
    queue: [
      {
        templateId: "base:stablecoin_lending_carry",
        nextAction: "run_allowlist_review",
      },
      {
        templateId: "base:custom_destination_actions",
        nextAction: "document_platform_surface",
      },
      {
        templateId: "base:btc_proxy_spread_rebalance",
        nextAction: "hold",
      },
    ],
  };

  const report = buildDestinationAllowlistBoard({ workbench, researchQueue });

  assert.equal(report.summary.candidateCount, 1);
  assert.equal(report.summary.contractPolicyReviewCount, 1);
  assert.equal(report.summary.blockedByRiskCount, 1);
  assert.equal(report.summary.topReviewTargets[0].familyId, "stablecoin_lending_carry");
});
