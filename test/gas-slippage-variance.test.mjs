import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGasSlippageVarianceArtifact, summarizeGasSlippageVarianceArtifact } from "../src/risk/gas-slippage-variance.mjs";

function receipt({
  routeKey,
  amount = "10000",
  pnl,
  estimatedNetPnlUsd,
  estimatedOutputUsd = 10.5,
  actualOutputUsd = 10.3,
  gasDriftUsd = 0.02,
}) {
  return {
    observedAt: "2026-04-15T00:00:00.000Z",
    routeContext: {
      routeKey,
      amount,
      srcChain: "bob",
      dstChain: "base",
      estimatedNetPnlUsd,
      estimatedOutputUsd,
    },
    output: {
      actualOutputUsd,
    },
    realized: {
      realizedNetPnlUsd: pnl,
      gasDriftUsd,
    },
  };
}

test("gas and slippage variance report combines shadow and receipt dispersion into a policy floor", () => {
  const artifact = buildGasSlippageVarianceArtifact({
    shadowObservations: [
      {
        observedAt: "2026-04-15T00:00:00.000Z",
        routeKey: "bob:0x1->base:0x1",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
        effectiveSystemNetPnlUsd: 0.4,
        observedEdgeUsd: 0.45,
        executionGasUsd: 0.1,
      },
      {
        observedAt: "2026-04-15T01:00:00.000Z",
        routeKey: "bob:0x1->base:0x1",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
        effectiveSystemNetPnlUsd: 0.5,
        observedEdgeUsd: 0.52,
        executionGasUsd: 0.12,
      },
      {
        observedAt: "2026-04-15T02:00:00.000Z",
        routeKey: "bob:0x1->base:0x1",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
        effectiveSystemNetPnlUsd: 0.6,
        observedEdgeUsd: 0.63,
        executionGasUsd: 0.11,
      },
    ],
    receiptRecords: [
      receipt({
        routeKey: "bob:0x1->base:0x1",
        pnl: 0.2,
        estimatedNetPnlUsd: 0.4,
        actualOutputUsd: 10.28,
        gasDriftUsd: 0.02,
      }),
      receipt({
        routeKey: "bob:0x1->base:0x1",
        pnl: 0.1,
        estimatedNetPnlUsd: 0.35,
        actualOutputUsd: 10.22,
        gasDriftUsd: 0.03,
      }),
    ],
    scores: [
      {
        observedAt: "2026-04-15T02:05:00.000Z",
        routeKey: "bob:0x1->base:0x1",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
        tradeReadiness: "shadow_candidate_review_only",
        effectiveSystemNetPnlUsd: 0.55,
        executionGasUsd: 0.11,
      },
    ],
    now: "2026-04-15T02:05:00.000Z",
  });

  assert.equal(artifact.summary.routeVariantCount, 1);
  assert.equal(artifact.summary.varianceReadyRouteCount, 1);

  const route = artifact.routes[0];
  assert.equal(route.sourceMix.shadowObservationCount, 3);
  assert.equal(route.sourceMix.receiptRealizedCount, 2);
  assert.equal(route.shadowSystemNet.medianUsd, 0.5);
  assert.equal(route.receiptNetDrift.medianUsd, -0.225);
  assert.equal(route.policyNoiseFloorUsd, 0.31);

  const summary = summarizeGasSlippageVarianceArtifact(artifact);
  assert.equal(summary.topVarianceRoute.policyNoiseFloorUsd, 0.31);
  assert.equal(summary.topVarianceRoute.centerNetUsd, 0.15);
});
