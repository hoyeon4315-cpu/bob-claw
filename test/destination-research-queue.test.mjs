import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationResearchQueue } from "../src/strategy/destination-research-queue.mjs";

test("destination research queue prioritizes seeded high-score candidates for allowlist review", () => {
  const workbench = {
    workItems: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        category: "yield",
        score: 0.66,
        readinessScore: 0.2,
        overrideStatus: "partially_seeded",
        overfitRisk: "low",
        missingFields: ["allowlistDecision", "grossReturnBps"],
      },
      {
        templateId: "bsc:wrapped_btc_destination_yield",
        chain: "bsc",
        familyId: "wrapped_btc_destination_yield",
        label: "Wrapped BTC destination yield allocation",
        category: "yield",
        score: 0.64,
        readinessScore: 0.1,
        overrideStatus: "empty",
        overfitRisk: "medium",
        missingFields: ["allowlistDecision", "sourceName", "sourceType"],
      },
    ],
  };

  const evidencePolicy = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        unmetPolicyInputs: ["allowlistDecision"],
      },
      {
        templateId: "bsc:wrapped_btc_destination_yield",
        unmetPolicyInputs: ["allowlistDecision", "sourceName"],
      },
    ],
  };

  const economics = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        economicsStatus: "missing_inputs",
      },
      {
        templateId: "bsc:wrapped_btc_destination_yield",
        economicsStatus: "missing_inputs",
      },
    ],
  };

  const report = buildDestinationResearchQueue({ workbench, evidencePolicy, economics });

  assert.equal(report.summary.queueCount, 2);
  assert.equal(report.summary.seededQueueCount, 1);
  assert.equal(report.queue[0].templateId, "base:stablecoin_lending_carry");
  assert.equal(report.queue[0].nextAction, "run_allowlist_review");
  assert.equal(report.queue[1].nextAction, "seed_source_metadata");
});

test("destination research queue defers templates blocked by missing current venue", () => {
  const report = buildDestinationResearchQueue({
    workbench: {
      workItems: [
        {
          templateId: "soneium:wrapped_btc_lending",
          chain: "soneium",
          familyId: "wrapped_btc_lending",
          label: "Wrapped BTC -> lending positions",
          category: "yield",
          score: 0.61,
          readinessScore: 0.2,
          overrideStatus: "partially_seeded",
          overfitRisk: "low",
          missingFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"],
        },
      ],
    },
    evidencePolicy: {
      items: [
        {
          templateId: "soneium:wrapped_btc_lending",
          unmetPolicyInputs: [],
        },
      ],
    },
    economics: {
      items: [
        {
          templateId: "soneium:wrapped_btc_lending",
          economicsStatus: "blocked",
          blockerCode: "no_current_destination_venue",
        },
      ],
    },
  });

  assert.equal(report.queue[0].nextAction, "wait_blocked_destination_venue");
  assert.equal(report.queue[0].reason, "no_current_destination_venue");
});
