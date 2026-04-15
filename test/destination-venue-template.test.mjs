import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationVenueTemplate } from "../src/strategy/destination-venue-template.mjs";

test("destination venue template includes research-only and ready-for-venue-scoring strategies", () => {
  const gates = {
    chains: [
      {
        chain: "base",
        strategies: [
          {
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            category: "yield",
            actionType: "lending",
            evidenceTier: "docs_plus_live_arrival",
            overfitRisk: "low",
            blockerTags: ["destination_gap"],
            gate: {
              status: "research_only",
              nextAction: "complete venue scoring",
              reasons: ["destination deployment evidence is incomplete"],
            },
            scoring: {
              deploymentPriorityScore: 0.66,
            },
          },
          {
            familyId: "wrapped_btc_destination_yield",
            label: "Wrapped BTC destination yield allocation",
            category: "yield",
            actionType: "yield_action",
            evidenceTier: "transport_plus_destination_gap",
            overfitRisk: "low",
            blockerTags: [],
            gate: {
              status: "ready_for_venue_scoring",
              nextAction: "add deterministic venue economics inputs",
              reasons: ["eligible for deeper venue-level scoring but not yet allocatable"],
            },
            scoring: {
              deploymentPriorityScore: 0.59,
            },
          },
          {
            familyId: "btc_to_wrapped_btc_hold",
            label: "BTC -> wrapped BTC carry and hold",
            category: "transport",
            actionType: "hold",
            evidenceTier: "transport_only",
            overfitRisk: "low",
            blockerTags: [],
            gate: {
              status: "transport_only",
              nextAction: "map destination venues on this rail",
              reasons: ["transport support exists"],
            },
            scoring: {
              deploymentPriorityScore: 0,
            },
          },
        ],
      },
    ],
  };

  const report = buildDestinationVenueTemplate({ gates });

  assert.equal(report.summary.templateCount, 2);
  assert.equal(report.summary.readyForVenueScoringTemplates, 1);
  assert.equal(report.summary.researchOnlyTemplates, 1);
  assert.equal(report.chains[0].templates[0].recommendedInputMode, "lending_rate_snapshot");
  assert.equal(report.chains[0].templates[1].recommendedInputMode, "vault_or_yield_feed");
});
