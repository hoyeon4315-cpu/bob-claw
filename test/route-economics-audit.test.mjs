import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEdgeResearchSummary } from "../src/strategy/edge-research.mjs";
import { buildEdgeViabilitySummary } from "../src/strategy/edge-viability.mjs";
import { buildNoEdgePersistenceSummary } from "../src/strategy/no-edge-persistence.mjs";
import { buildPivotDecisionSummary, buildRouteEconomicsAudit } from "../src/strategy/route-economics-audit.mjs";

function wbtcAsset(ticker = "wBTC.OFT") {
  return { ticker, family: "wrapped_btc", decimals: 8 };
}

test("route economics audit keeps the measured leader in scope while demoting a negative active canary", () => {
  const scoreSnapshot = {
    generatedAt: "2026-04-12T00:00:00.000Z",
    scores: [
      {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
        srcAsset: wbtcAsset(),
        dstAsset: wbtcAsset(),
        inputAmount: 10000,
        outputAmount: 10000,
        executableOutputUsd: 7.2,
        knownCostUsd: 0.8,
        netEdgeUsd: -0.85,
        executableNetEdgeUsd: -0.84,
        effectiveSystemNetPnlUsd: -0.9,
        tradeReadiness: "reject_no_net_edge",
        dataGaps: [],
        routeStats: { failureRate: 0.03 },
      },
      {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
        srcAsset: wbtcAsset("WBTC"),
        dstAsset: wbtcAsset(),
        inputAmount: 10000,
        outputAmount: 10000,
        executableOutputUsd: 72.2,
        knownCostUsd: 0.2,
        netEdgeUsd: 64.7,
        executableNetEdgeUsd: 64.9,
        effectiveSystemNetPnlUsd: -0.4,
        tradeReadiness: "insufficient_data",
        dataGaps: [],
        routeStats: { failureRate: 0.01 },
      },
    ],
  };

  const dexQuotes = [
    {
      source: "gateway_src_entry_leg",
      gatewayRouteKey: "ethereum:0x2260->base:0x0555",
      gatewayAmount: "10000",
      observedAt: "2026-04-12T00:00:01.000Z",
      outputAmount: "10000",
      inputValueUsd: 7.1,
      gasEstimateValueUsd: 0.05,
    },
  ];

  const routePlan = {
    topCandidates: [
      {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        label: "bob->base wBTC.OFT->wBTC.OFT",
        srcChain: "bob",
        dstChain: "base",
        viableForPrep: true,
        txReady: true,
        exactGasDone: true,
        tradeReadiness: "reject_no_net_edge",
        prepBlockers: [],
        scoreDisqualifiers: [],
      },
      {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        label: "ethereum->base WBTC->wBTC.OFT",
        srcChain: "ethereum",
        dstChain: "base",
        viableForPrep: false,
        txReady: true,
        exactGasDone: false,
        tradeReadiness: "insufficient_data",
        prepBlockers: ["wallet_not_checked"],
        scoreDisqualifiers: [],
      },
    ],
    candidates: [
      {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        label: "bob->base wBTC.OFT->wBTC.OFT",
        srcChain: "bob",
        dstChain: "base",
        viableForPrep: true,
        txReady: true,
        exactGasDone: true,
        tradeReadiness: "reject_no_net_edge",
        prepBlockers: [],
        scoreDisqualifiers: [],
      },
      {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        label: "ethereum->base WBTC->wBTC.OFT",
        srcChain: "ethereum",
        dstChain: "base",
        viableForPrep: false,
        txReady: true,
        exactGasDone: false,
        tradeReadiness: "insufficient_data",
        prepBlockers: ["wallet_not_checked"],
        scoreDisqualifiers: [],
      },
    ],
  };

  const edgeViability = buildEdgeViabilitySummary({ scoreSnapshot, dexQuotes });
  const edgeResearch = buildEdgeResearchSummary({ scoreSnapshot, shadowObservations: [] });
  const noEdgePersistence = buildNoEdgePersistenceSummary({ scoreSnapshot, dexQuotes });
  const audit = buildRouteEconomicsAudit({
    scoreSnapshot,
    routePlan,
    edgeViability,
    edgeResearch,
    noEdgePersistence,
    quotes: [
      { routeKey: "bob:0x0555->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:00:01.000Z", latencyMs: 700 },
      { routeKey: "bob:0x0555->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:05:01.000Z", latencyMs: 750 },
      { routeKey: "ethereum:0x2260->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:10:01.000Z", latencyMs: 420 },
      { routeKey: "ethereum:0x2260->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:15:01.000Z", latencyMs: 410 },
    ],
    shadowObservations: [
      { routeKey: "bob:0x0555->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:20:01.000Z", rejectionReasons: ["reject_no_net_edge"], tradeReadiness: "reject_no_net_edge", observedEdgeUsd: -0.8 },
      { routeKey: "bob:0x0555->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:25:01.000Z", rejectionReasons: ["reject_no_net_edge"], tradeReadiness: "reject_no_net_edge", observedEdgeUsd: -0.82 },
      { routeKey: "bob:0x0555->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:30:01.000Z", rejectionReasons: ["reject_no_net_edge"], tradeReadiness: "reject_no_net_edge", observedEdgeUsd: -0.84 },
      { routeKey: "ethereum:0x2260->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:35:01.000Z", rejectionReasons: ["insufficient_data"], tradeReadiness: "insufficient_data", observedEdgeUsd: 64.6 },
      { routeKey: "ethereum:0x2260->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:40:01.000Z", rejectionReasons: ["insufficient_data"], tradeReadiness: "insufficient_data", observedEdgeUsd: 64.6 },
      { routeKey: "ethereum:0x2260->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:45:01.000Z", rejectionReasons: ["insufficient_data"], tradeReadiness: "insufficient_data", observedEdgeUsd: 64.6 },
    ],
  });

  assert.equal(audit.summary.strategyDecisionCode, "keep_researching");
  assert.equal(audit.summary.currentCanary.verdict, "observe_only");
  assert.equal(audit.summary.measuredLeader.verdict, "continue");
  assert.equal(audit.summary.measuredLeader.verdictReasonCode, "measured_positive_but_system_negative");
  assert.equal(audit.candidateAudits.find((item) => item.roles.includes("active_canary")).verdictReasonCode, "prep_ready_but_negative");
  assert.equal(audit.summary.candidateCounts.continueWhileSystemNegative >= 1, true);
});

test("route economics audit recommends a thesis pivot when every reviewed family is durable no-edge", () => {
  const scoreSnapshot = {
    generatedAt: "2026-04-12T00:00:00.000Z",
    scores: [
      {
        routeKey: "base:0x0555->unichain:0x0555",
        amount: "10000",
        srcChain: "base",
        dstChain: "unichain",
        srcAsset: wbtcAsset(),
        dstAsset: wbtcAsset(),
        inputAmount: 10000,
        executableOutputUsd: 7.0,
        knownCostUsd: 0.2,
        netEdgeUsd: -0.6,
        executableNetEdgeUsd: -0.6,
        effectiveSystemNetPnlUsd: -0.7,
        tradeReadiness: "reject_no_net_edge",
        dataGaps: [],
        routeStats: { failureRate: 0.01 },
      },
      {
        routeKey: "base:0x0555->unichain:0x0555",
        amount: "25000",
        srcChain: "base",
        dstChain: "unichain",
        srcAsset: wbtcAsset(),
        dstAsset: wbtcAsset(),
        inputAmount: 25000,
        executableOutputUsd: 17.1,
        knownCostUsd: 0.2,
        netEdgeUsd: -1.0,
        executableNetEdgeUsd: -1.0,
        effectiveSystemNetPnlUsd: -1.1,
        tradeReadiness: "reject_no_net_edge",
        dataGaps: [],
        routeStats: { failureRate: 0.01 },
      },
      {
        routeKey: "base:0x0555->unichain:0x0555",
        amount: "50000",
        srcChain: "base",
        dstChain: "unichain",
        srcAsset: wbtcAsset(),
        dstAsset: wbtcAsset(),
        inputAmount: 50000,
        executableOutputUsd: 34.8,
        knownCostUsd: 0.2,
        netEdgeUsd: -1.7,
        executableNetEdgeUsd: -1.7,
        effectiveSystemNetPnlUsd: -1.9,
        tradeReadiness: "reject_no_net_edge",
        dataGaps: [],
        routeStats: { failureRate: 0.01 },
      },
    ],
  };

  const dexQuotes = [
    {
      source: "gateway_src_entry_leg",
      gatewayRouteKey: "base:0x0555->unichain:0x0555",
      gatewayAmount: "10000",
      observedAt: "2026-04-12T00:00:01.000Z",
      outputAmount: "10000",
      inputValueUsd: 7.4,
      gasEstimateValueUsd: 0.05,
    },
    {
      source: "gateway_src_entry_leg",
      gatewayRouteKey: "base:0x0555->unichain:0x0555",
      gatewayAmount: "25000",
      observedAt: "2026-04-12T00:00:01.000Z",
      outputAmount: "25000",
      inputValueUsd: 18.3,
      gasEstimateValueUsd: 0.05,
    },
    {
      source: "gateway_src_entry_leg",
      gatewayRouteKey: "base:0x0555->unichain:0x0555",
      gatewayAmount: "50000",
      observedAt: "2026-04-12T00:00:01.000Z",
      outputAmount: "50000",
      inputValueUsd: 36.5,
      gasEstimateValueUsd: 0.05,
    },
  ];

  const audit = buildRouteEconomicsAudit({
    scoreSnapshot,
    routePlan: {
      topCandidates: [
        {
          routeKey: "base:0x0555->unichain:0x0555",
          amount: "10000",
          label: "base->unichain wBTC.OFT->wBTC.OFT",
          srcChain: "base",
          dstChain: "unichain",
          viableForPrep: true,
          txReady: true,
          exactGasDone: true,
          tradeReadiness: "reject_no_net_edge",
          prepBlockers: [],
          scoreDisqualifiers: [],
        },
      ],
      candidates: [],
    },
    edgeViability: buildEdgeViabilitySummary({ scoreSnapshot, dexQuotes }),
    edgeResearch: buildEdgeResearchSummary({ scoreSnapshot, shadowObservations: [] }),
    noEdgePersistence: buildNoEdgePersistenceSummary({ scoreSnapshot, dexQuotes }),
  });

  assert.equal(audit.summary.strategyDecisionCode, "pivot_within_current_thesis");
  assert.equal(audit.routeFamilyAudits[0].verdict, "drop");
  assert.equal(audit.candidateAudits[0].verdict, "drop");
});

test("route economics audit stays blocked when evidence is still thin", () => {
  const scoreSnapshot = {
    generatedAt: "2026-04-12T00:00:00.000Z",
    scores: [
      {
        routeKey: "sonic:0x0555->base:0x0555",
        amount: "10000",
        srcChain: "sonic",
        dstChain: "base",
        srcAsset: wbtcAsset(),
        dstAsset: wbtcAsset(),
        inputAmount: 10000,
        executableOutputUsd: 7.25,
        knownCostUsd: 0.2,
        netEdgeUsd: 0.1,
        executableNetEdgeUsd: 0.08,
        effectiveSystemNetPnlUsd: 0.05,
        tradeReadiness: "insufficient_data",
        dataGaps: ["stale_dex_output_quote"],
        routeStats: { failureRate: 0.01 },
      },
    ],
  };

  const audit = buildRouteEconomicsAudit({
    scoreSnapshot,
    routePlan: {
      topCandidates: [
        {
          routeKey: "sonic:0x0555->base:0x0555",
          amount: "10000",
          label: "sonic->base wBTC.OFT->wBTC.OFT",
          srcChain: "sonic",
          dstChain: "base",
          viableForPrep: false,
          txReady: true,
          exactGasDone: false,
          tradeReadiness: "insufficient_data",
          prepBlockers: ["wallet_not_checked"],
          scoreDisqualifiers: ["stale_dex_output_quote"],
        },
      ],
      candidates: [],
    },
    edgeResearch: buildEdgeResearchSummary({ scoreSnapshot, shadowObservations: [] }),
    noEdgePersistence: { routes: [] },
    quotes: [{ routeKey: "sonic:0x0555->base:0x0555", amount: "10000", observedAt: "2026-04-12T00:00:01.000Z", latencyMs: 350 }],
  });

  assert.equal(audit.summary.strategyDecisionCode, "stay_blocked");
  assert.equal(audit.candidateAudits[0].verdict, "observe_only");
  assert.equal(audit.candidateAudits[0].verdictReasonCode, "thin_shadow_evidence");
});

test("route economics audit surfaces multi-shadow amount ladder and hour-bucket evidence", () => {
  const scoreSnapshot = {
    generatedAt: "2026-04-12T00:00:00.000Z",
    scores: [
      {
        routeKey: "base:0x0555->sonic:0x0555",
        amount: "10000",
        srcChain: "base",
        dstChain: "sonic",
        srcAsset: wbtcAsset(),
        dstAsset: wbtcAsset(),
        inputAmount: 10000,
        executableOutputUsd: 7.2,
        knownCostUsd: 0.2,
        netEdgeUsd: 0.4,
        executableNetEdgeUsd: 0.35,
        effectiveSystemNetPnlUsd: 0.3,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
        routeStats: { failureRate: 0.01 },
      },
      {
        routeKey: "base:0x0555->sonic:0x0555",
        amount: "25000",
        srcChain: "base",
        dstChain: "sonic",
        srcAsset: wbtcAsset(),
        dstAsset: wbtcAsset(),
        inputAmount: 25000,
        executableOutputUsd: 18.1,
        knownCostUsd: 0.2,
        netEdgeUsd: 0.5,
        executableNetEdgeUsd: 0.45,
        effectiveSystemNetPnlUsd: 0.4,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
        routeStats: { failureRate: 0.01 },
      },
      {
        routeKey: "base:0x0555->sonic:0x0555",
        amount: "50000",
        srcChain: "base",
        dstChain: "sonic",
        srcAsset: wbtcAsset(),
        dstAsset: wbtcAsset(),
        inputAmount: 50000,
        executableOutputUsd: 36.7,
        knownCostUsd: 0.2,
        netEdgeUsd: 0.7,
        executableNetEdgeUsd: 0.6,
        effectiveSystemNetPnlUsd: 0.55,
        tradeReadiness: "shadow_candidate_review_only",
        dataGaps: [],
        routeStats: { failureRate: 0.01 },
      },
    ],
  };

  const audit = buildRouteEconomicsAudit({
    scoreSnapshot,
    routePlan: {
      topCandidates: [
        {
          routeKey: "base:0x0555->sonic:0x0555",
          amount: "10000",
          label: "base->sonic wBTC.OFT->wBTC.OFT",
          srcChain: "base",
          dstChain: "sonic",
          viableForPrep: true,
          txReady: true,
          exactGasDone: true,
          tradeReadiness: "shadow_candidate_review_only",
          prepBlockers: [],
          scoreDisqualifiers: [],
        },
      ],
      candidates: [],
    },
    edgeResearch: buildEdgeResearchSummary({
      scoreSnapshot,
      shadowObservations: [
        { routeKey: "base:0x0555->sonic:0x0555", amount: "10000", observedAt: "2026-04-12T00:15:01.000Z", rejectionReasons: [], tradeReadiness: "shadow_candidate_review_only", observedEdgeUsd: 0.3 },
        { routeKey: "base:0x0555->sonic:0x0555", amount: "25000", observedAt: "2026-04-12T01:15:01.000Z", rejectionReasons: [], tradeReadiness: "shadow_candidate_review_only", observedEdgeUsd: 0.4 },
        { routeKey: "base:0x0555->sonic:0x0555", amount: "50000", observedAt: "2026-04-12T02:15:01.000Z", rejectionReasons: [], tradeReadiness: "shadow_candidate_review_only", observedEdgeUsd: 0.5 },
      ],
    }),
    noEdgePersistence: { routes: [] },
    quotes: [
      { routeKey: "base:0x0555->sonic:0x0555", amount: "10000", observedAt: "2026-04-12T00:10:01.000Z", latencyMs: 400 },
      { routeKey: "base:0x0555->sonic:0x0555", amount: "25000", observedAt: "2026-04-12T01:10:01.000Z", latencyMs: 420 },
      { routeKey: "base:0x0555->sonic:0x0555", amount: "50000", observedAt: "2026-04-12T02:10:01.000Z", latencyMs: 430 },
    ],
    shadowObservations: [
      { routeKey: "base:0x0555->sonic:0x0555", amount: "10000", observedAt: "2026-04-12T00:15:01.000Z", rejectionReasons: [], tradeReadiness: "shadow_candidate_review_only", observedEdgeUsd: 0.3 },
      { routeKey: "base:0x0555->sonic:0x0555", amount: "25000", observedAt: "2026-04-12T01:15:01.000Z", rejectionReasons: [], tradeReadiness: "shadow_candidate_review_only", observedEdgeUsd: 0.4 },
      { routeKey: "base:0x0555->sonic:0x0555", amount: "50000", observedAt: "2026-04-12T02:15:01.000Z", rejectionReasons: [], tradeReadiness: "shadow_candidate_review_only", observedEdgeUsd: 0.5 },
    ],
  });

  assert.equal(audit.summary.evidenceCounts.denseShadowCandidates, 1);
  assert.equal(audit.summary.evidenceCounts.multiAmountCandidates, 1);
  assert.equal(audit.summary.evidenceCounts.multiHourCandidates, 1);
  assert.deepEqual(audit.candidateAudits[0].evidence.routeAmountLevels, ["10000", "25000", "50000"]);
  assert.equal(audit.candidateAudits[0].evidence.routeAmountLevelCount, 3);
  assert.equal(audit.candidateAudits[0].evidence.routeHourBucketCount, 3);
  assert.equal(audit.candidateAudits[0].evidence.routeShadowObservationCount, 3);
});

test("pivot decision summary reuses economics audit strategy with objective plans", () => {
  const pivot = buildPivotDecisionSummary({
    economicsAudit: {
      summary: {
        strategyDecisionCode: "pivot_within_current_thesis",
        strategyDecisionLabel: "Pivot within the current thesis instead of forcing the current route families",
        currentCanary: {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          verdict: "observe_only",
          verdictReasonCode: "prep_ready_but_negative",
        },
        measuredLeader: {
          routeKey: "ethereum:0x2260->base:0x0555",
          amount: "10000",
          label: "ethereum->base WBTC->wBTC.OFT",
          verdict: "continue",
          verdictReasonCode: "measured_positive_but_system_negative",
        },
        candidateCounts: { continue: 1, observeOnly: 1, drop: 1, continueWhileSystemNegative: 1 },
        familyCounts: { continue: 0, observeOnly: 0, drop: 1 },
        evidenceCounts: { denseShadowCandidates: 1, multiAmountCandidates: 1, multiHourCandidates: 1 },
      },
    },
    objectivePlans: {
      discovery: {
        routeKey: "base:0x0555->sonic:0x0555",
        amount: "25000",
        label: "base->sonic wBTC.OFT->wBTC.OFT",
        nextActionCode: "validate_route_durability",
        nextActionLabel: "validate route durability",
        command: "npm run verify:gateway -- --route-key=base:0x0555->sonic:0x0555 --amounts=25000",
      },
    },
  });

  assert.equal(pivot.decisionCode, "pivot_within_current_thesis");
  assert.equal(pivot.status, "pivot_within_current_thesis");
  assert.equal(pivot.focusRouteKey, "base:0x0555->sonic:0x0555");
  assert.equal(pivot.nextActionCode, "validate_route_durability");
  assert.match(pivot.command, /verify:gateway/);
  assert.equal(pivot.currentCanaryReasonCode, "prep_ready_but_negative");
});
