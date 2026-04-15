import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationInputWorkbench } from "../src/strategy/destination-input-workbench.mjs";

test("destination input workbench merges overrides and prioritizes high-score missing work", () => {
  const admissionChecklist = {
    chains: [
      {
        templates: [
          {
            templateId: "base:stablecoin_lending_carry",
            chain: "base",
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            category: "yield",
            gateStatus: "research_only",
            overfitRisk: "low",
            scoring: { deploymentPriorityScore: 0.66 },
            nextAction: "complete venue scoring",
            notes: [],
            defaults: {
              allowlistDecision: null,
              grossReturnBps: null,
              sourceName: null,
              sourceType: null,
              lastVerifiedAt: null,
            },
            admission: {
              requiredFields: ["allowlistDecision", "grossReturnBps", "sourceName", "sourceType", "lastVerifiedAt"],
            },
          },
          {
            templateId: "bsc:wrapped_btc_destination_yield",
            chain: "bsc",
            familyId: "wrapped_btc_destination_yield",
            label: "Wrapped BTC destination yield allocation",
            category: "yield",
            gateStatus: "research_only",
            overfitRisk: "medium",
            scoring: { deploymentPriorityScore: 0.64 },
            nextAction: "complete venue scoring",
            notes: [],
            defaults: {
              allowlistDecision: null,
              grossReturnBps: null,
              sourceName: null,
              sourceType: null,
              lastVerifiedAt: null,
            },
            admission: {
              requiredFields: ["allowlistDecision", "grossReturnBps", "sourceName", "sourceType", "lastVerifiedAt"],
            },
          },
        ],
      },
    ],
  };

  const overrides = {
    entries: [
      {
        templateId: "base:stablecoin_lending_carry",
        values: {
          sourceName: "Example protocol",
          sourceType: "official_docs",
        },
      },
    ],
  };

  const report = buildDestinationInputWorkbench({ admissionChecklist, overrides });

  assert.equal(report.summary.workItemCount, 2);
  assert.equal(report.summary.seededCount, 1);
  assert.equal(report.summary.emptyCount, 1);
  assert.equal(report.workItems[0].templateId, "base:stablecoin_lending_carry");
  assert.equal(report.workItems[0].overrideStatus, "partially_seeded");
  assert.equal(report.workItems[0].values.sourceName, "Example protocol");
  assert.equal(report.workItems[0].missingFields.includes("grossReturnBps"), true);
});
