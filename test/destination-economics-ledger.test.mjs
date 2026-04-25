import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationEconomicsLedger } from "../src/strategy/destination-economics-ledger.mjs";

test("destination economics ledger tracks latest observation coverage per template", () => {
  const observations = {
    entries: [
      {
        templateId: "base:stablecoin_lending_carry",
        field: "grossReturnBps",
        value: 120,
        sourceName: "Example Protocol",
        sourceType: "official_docs",
        observedAt: "2026-04-14T12:00:00.000Z",
      },
      {
        templateId: "base:stablecoin_lending_carry",
        field: "depositFeeBps",
        value: 10,
        sourceName: "Example Protocol",
        sourceType: "official_docs",
        observedAt: "2026-04-14T12:01:00.000Z",
      },
    ],
  };

  const workbench = {
    workItems: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        category: "yield",
      },
      {
        templateId: "base:gateway_platform_track",
        chain: "base",
        familyId: "gateway_platform_track",
        label: "Gateway platform track",
        category: "platform",
      },
      {
        templateId: "bsc:wrapped_btc_destination_yield",
        chain: "bsc",
        familyId: "wrapped_btc_destination_yield",
        label: "Wrapped BTC destination yield allocation",
        category: "yield",
      },
    ],
  };

  const report = buildDestinationEconomicsLedger({ observations, workbench });
  assert.equal(report.summary.itemCount, 2);
  assert.equal(report.summary.fullCoverageCount, 0);
  assert.equal(report.summary.partialCoverageCount, 1);
  assert.equal(report.summary.zeroCoverageCount, 1);
  assert.equal(report.items[0].coveredFields.length, 2);
  assert.equal(report.items[0].coveragePct, 0.5);
  assert.equal(report.items[0].sourceCount, 1);
  assert.equal(report.items[0].observedAtCount, 2);
  assert.equal(report.items[0].fieldObservationCounts.grossReturnBps, 1);
  assert.equal(report.items[0].measurementMode, "lending_snapshot");
  assert.equal(report.items[1].measurementMode, "vault_snapshot");
});

test("destination economics ledger keeps blocker metadata alongside uncovered items", () => {
  const report = buildDestinationEconomicsLedger({
    observations: { entries: [] },
    workbench: {
      workItems: [
        {
          templateId: "soneium:wrapped_btc_lending",
          chain: "soneium",
          familyId: "wrapped_btc_lending",
          label: "Wrapped BTC -> lending positions",
          category: "yield",
        },
      ],
    },
    blockers: {
      entries: [
        {
          templateId: "soneium:wrapped_btc_lending",
          blocker: "no_current_destination_venue",
          sourceName: "Official venue checks",
          sourceType: "official_app",
          observedAt: "2026-04-14T21:10:00.000Z",
          note: "No current venue.",
        },
      ],
    },
  });

  assert.equal(report.summary.blockedCount, 1);
  assert.equal(report.items[0].blocker.blocker, "no_current_destination_venue");
  assert.equal(report.items[0].coveragePct, 0);
});
