import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyCatalog } from "../src/strategy/strategy-catalog.mjs";

test("strategy catalog maps BTC families and ETH branches into operator statuses", () => {
  const catalog = buildStrategyCatalog({
    dashboardStatus: {
      generatedAt: "2026-04-12T10:00:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
      },
      strategy: {
        gatewayGoldReadiness: {
          routeAvailable: true,
          bestGoldAsset: "XAUT",
          blocker: "gateway_gold_exit_quote_preflight_failed",
          blockers: ["gateway_gold_exit_quote_preflight_failed"],
          liveEligible: false,
          preflight: {
            attempted: true,
            successfulAttemptCount: 0,
          },
        },
        edgeViability: {
          verdict: { code: "positive_but_below_policy" },
          measuredNetLoopCount: 2,
          profitableExactCount: 0,
          bestMeasuredLoop: { routeKey: "bob:0x1->base:0x1" },
          closestLoop: { routeKey: "base:0x1->unichain:0x1" },
        },
        btcProxySpreads: {
          opportunityCount: 5,
          policyReadyCount: 0,
          overfitAssessment: "coverage_ok",
          bestRebalanceOpportunity: { proxyTicker: "LBTC" },
        },
        crossAssetArbitrage: {
          matchedLoopCount: 1,
          profitableClosedLoopCount: 0,
          bestLoop: { entryRouteKey: "base:usdc->base:wbtc" },
        },
        ethProfitability: {
          gatewayRouteCount: 32,
          routeCount: 0,
          measuredClosedLoopCount: 0,
          profitableClosedLoopCount: 0,
          recommendationCode: "no_multichain_eth_family_surface",
          verdictCode: "no_measured_loops",
        },
        strategyTracks: {
          tracks: [
            { kind: "stable_loop", status: "blocked_loop", reason: "amount_mismatch" },
            { kind: "proxy_spread", status: "candidate_spread", reason: "policy_ready_after_rebalance" },
            { kind: "eth_family_loop", status: "unobserved", reason: "no_multichain_eth_family_surface" },
          ],
        },
      },
    },
    state: {
      scoreSnapshot: {
        scores: [
          {
            routeKey: "base:0xusdc->base:0xweth",
            amount: "250000000",
            srcChain: "base",
            dstChain: "base",
            srcAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
            dstAsset: { ticker: "WETH", family: "native_or_wrapped", token: "0xweth", priceKey: "ethereum" },
            inputAmount: 250,
            outputAmount: 0.1,
            inputUsd: 250,
            outputUsd: 252,
            knownCostUsd: 0.2,
            tradeReadiness: "shadow_candidate_review_only",
            dataGaps: [],
          },
          {
            routeKey: "base:0xweth->base:0xusdc",
            amount: "100000000000000000",
            srcChain: "base",
            dstChain: "base",
            srcAsset: { ticker: "WETH", family: "native_or_wrapped", token: "0xweth", priceKey: "ethereum" },
            dstAsset: { ticker: "USDC", family: "stablecoin", token: "0xusdc" },
            inputAmount: 0.1,
            outputAmount: 251,
            inputUsd: 252,
            outputUsd: 251,
            knownCostUsd: 0.2,
            tradeReadiness: "shadow_candidate_review_only",
            dataGaps: [],
          },
        ],
      },
    },
    triangleArtifacts: {
      "base-btc": {
        latest: {
          totalSamples: 4,
          summary: {
            bestRoute: "USDC→LBTC→cbBTC→USDC",
            bestNetPct: 0.12,
          },
        },
        analysis: {
          sampleCount: 4,
          overallBest: { max: 0.12 },
          verdict: "near_policy — best observed 0.12% is within 2x of 0.5% target",
        },
      },
      "base-eth-btc-mixed": {
        latest: {
          totalSamples: 2,
          summary: {
            bestRoute: "USDC→WETH→LBTC→USDC",
            bestNetPct: -0.08,
          },
        },
        analysis: {
          sampleCount: 2,
          overallBest: { max: -0.08 },
          verdict: "no_opportunity — best observed -0.08% is far from 0.5% target",
        },
      },
    },
  });

  assert.equal(catalog.policy.liveTrading, "BLOCKED");
  assert.equal(catalog.policy.ethereumL1, "allowed_when_positive_ev");
  assert.equal(catalog.btcFamilies.find((entry) => entry.id === "tokenized_gold_rotation").status, "thin_coverage");
  assert.equal(
    catalog.btcFamilies.find((entry) => entry.id === "tokenized_gold_rotation").reason,
    "gateway_gold_exit_quote_preflight_failed",
  );
  assert.equal(
    catalog.btcFamilies.find((entry) => entry.id === "tokenized_gold_rotation").evidence.bestGoldAsset,
    "XAUT",
  );
  assert.equal(
    catalog.btcFamilies.find((entry) => entry.id === "gateway_wrapped_btc_loops").status,
    "measured_below_policy",
  );
  assert.equal(
    catalog.btcFamilies.find((entry) => entry.id === "btc_proxy_spreads").status,
    "candidate_for_validation",
  );
  assert.equal(catalog.ethBranches.find((entry) => entry.id === "eth_family_gateway").status, "unobserved");
  assert.equal(
    catalog.ethBranches.find((entry) => entry.id === "eth_mixed_stable_loops").status,
    "candidate_for_validation",
  );
  assert.equal(catalog.ethBranches.find((entry) => entry.id === "eth_mixed_flash").status, "analysis_only");
});

test("strategy catalog prioritizes latest flash-negative runtime evidence over stale positive triangle analysis", () => {
  const catalog = buildStrategyCatalog({
    dashboardStatus: {
      generatedAt: "2026-04-13T23:00:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
      },
      strategy: {},
    },
    triangleArtifacts: {
      "base-btc": {
        latest: {
          totalSamples: 47,
          triangular: [
            {
              label: "USDC→LBTC→cbBTC→USDC",
              ok: true,
              netAfterFlashPct: -0.0836,
            },
            {
              label: "USDC→cbBTC→tBTC→USDC",
              ok: true,
              netAfterFlashPct: -0.0707,
            },
          ],
          summary: {
            profitableAfterFlash: 0,
            meetsPolicy: 0,
            bestRoute: null,
            bestNetPct: null,
          },
        },
        analysis: {
          sampleCount: 441,
          overallBest: { max: 0.9017 },
          verdict: "policy_opportunity_detected — historical raw analysis artifact",
        },
      },
    },
  });

  const triangle = catalog.btcFamilies.find((entry) => entry.id === "triangular_flash_btc");
  assert.equal(triangle.status, "measured_below_policy");
  assert.equal(triangle.reason, "latest_flash_negative");
  assert.equal(triangle.evidence.verdict, "latest_flash_negative");
  assert.equal(triangle.evidence.bestRoute, "USDC→cbBTC→tBTC→USDC");
  assert.equal(triangle.evidence.bestNetPct, -0.0707);
});

test("strategy catalog overlays objective lane reclassification onto operator statuses", () => {
  const catalog = buildStrategyCatalog({
    dashboardStatus: {
      generatedAt: "2026-04-17T15:40:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
      },
      strategy: {
        edgeViability: {
          verdict: { code: "policy_ready" },
          measuredNetLoopCount: 4,
          profitableExactCount: 2,
          bestMeasuredLoop: { routeKey: "base:0x1->bob:0x1" },
        },
        btcProxySpreads: {
          opportunityCount: 3,
          policyReadyCount: 1,
          bestRebalanceOpportunity: { proxyTicker: "LBTC" },
        },
      },
    },
    laneReclassification: {
      lanes: [
        {
          id: "gateway_wrapped_btc_loops",
          statusOld: "candidate_for_validation",
          statusNew: "needs_variance_measurement",
          clearsNewFloor: null,
          passesOverfitGate: null,
          evidenceRouteKey: "base:0x1->bob:0x1",
          evidenceAmount: "10000",
          netPnlMeasuredUsd: 1.4,
          gasSlippageVarianceUsd: null,
          remainingBlockers: ["variance_artifact_missing_for_lane"],
          statusReasonCode: "variance_missing",
        },
        {
          id: "btc_proxy_spreads",
          statusOld: "candidate_for_validation",
          statusNew: "measured_overfit_blocked",
          clearsNewFloor: true,
          passesOverfitGate: false,
          evidenceRouteKey: "base:lbtc->base:wbtc",
          evidenceAmount: "25000",
          netPnlMeasuredUsd: 0.91,
          gasSlippageVarianceUsd: 0.15,
          remainingBlockers: ["overfit_risks_present"],
          statusReasonCode: "overfit_gate_blocked",
        },
      ],
    },
  });

  const gatewayLoops = catalog.btcFamilies.find((entry) => entry.id === "gateway_wrapped_btc_loops");
  const proxySpreads = catalog.btcFamilies.find((entry) => entry.id === "btc_proxy_spreads");

  assert.equal(gatewayLoops.status, "thin_coverage");
  assert.equal(gatewayLoops.reason, "variance_missing");
  assert.equal(gatewayLoops.revalidation?.statusNew, "needs_variance_measurement");
  assert.equal(gatewayLoops.revalidation?.nextAction?.code, "measure_variance_floor");

  assert.equal(proxySpreads.status, "measured_below_policy");
  assert.equal(proxySpreads.reason, "overfit_gate_blocked");
  assert.equal(proxySpreads.revalidation?.statusNew, "measured_overfit_blocked");
  assert.equal(proxySpreads.revalidation?.nextAction?.code, "rerun_overfit_revalidation");

  assert.equal(catalog.summary.revalidationStatusCounts.needs_variance_measurement, 1);
  assert.equal(catalog.summary.revalidationStatusCounts.measured_overfit_blocked, 1);
  assert.equal(catalog.summary.topRevalidationCandidateId, "gateway_wrapped_btc_loops");
});
