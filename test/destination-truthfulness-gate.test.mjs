import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationTruthfulnessGate } from "../src/strategy/destination-truthfulness-gate.mjs";

test("truthfulness gate classifies deployment, transport, blocked, and observe-only tracks", () => {
  const scoring = {
    chains: [
      {
        chain: "base",
        strategies: [
          {
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            category: "yield",
            actionType: "lending",
            blockers: [],
            evidenceStatus: "docs_supported_live_arrival_asset",
            scoring: {
              track: "deployment_candidate",
              deploymentPriorityScore: 0.66,
            },
          },
          {
            familyId: "btc_to_wrapped_btc_hold",
            label: "BTC -> wrapped BTC carry and hold",
            category: "transport",
            blockers: [],
            evidenceStatus: "live_transport_supported",
            scoring: {
              track: "transport_rail",
              deploymentPriorityScore: 0,
            },
          },
          {
            familyId: "btc_to_eth_rotation",
            label: "BTC -> ETH rotation",
            category: "macro_rotation",
            blockers: [],
            evidenceStatus: "live_transport_supported",
            scoring: {
              track: "macro_rotation",
              deploymentPriorityScore: 0.47,
            },
          },
          {
            familyId: "btc_proxy_spread_rebalance",
            label: "Wrapped BTC proxy spread rebalance",
            category: "arbitrage",
            blockers: ["high_overfit_risk"],
            evidenceStatus: "live_transport_supported",
            scoring: {
              track: "blocked_research",
              deploymentPriorityScore: 0,
            },
          },
        ],
      },
      {
        chain: "ethereum",
        strategies: [
          {
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            category: "yield",
            blockers: ["ethereum l1 disabled in usd 300 phase"],
            evidenceStatus: "docs_supported_live_arrival_asset",
            scoring: {
              track: "observe_only_research",
              deploymentPriorityScore: 0,
            },
          },
        ],
      },
    ],
  };

  const report = buildDestinationTruthfulnessGate({ scoring });
  const base = report.chains.find((chain) => chain.chain === "base");
  const ethereum = report.chains.find((chain) => chain.chain === "ethereum");

  assert.equal(base.topGateReadyCandidate.familyId, "stablecoin_lending_carry");
  assert.equal(base.strategies.find((item) => item.familyId === "stablecoin_lending_carry").gate.status, "ready_for_venue_scoring");
  assert.equal(base.strategies.find((item) => item.familyId === "stablecoin_lending_carry").actionType, "lending");
  assert.equal(base.strategies.find((item) => item.familyId === "btc_to_wrapped_btc_hold").gate.status, "transport_only");
  assert.equal(base.strategies.find((item) => item.familyId === "btc_to_eth_rotation").gate.status, "thesis_review_required");
  assert.equal(base.strategies.find((item) => item.familyId === "btc_proxy_spread_rebalance").gate.status, "blocked");
  assert.equal(ethereum.strategies[0].gate.status, "observe_only");
  assert.equal(report.summary.readyForVenueScoringCount, 1);
  assert.equal(report.summary.transportOnlyCount, 1);
  assert.equal(report.summary.thesisReviewRequiredCount, 1);
  assert.equal(report.summary.blockedCount, 1);
  assert.equal(report.summary.observeOnlyCount, 1);
});

test("truthfulness gate keeps docs-only surface strategies in research_only", () => {
  const scoring = {
    chains: [
      {
        chain: "base",
        strategies: [
          {
            familyId: "custom_destination_actions",
            label: "Gateway custom destination actions",
            category: "platform",
            blockers: [],
            evidenceStatus: "docs_surface_supported",
            scoring: {
              track: "deployment_candidate",
              deploymentPriorityScore: 0.59,
            },
          },
        ],
      },
    ],
  };

  const report = buildDestinationTruthfulnessGate({ scoring });
  assert.equal(report.chains[0].strategies[0].gate.status, "research_only");
  assert.equal(report.summary.readyForVenueScoringCount, 0);
  assert.equal(report.summary.researchOnlyCount, 1);
});
