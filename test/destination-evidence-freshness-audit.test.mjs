import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationEvidenceFreshnessAudit } from "../src/strategy/destination-evidence-freshness-audit.mjs";

test("destination evidence freshness audit classifies fresh, stale, and missing evidence", () => {
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
          lastVerifiedAt: "2026-04-14T00:00:00.000Z",
        },
      },
      {
        templateId: "bsc:wrapped_btc_lending",
        chain: "bsc",
        familyId: "wrapped_btc_lending",
        label: "Wrapped BTC -> lending positions",
        category: "yield",
        score: 0.63,
        values: {
          lastVerifiedAt: "2026-04-10T00:00:00.000Z",
        },
      },
      {
        templateId: "bob:wrapped_btc_destination_yield",
        chain: "bob",
        familyId: "wrapped_btc_destination_yield",
        label: "Wrapped BTC destination yield allocation",
        category: "yield",
        score: 0.59,
        values: {},
      },
    ],
  };

  const evidencePolicy = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        policy: { freshnessHours: 24 },
      },
      {
        templateId: "bsc:wrapped_btc_lending",
        policy: { freshnessHours: 24 },
      },
      {
        templateId: "bob:wrapped_btc_destination_yield",
        policy: { freshnessHours: 24 },
      },
    ],
  };

  const report = buildDestinationEvidenceFreshnessAudit({
    workbench,
    evidencePolicy,
    now: new Date("2026-04-14T12:00:00.000Z"),
  });

  assert.equal(report.summary.freshCount, 1);
  assert.equal(report.summary.staleCount, 1);
  assert.equal(report.summary.missingCount, 1);
  assert.equal(report.items.find((item) => item.templateId === "base:stablecoin_lending_carry").freshnessStatus, "fresh");
  assert.equal(report.items.find((item) => item.templateId === "bsc:wrapped_btc_lending").freshnessStatus, "stale");
});
