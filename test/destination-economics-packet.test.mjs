import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationEconomicsPacket } from "../src/strategy/destination-economics-packet.mjs";

test("destination economics packet builds command suggestions for queue items", () => {
  const economicsQueue = {
    queue: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        category: "yield",
        priorityScore: 0.67,
        missingEconomicFields: ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"],
      },
    ],
  };

  const workbench = {
    workItems: [
      {
        templateId: "base:stablecoin_lending_carry",
        values: {
          sourceName: "BOB Gateway Overview",
          sourceType: "official_docs",
        },
      },
    ],
  };

  const freshnessAudit = {
    items: [
      {
        templateId: "base:stablecoin_lending_carry",
        freshnessStatus: "fresh",
      },
    ],
  };

  const report = buildDestinationEconomicsPacket({ economicsQueue, workbench, freshnessAudit });
  assert.equal(report.summary.itemCount, 1);
  assert.equal(report.summary.byMeasurementMode[0].mode, "lending_snapshot");
  assert.equal(report.items[0].sourceName, "BOB Gateway Overview");
  assert.match(report.items[0].commandSuggestion, /add-destination-economics-observation/);
  assert.match(report.items[0].commandSuggestion, /sync:destination-economics-observations/);
});
