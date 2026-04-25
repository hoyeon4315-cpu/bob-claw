import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationEconomicsQueue } from "../src/strategy/destination-economics-queue.mjs";

test("destination economics queue prioritizes high-score missing-input items", () => {
  const economics = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        category: "yield",
        score: 0.66,
        economicsStatus: "missing_inputs",
        missingEconomicFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps"],
      },
      {
        templateId: "bsc:wrapped_btc_lending",
        chain: "bsc",
        familyId: "wrapped_btc_lending",
        label: "Wrapped BTC -> lending positions",
        category: "yield",
        score: 0.6375,
        economicsStatus: "missing_inputs",
        missingEconomicFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps"],
      },
      {
        templateId: "base:custom_destination_actions",
        chain: "base",
        familyId: "custom_destination_actions",
        label: "Gateway custom destination actions",
        category: "platform",
        score: 0.59,
        economicsStatus: "non_numeric_track",
        missingEconomicFields: [],
      },
    ],
  };

  const researchQueue = {
    queue: [
      {
        templateId: "base:stablecoin_lending_carry",
        nextAction: "measure_numeric_economics",
        reason: "economic_inputs_missing",
      },
      {
        templateId: "bsc:wrapped_btc_lending",
        nextAction: "run_allowlist_review",
        reason: "allowlist_missing",
      },
    ],
  };

  const report = buildDestinationEconomicsQueue({ economics, researchQueue });
  assert.equal(report.summary.queueCount, 2);
  assert.equal(report.summary.topMissingFields[0].field, "depositFeeBps");
  assert.equal(report.summary.topQueue[0].templateId, "base:stablecoin_lending_carry");
  assert.equal(report.summary.topQueue[0].nextResearchAction, "measure_numeric_economics");
  assert.equal(report.summary.topQueue[1].nextResearchAction, "run_allowlist_review");
});
