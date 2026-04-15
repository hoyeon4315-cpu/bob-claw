import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationEstimatedEconomics } from "../src/strategy/destination-estimated-economics.mjs";

test("destination estimated economics computes policy pass when required inputs exist", () => {
  const workbench = {
    workItems: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        category: "yield",
        score: 0.66,
        values: {
          grossReturnBps: 120,
          depositFeeBps: 10,
          withdrawFeeBps: 10,
          unwindSlippageBps: 20,
          minPositionUsd: 100,
        },
      },
      {
        templateId: "bsc:wrapped_btc_destination_yield",
        chain: "bsc",
        familyId: "wrapped_btc_destination_yield",
        label: "Wrapped BTC destination yield allocation",
        category: "yield",
        score: 0.64,
        values: {
          grossReturnBps: null,
          depositFeeBps: null,
          withdrawFeeBps: null,
          unwindSlippageBps: null,
        },
      },
      {
        templateId: "base:custom_destination_actions",
        chain: "base",
        familyId: "custom_destination_actions",
        label: "Gateway custom destination actions",
        category: "platform",
        score: 0.59,
        values: {},
      },
    ],
  };

  const report = buildDestinationEstimatedEconomics({ workbench });
  const estimated = report.items.find((item) => item.templateId === "base:stablecoin_lending_carry");
  const missing = report.items.find((item) => item.templateId === "bsc:wrapped_btc_destination_yield");
  const platform = report.items.find((item) => item.templateId === "base:custom_destination_actions");

  assert.equal(estimated.economicsStatus, "estimated");
  assert.equal(estimated.activeBudgetEstimate.estimatedNetBps, 80);
  assert.equal(estimated.activeBudgetEstimate.passesPolicy, true);
  assert.equal(missing.economicsStatus, "missing_inputs");
  assert.equal(platform.economicsStatus, "non_numeric_track");
  assert.equal(report.summary.estimatedCount, 1);
  assert.equal(report.summary.activeBudgetPolicyPassCount, 1);
});

test("destination estimated economics can mark a template as blocked by no-current-venue evidence", () => {
  const workbench = {
    workItems: [
      {
        templateId: "soneium:wrapped_btc_lending",
        chain: "soneium",
        familyId: "wrapped_btc_lending",
        label: "Wrapped BTC -> lending positions",
        category: "yield",
        score: 0.61,
        values: {
          grossReturnBps: null,
          depositFeeBps: null,
          withdrawFeeBps: null,
          unwindSlippageBps: null,
        },
      },
    ],
  };

  const blockers = {
    entries: [
      {
        templateId: "soneium:wrapped_btc_lending",
        blocker: "no_current_destination_venue",
        sourceName: "Official venue checks",
        sourceType: "official_app",
        observedAt: "2026-04-14T21:10:00.000Z",
        note: "No current official wrapped-BTC lending venue is listed on Soneium mainnet.",
      },
    ],
  };

  const report = buildDestinationEstimatedEconomics({ workbench, blockers });
  assert.equal(report.summary.blockedCount, 1);
  assert.equal(report.summary.missingInputsCount, 0);
  assert.equal(report.items[0].economicsStatus, "blocked");
  assert.equal(report.items[0].blockerCode, "no_current_destination_venue");
  assert.equal(report.items[0].activeBudgetEstimate, null);
});
