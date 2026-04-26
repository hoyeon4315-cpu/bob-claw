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

test("destination economics ledger carries forward fresh volatile verification dates into effective recheck counts", () => {
  const report = buildDestinationEconomicsLedger({
    observations: {
      entries: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          field: "grossReturnBps",
          value: 115,
          sourceName: "BENQI app",
          sourceType: "official_app",
          observedAt: "2026-04-14T20:10:09.762Z",
        },
        {
          templateId: "avalanche:wrapped_btc_lending",
          field: "grossReturnBps",
          value: 110,
          sourceName: "BENQI app",
          sourceType: "official_app",
          observedAt: "2026-04-19T20:58:20.746Z",
        },
        {
          templateId: "avalanche:wrapped_btc_lending",
          field: "depositFeeBps",
          value: 0,
          sourceName: "BENQI docs",
          sourceType: "official_docs",
          observedAt: "2026-04-14T20:12:40.000Z",
        },
        {
          templateId: "avalanche:wrapped_btc_lending",
          field: "withdrawFeeBps",
          value: 0,
          sourceName: "BENQI docs",
          sourceType: "official_docs",
          observedAt: "2026-04-14T20:12:40.000Z",
        },
        {
          templateId: "avalanche:wrapped_btc_lending",
          field: "unwindSlippageBps",
          value: 31.5,
          sourceName: "Gateway unwind quote",
          sourceType: "live_quote",
          observedAt: "2026-04-14T20:11:44.000Z",
        },
      ],
    },
    workbench: {
      workItems: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          chain: "avalanche",
          familyId: "wrapped_btc_lending",
          label: "Wrapped BTC -> lending positions",
          category: "yield",
          values: {
            grossReturnBps: 110,
            depositFeeBps: 0,
            withdrawFeeBps: 0,
            unwindSlippageBps: 31.5,
            lastVerifiedAt: "2026-04-19",
          },
        },
      ],
    },
    evidencePolicy: {
      items: [
        {
          templateId: "avalanche:wrapped_btc_lending",
          policy: {
            volatileFields: ["grossReturnBps", "unwindSlippageBps"],
          },
        },
      ],
    },
  });

  assert.equal(report.items[0].fieldObservationCounts.unwindSlippageBps, 1);
  assert.equal(report.items[0].effectiveFieldObservationCounts.unwindSlippageBps, 2);
  assert.deepEqual(report.items[0].verificationCarryForwardFields, ["unwindSlippageBps"]);
});
