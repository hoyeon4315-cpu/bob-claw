import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEdgeResearchSummary } from "../src/strategy/edge-research.mjs";
import { ETHEREUM_L1_PHASE_DISABLED_REASON, ETHEREUM_L1_POLICY_BLOCKED_CLASSIFICATION } from "../src/risk/ethereum-l1-policy.mjs";

test("edge research rejects implausible positive outliers and keeps strong multi-level candidates separate", () => {
  const summary = buildEdgeResearchSummary({
    scoreSnapshot: {
      generatedAt: "2026-04-11T13:00:00.000Z",
      scores: [
        {
          routeKey: "bitcoin:0xbtc->base:0xsolvbtc",
          amount: "10000",
          executableNetEdgeUsd: 1000,
          executableNetEdgePct: 100,
          dataGaps: ["implausible_quote_value_ratio"],
          routeStats: { failureRate: 0 },
        },
        {
          routeKey: "base:0xwbtc->bob:0xwbtc",
          amount: "10000",
          executableNetEdgeUsd: 0.5,
          executableNetEdgePct: 0.01,
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
        {
          routeKey: "base:0xwbtc->bob:0xwbtc",
          amount: "25000",
          executableNetEdgeUsd: 0.8,
          executableNetEdgePct: 0.012,
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
      ],
    },
    shadowObservations: [],
  });

  assert.equal(summary.outlierCount, 1);
  assert.equal(summary.singleLevelOnlyCount, 0);
  assert.equal(summary.multiLevelCandidateCount, 0);
  assert.equal(summary.bestCandidate.routeKey, "base:0xwbtc->bob:0xwbtc");
  assert.equal(summary.bestCandidate.classification, "missing_decay_coverage");
});

test("edge research upgrades to multi-level candidate when profitable levels and decay survival exist", () => {
  const summary = buildEdgeResearchSummary({
    scoreSnapshot: {
      generatedAt: "2026-04-11T13:00:00.000Z",
      scores: [
        {
          routeKey: "base:0xwbtc->bob:0xwbtc",
          amount: "10000",
          executableNetEdgeUsd: 0.5,
          executableNetEdgePct: 0.01,
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
        {
          routeKey: "base:0xwbtc->bob:0xwbtc",
          amount: "25000",
          executableNetEdgeUsd: 0.8,
          executableNetEdgePct: 0.012,
          dataGaps: [],
          routeStats: { failureRate: 0.01 },
        },
      ],
    },
    shadowObservations: [
      {
        routeKey: "base:0xwbtc->bob:0xwbtc",
        amount: "10000",
        observedAt: "2026-04-11T13:00:00.000Z",
        observedEdgePct: 0.02,
        requiredEdgePct: 0.01,
      },
      {
        routeKey: "base:0xwbtc->bob:0xwbtc",
        amount: "10000",
        observedAt: "2026-04-11T13:00:31.000Z",
        observedEdgePct: 0.02,
        requiredEdgePct: 0.01,
      },
      {
        routeKey: "base:0xwbtc->bob:0xwbtc",
        amount: "25000",
        observedAt: "2026-04-11T13:01:00.000Z",
        observedEdgePct: 0.02,
        requiredEdgePct: 0.01,
      },
      {
        routeKey: "base:0xwbtc->bob:0xwbtc",
        amount: "25000",
        observedAt: "2026-04-11T13:01:31.000Z",
        observedEdgePct: 0.02,
        requiredEdgePct: 0.01,
      },
    ],
  });

  assert.equal(summary.multiLevelCandidateCount, 1);
  assert.equal(summary.bestCandidate.classification, "multi_level_candidate");
});

test("edge research keeps Ethereum L1 routes out of best-candidate promotion", () => {
  const summary = buildEdgeResearchSummary({
    scoreSnapshot: {
      generatedAt: "2026-04-11T13:00:00.000Z",
      scores: [
        {
          routeKey: "ethereum:0x2260->base:0x0555",
          amount: "10000",
          executableNetEdgeUsd: 1.2,
          executableNetEdgePct: 0.02,
          tradeReadiness: ETHEREUM_L1_PHASE_DISABLED_REASON,
          dataGaps: [],
          routeStats: { failureRate: 0 },
        },
      ],
    },
    shadowObservations: [],
  });

  assert.equal(summary.policyBlockedCount, 1);
  assert.equal(summary.bestCandidate, null);
  assert.equal(summary.routes[0].classification, ETHEREUM_L1_POLICY_BLOCKED_CLASSIFICATION);
});
