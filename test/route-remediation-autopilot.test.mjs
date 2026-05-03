import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRouteRemediationAutopilot,
  evaluateRouteRemediationOverfit,
  summarizeRouteRemediationAutopilot,
} from "../src/strategy/route-remediation-autopilot.mjs";
import {
  candidatesFromCampaignReport,
  candidatesFromDeterministicReport,
} from "../src/cli/report-route-remediation-autopilot.mjs";
import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../src/config/gateway-destinations.mjs";

function viableCandidate(overrides = {}) {
  return {
    id: "base-cbbtc-loop",
    label: "Base cbBTC loop",
    chain: "base",
    protocol: "moonwell",
    expectedNetProfitUsd: 8,
    estimatedBuildCostUsd: 2,
    blockers: ["gateway_route_missing", "missing_unwind_plan"],
    evidence: {
      sampleCount: 8,
      distinctOpportunityCount: 3,
      distinctChainCount: 2,
      distinctProtocolCount: 2,
      distinctWindowCount: 2,
      evidenceSourceCount: 2,
      measuredP90RoundTripCostUsd: 0.08,
      costVarianceBps: 45,
    },
    ...overrides,
  };
}

test("route remediation autopilot ranks cost-efficient route adapter work first", () => {
  const report = buildRouteRemediationAutopilot({
    candidates: [
      viableCandidate({
        id: "higher-build-cost",
        expectedNetProfitUsd: 12,
        estimatedBuildCostUsd: 10,
        blockers: ["executor_not_bound"],
      }),
      viableCandidate({
        id: "cheap-route-gap",
        expectedNetProfitUsd: 8,
        estimatedBuildCostUsd: 2,
        blockers: ["gateway_route_missing", "missing_unwind_plan"],
      }),
    ],
    now: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(report.status, "actionable");
  assert.equal(report.workOrders[0].candidateId, "cheap-route-gap");
  assert.equal(report.workOrders[0].action, "build_route_adapter");
  assert.equal(report.workOrders[0].estimatedNetAfterBuildUsd, 6);
  assert.equal(report.workOrders[0].safety.requiresCommittedDiff, true);
  assert.equal(report.workOrders[0].safety.runtimeMutation, false);
  assert.equal(report.workOrders[0].safety.signerBypass, false);
  assert.equal(report.workOrders[0].safety.allowedToExecuteLive, false);
});

test("overfit guard blocks displayed APR and single-sample candidates", () => {
  const guard = evaluateRouteRemediationOverfit(
    viableCandidate({
      id: "apr-only",
      displayedAprOnly: true,
      expectedNetProfitUsd: 50,
      evidence: {
        sampleCount: 1,
        distinctOpportunityCount: 1,
        distinctChainCount: 1,
        distinctProtocolCount: 1,
        distinctWindowCount: 1,
        evidenceSourceCount: 1,
        measuredP90RoundTripCostUsd: null,
        costVarianceBps: null,
      },
    }),
  );

  assert.equal(guard.passed, false);
  assert.ok(guard.blockers.includes("displayed_apr_only_not_strategy_evidence"));
  assert.ok(guard.blockers.includes("insufficient_distinct_opportunity_evidence"));
  assert.ok(guard.blockers.includes("insufficient_independent_evidence_sources"));

  const report = buildRouteRemediationAutopilot({ candidates: [guard.candidate] });
  assert.equal(report.status, "blocked");
  assert.equal(report.workOrders.length, 0);
  assert.equal(report.blockedCandidates[0].id, "apr-only");
});

test("route remediation maps protocol and executor blockers without live execution authority", () => {
  const report = buildRouteRemediationAutopilot({
    candidates: [
      viableCandidate({
        id: "protocol-gap",
        chain: "unichain",
        blockers: ["stable_loop_protocol_adapter_not_built", "missing_unwind_plan"],
      }),
      viableCandidate({
        id: "executor-gap",
        chain: "optimism",
        blockers: ["executor_not_bound", "missing_unwind_plan"],
      }),
    ],
  });
  const actionsByCandidate = new Map(report.workOrders.map((order) => [order.candidateId, order.action]));

  assert.equal(actionsByCandidate.get("protocol-gap"), "build_protocol_binding");
  assert.equal(actionsByCandidate.get("executor-gap"), "bind_executor");
  for (const order of report.workOrders) {
    assert.equal(order.safety.requiresCommittedDiff, true);
    assert.equal(order.safety.runtimeMutation, false);
    assert.equal(order.safety.signerBypass, false);
    assert.equal(order.safety.allowedToExecuteLive, false);
  }
});

test("route remediation does not auto-code unsupported Gateway destinations", () => {
  const report = buildRouteRemediationAutopilot({
    candidates: [
      viableCandidate({
        id: "arbitrum-gap",
        chain: "arbitrum",
        executionPath: "post_gateway_manual_bridge",
        blockers: ["gateway_route_missing"],
      }),
    ],
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.workOrders.length, 0);
  assert.equal(report.blockedCandidates[0].blockers[0], "chain_not_gateway_official");
});

test("route remediation permits every official Gateway destination under the same evidence gate", () => {
  for (const chain of OFFICIAL_GATEWAY_DESTINATION_CHAINS) {
    const guard = evaluateRouteRemediationOverfit(
      viableCandidate({
        id: `${chain}-candidate`,
        chain,
      }),
    );
    assert.equal(guard.passed, true, chain);
  }
});

test("route remediation normalizes official destination aliases before scope checks", () => {
  const guard = evaluateRouteRemediationOverfit(
    viableCandidate({
      chain: "BNB Chain",
    }),
  );

  assert.equal(guard.passed, true);
  assert.equal(guard.chain, "bsc");
});

test("route remediation blocks single-chain and single-protocol overfit", () => {
  const guard = evaluateRouteRemediationOverfit(
    viableCandidate({
      evidence: {
        sampleCount: 8,
        distinctOpportunityCount: 4,
        distinctChainCount: 1,
        distinctProtocolCount: 1,
        distinctWindowCount: 3,
        evidenceSourceCount: 2,
        measuredP90RoundTripCostUsd: 0.08,
        costVarianceBps: 45,
      },
    }),
  );

  assert.equal(guard.passed, false);
  assert.ok(guard.blockers.includes("insufficient_chain_or_protocol_breadth"));
});

test("route remediation collapses duplicate opportunity evidence", () => {
  const guard = evaluateRouteRemediationOverfit(
    viableCandidate({
      evidence: {
        sampleCount: 8,
        evidenceSamples: [
          { opportunityId: "same", chain: "base", protocol: "moonwell", source: "merkl", windowId: "w1" },
          { opportunityId: "same", chain: "base", protocol: "moonwell", source: "defillama", windowId: "w1" },
          { opportunityId: "same", chain: "base", protocol: "moonwell", source: "receipt", windowId: "w2" },
        ],
        measuredP90RoundTripCostUsd: 0.08,
        costVarianceBps: 45,
      },
    }),
  );

  assert.equal(guard.passed, false);
  assert.ok(guard.blockers.includes("insufficient_distinct_opportunity_evidence"));
  assert.equal(guard.evidence.distinctOpportunityCount, 1);
});

test("route remediation blocks missing cost variance and edge inside variance buffer", () => {
  const missingVariance = evaluateRouteRemediationOverfit(
    viableCandidate({
      evidence: {
        sampleCount: 8,
        distinctOpportunityCount: 4,
        distinctChainCount: 2,
        distinctProtocolCount: 2,
        distinctWindowCount: 2,
        evidenceSourceCount: 2,
        measuredP90RoundTripCostUsd: 1,
        costVarianceBps: null,
      },
    }),
  );
  assert.equal(missingVariance.passed, false);
  assert.ok(missingVariance.blockers.includes("cost_variance_unmeasured"));

  const thinEdge = evaluateRouteRemediationOverfit(
    viableCandidate({
      expectedNetProfitUsd: 0.02,
      evidence: {
        sampleCount: 8,
        distinctOpportunityCount: 4,
        distinctChainCount: 2,
        distinctProtocolCount: 2,
        distinctWindowCount: 2,
        evidenceSourceCount: 2,
        measuredP90RoundTripCostUsd: 2,
        costVarianceBps: 200,
      },
    }),
  );
  assert.equal(thinEdge.passed, false);
  assert.ok(thinEdge.blockers.includes("edge_not_above_cost_variance_buffer"));
});

test("route remediation summary aggregates action and overfit blockers", () => {
  const report = buildRouteRemediationAutopilot({
    candidates: [
      viableCandidate({ id: "route-gap", blockers: ["gateway_route_missing", "missing_unwind_plan"] }),
      viableCandidate({ id: "unwind-gap", blockers: ["missing_unwind_plan", "source_inventory_below_target_amount"] }),
      viableCandidate({
        id: "apr-only",
        displayedAprOnly: true,
        evidence: {
          sampleCount: 1,
          distinctOpportunityCount: 1,
          distinctChainCount: 1,
          distinctProtocolCount: 1,
          distinctWindowCount: 1,
          evidenceSourceCount: 1,
        },
      }),
    ],
  });
  const summary = summarizeRouteRemediationAutopilot(report);

  assert.equal(summary.workOrderCount, 2);
  assert.equal(summary.blockedCandidateCount, 1);
  assert.equal(summary.actionCounts.build_route_adapter, 1);
  assert.equal(summary.actionCounts.build_exit_unwind_proof, 1);
  assert.equal(summary.overfitBlockerCounts.displayed_apr_only_not_strategy_evidence, 1);
  assert.equal(summary.breadth.distinctChainCount, 2);
  assert.equal(summary.breadth.distinctProtocolCount, 2);
  assert.equal(summary.breadth.costVarianceCoverageCount, 2);
});

test("route remediation summary does not count null cost variance as covered", () => {
  const report = buildRouteRemediationAutopilot({
    candidates: [
      viableCandidate({
        id: "null-variance",
        evidence: {
          sampleCount: 8,
          distinctOpportunityCount: 4,
          distinctChainCount: 2,
          distinctProtocolCount: 2,
          distinctWindowCount: 2,
          evidenceSourceCount: 2,
          measuredP90RoundTripCostUsd: 1,
          costVarianceBps: null,
        },
      }),
    ],
  });
  const summary = summarizeRouteRemediationAutopilot(report);

  assert.equal(summary.breadth.costVarianceCoverageCount, 0);
});

test("route remediation groups campaign blockers into family-level evidence", () => {
  const candidates = candidatesFromCampaignReport({
    candidates: [
      {
        chain: "base",
        protocol: "superform",
        opportunityId: "one",
        operatorExpectedNetProfitUsd: 2,
        estimatedGasClaimSwapBridgeCostUsd: 0.012,
        campaignAgeHours: 100,
        hoursRemaining: 200,
        blockers: ["protocol_not_bound"],
      },
      {
        chain: "optimism",
        protocol: "quickswap",
        opportunityId: "two",
        operatorExpectedNetProfitUsd: 3,
        estimatedGasClaimSwapBridgeCostUsd: 0.02,
        campaignAgeHours: 130,
        hoursRemaining: 240,
        blockers: ["protocol_not_bound"],
      },
      {
        chain: "base",
        protocol: "glider",
        opportunityId: "three",
        operatorExpectedNetProfitUsd: 4,
        estimatedGasClaimSwapBridgeCostUsd: 0.015,
        campaignAgeHours: 200,
        hoursRemaining: 320,
        blockers: ["protocol_not_bound"],
      },
    ],
  });
  const family = candidates.find((candidate) => candidate.id === "campaign:protocol-binding-gaps");

  assert.ok(family);
  assert.equal(family.expectedNetProfitUsd, 9);
  assert.equal(family.evidence.sampleCount, 3);
  assert.equal(family.evidence.distinctOpportunityCount, 3);
  assert.equal(family.evidence.distinctChainCount, 2);
  assert.equal(family.evidence.distinctProtocolCount, 3);
  assert.equal(family.evidence.distinctWindowCount, 3);
  assert.equal(family.evidence.evidenceSourceCount, 2);
  assert.equal(Number.isFinite(family.evidence.costVarianceBps), true);

  const report = buildRouteRemediationAutopilot({
    candidates,
    policy: {
      minSampleCount: 2,
      minDistinctOpportunityCount: 2,
      minDistinctChainCount: 2,
      minDistinctProtocolCount: 2,
      minDistinctWindowCount: 2,
      minBlockerFamilyCount: 1,
      minEvidenceSourceCount: 2,
      maxCostVarianceBps: 6000,
      defaultBuildCostUsd: { build_protocol_binding: 4 },
    },
  });

  assert.equal(report.status, "actionable");
  assert.equal(report.workOrders[0].candidateId, "campaign:protocol-binding-gaps");
  assert.equal(report.workOrders[0].action, "build_protocol_binding");
  assert.equal(report.workOrders[0].safety.allowedToExecuteLive, false);
});

test("route remediation keeps a single campaign gap blocked after family mapping", () => {
  const candidates = candidatesFromCampaignReport({
    candidates: [
      {
        chain: "base",
        protocol: "superform",
        opportunityId: "one",
        operatorExpectedNetProfitUsd: 8,
        estimatedGasClaimSwapBridgeCostUsd: 0.012,
        campaignAgeHours: 100,
        hoursRemaining: 200,
        blockers: ["protocol_not_bound"],
      },
    ],
  });
  const report = buildRouteRemediationAutopilot({ candidates });

  assert.equal(report.workOrders.length, 0);
  assert.ok(
    report.blockedCandidates.some((candidate) =>
      candidate.id === "campaign:protocol-binding-gaps" &&
      candidate.blockers.includes("insufficient_distinct_opportunity_evidence"),
    ),
  );
});

test("route remediation maps deterministic protocolTrack breadth only from explicit metadata", () => {
  const [mapped] = candidatesFromDeterministicReport({
    candidates: [
      {
        id: "eth-destination",
        chain: "ethereum",
        blockers: ["protocol_binding_missing"],
        expectedNetProfitUsd: 12,
        evidence: {
          sampleCount: 3,
          distinctOpportunityCount: 2,
          distinctWindowCount: 2,
          evidenceSourceCount: 2,
          measuredP90RoundTripCostUsd: 0.5,
          costVarianceBps: 100,
          protocolTrack: {
            chains: ["ethereum", "base"],
            protocols: ["aave", "morpho"],
          },
        },
      },
    ],
  });
  const guard = evaluateRouteRemediationOverfit(mapped, {
    minBlockerFamilyCount: 1,
  });

  assert.equal(mapped.evidence.distinctChainCount, 2);
  assert.equal(mapped.evidence.distinctProtocolCount, 2);
  assert.equal(guard.passed, true);
});
