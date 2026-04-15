import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationScoringInputs } from "../src/strategy/destination-scoring.mjs";

test("destination scoring separates transport rails from deployment candidates", () => {
  const nativeBtcSurface = {
    liveSurface: {
      liveRoutes: [
        { dstChain: "base", dstFamily: "wrapped_btc", dstTicker: "wBTC.OFT" },
        { dstChain: "base", dstFamily: "stablecoin", dstTicker: "USDC" },
      ],
    },
  };

  const registry = {
    chains: [
      {
        chain: "base",
        liveRouteCount: 2,
        arrivalAssets: ["wBTC.OFT", "USDC"],
        strategies: [
          {
            familyId: "btc_to_wrapped_btc_hold",
            label: "BTC -> wrapped BTC carry and hold",
            category: "transport",
            actionType: "hold",
            arrivalFamily: "wrapped_btc",
            allowlistStatus: "pending_review",
            automationReadiness: "transport_ready_destination_missing",
            evidenceStatus: "live_transport_supported",
            phasePolicy: "research_only_until_scored",
            blockers: [],
          },
          {
            familyId: "wrapped_btc_lending",
            label: "Wrapped BTC -> lending positions",
            category: "yield",
            actionType: "lending",
            arrivalFamily: "wrapped_btc",
            allowlistStatus: "pending_review",
            automationReadiness: "research_only",
            evidenceStatus: "docs_supported_live_arrival_asset",
            phasePolicy: "research_only_until_scored",
            blockers: ["venue scoring missing"],
          },
        ],
      },
    ],
  };

  const report = buildDestinationScoringInputs({ registry, nativeBtcSurface });
  const base = report.chains[0];

  assert.equal(base.topTransportRail.familyId, "btc_to_wrapped_btc_hold");
  assert.equal(base.topDeploymentCandidate.familyId, "wrapped_btc_lending");
  assert.equal(report.summary.topTransportRails[0].familyId, "btc_to_wrapped_btc_hold");
  assert.equal(report.summary.topDeploymentCandidates[0].familyId, "wrapped_btc_lending");
});

test("destination scoring does not promote blocked arbitrage as deployment candidate", () => {
  const nativeBtcSurface = {
    liveSurface: {
      liveRoutes: [{ dstChain: "base", dstFamily: "wrapped_btc", dstTicker: "wBTC.OFT" }],
    },
  };

  const registry = {
    chains: [
      {
        chain: "base",
        liveRouteCount: 1,
        arrivalAssets: ["wBTC.OFT"],
        strategies: [
          {
            familyId: "btc_proxy_spread_rebalance",
            label: "Wrapped BTC proxy spread rebalance",
            category: "arbitrage",
            actionType: "cross_wrapper_spread",
            arrivalFamily: "wrapped_btc",
            allowlistStatus: "pending_review",
            automationReadiness: "blocked_by_overfit",
            evidenceStatus: "live_transport_supported",
            phasePolicy: "blocked_until_new_evidence",
            blockers: ["high_overfit_risk"],
          },
          {
            familyId: "wrapped_btc_destination_yield",
            label: "Wrapped BTC destination yield allocation",
            category: "yield",
            actionType: "yield_action",
            arrivalFamily: "wrapped_btc",
            allowlistStatus: "pending_review",
            automationReadiness: "research_only",
            evidenceStatus: "live_transport_supported_destination_unscored",
            phasePolicy: "research_only_until_scored",
            blockers: ["destination scoring missing"],
          },
        ],
      },
    ],
  };

  const report = buildDestinationScoringInputs({ registry, nativeBtcSurface });
  const strategies = report.chains[0].strategies;
  const blocked = strategies.find((strategy) => strategy.familyId === "btc_proxy_spread_rebalance");
  const yieldCandidate = strategies.find((strategy) => strategy.familyId === "wrapped_btc_destination_yield");

  assert.equal(blocked.scoring.track, "blocked_research");
  assert.equal(blocked.scoring.deploymentPriorityScore, 0);
  assert.equal(yieldCandidate.scoring.track, "deployment_candidate");
  assert.equal(report.chains[0].topDeploymentCandidate.familyId, "wrapped_btc_destination_yield");
});

test("destination scoring keeps ethereum observe-only strategies out of deployment candidates", () => {
  const nativeBtcSurface = {
    liveSurface: {
      liveRoutes: [
        { dstChain: "ethereum", dstFamily: "stablecoin", dstTicker: "USDC" },
        { dstChain: "base", dstFamily: "stablecoin", dstTicker: "USDC" },
      ],
    },
  };

  const registry = {
    chains: [
      {
        chain: "ethereum",
        liveRouteCount: 1,
        arrivalAssets: ["USDC"],
        strategies: [
          {
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            category: "yield",
            actionType: "lending",
            arrivalFamily: "stablecoin",
            allowlistStatus: "pending_review",
            automationReadiness: "research_only",
            evidenceStatus: "docs_supported_live_arrival_asset",
            phasePolicy: "observe_only_until_reapproved",
            blockers: ["ethereum l1 disabled in usd 300 phase"],
          },
        ],
      },
      {
        chain: "base",
        liveRouteCount: 1,
        arrivalAssets: ["USDC"],
        strategies: [
          {
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            category: "yield",
            actionType: "lending",
            arrivalFamily: "stablecoin",
            allowlistStatus: "pending_review",
            automationReadiness: "research_only",
            evidenceStatus: "docs_supported_live_arrival_asset",
            phasePolicy: "research_only_until_scored",
            blockers: ["venue scoring missing"],
          },
        ],
      },
    ],
  };

  const report = buildDestinationScoringInputs({ registry, nativeBtcSurface });
  const ethStrategy = report.chains.find((chain) => chain.chain === "ethereum").strategies[0];

  assert.equal(ethStrategy.scoring.track, "observe_only_research");
  assert.equal(ethStrategy.scoring.deploymentPriorityScore, 0);
  assert.equal(report.summary.topObserveOnlyResearch[0].chain, "ethereum");
  assert.equal(report.summary.topDeploymentCandidates[0].chain, "base");
});
