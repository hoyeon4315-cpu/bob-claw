import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDevAgentAutomationBridge,
  summarizeDevAgentAutomationBridge,
} from "../src/strategy/dev-agent-automation-bridge.mjs";

const NOW = "2026-05-03T00:00:00.000Z";

function workOrder(overrides = {}) {
  return {
    schemaVersion: 1,
    rank: 1,
    candidateId: "base-route-gap",
    candidateLabel: "Base route gap",
    chain: "base",
    action: "build_route_adapter",
    status: "ready_for_coding",
    reason: "gateway_route_missing",
    expectedNetProfitUsd: 8,
    estimatedBuildCostUsd: 3,
    estimatedNetAfterBuildUsd: 5,
    sourceBlockers: ["gateway_route_missing", "missing_unwind_plan"],
    resolves: ["gateway_route_missing"],
    remainingBlockers: ["missing_unwind_plan"],
    safety: {
      requiresCommittedDiff: true,
      runtimeMutation: false,
      signerBypass: false,
      allowedToAutocode: true,
      allowedToExecuteLive: false,
      liveExecutionAuthority: "none",
      policyPipelineRequired: true,
      llmSigningAllowed: false,
    },
    implementationPlan: {
      strategyId: "base-route-gap",
      chain: "base",
      writeScope: ["src/strategy/", "src/executor/policy/", "test/"],
      requiredTests: ["route adapter test"],
      steps: ["Add missing route adapter."],
    },
    ...overrides,
  };
}

test("dev-agent bridge converts remediation work orders into safe coding task specs", () => {
  const report = buildDevAgentAutomationBridge({
    routeRemediation: {
      generatedAt: NOW,
      workOrders: [workOrder()],
      blockedCandidates: [],
    },
    autonomousDiscoveryBoard: {
      opportunities: [],
      summary: { opportunityCount: 0 },
    },
    now: NOW,
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.generatedAt, NOW);
  assert.equal(report.mode, "dev_agent_task_queue");
  assert.equal(report.summary.taskCount, 1);
  assert.equal(report.summary.readyTaskCount, 1);
  assert.equal(report.summary.liveExecutableTaskCount, 0);
  assert.equal(report.modelPolicy.runtimeAuthority, "none");
  assert.equal(report.modelPolicy.llmMaySign, false);
  assert.equal(report.modelPolicy.llmMayCallSigner, false);
  assert.equal(report.modelPolicy.llmMayMutateRuntimeCaps, false);
  assert.equal(report.modelPolicy.llmMayDecidePaybackRuntime, false);

  const [task] = report.tasks;
  assert.equal(task.id, "dev-agent:route-remediation:base-route-gap:build_route_adapter");
  assert.equal(task.kind, "route_coding");
  assert.equal(task.queueStatus, "ready_for_dev_agent");
  assert.equal(task.source.kind, "route_remediation_work_order");
  assert.equal(task.safety.artifactOnly, true);
  assert.equal(task.safety.allowedToExecuteLive, false);
  assert.equal(task.safety.signerBypass, false);
  assert.equal(task.safety.llmSigningAllowed, false);
  assert.equal(task.safety.requiresCommittedDiff, true);
  assert.deepEqual(task.writeScope, ["src/strategy/", "src/executor/policy/", "test/"]);
  assert.deepEqual(task.requiredTests, ["route adapter test"]);
  assert.ok(task.instructions.some((line) => line.includes("proposer -> policy -> signer")));
});

test("dev-agent bridge converts discovery opportunities and de-duplicates remediation-covered items", () => {
  const report = buildDevAgentAutomationBridge({
    routeRemediation: {
      workOrders: [workOrder({ candidateId: "base:wrapped_btc_lending:route_development" })],
    },
    autonomousDiscoveryBoard: {
      opportunities: [
        {
          selectionRank: 1,
          id: "base:wrapped_btc_lending:route_development",
          lane: "route_development",
          type: "route_development",
          label: "Base wrapped BTC route composition",
          chain: "base",
          status: "composed_route_ready",
          selectionScore: 0.92,
          priorityScore: 0.86,
          blockers: [],
          reason: "composed_route_ready",
          nextAction: {
            code: "review_destination_allocation_plan",
            command: "npm run report:destination-allocation-plan -- --write",
          },
          researchLoop: { recommendedDecision: "keep" },
        },
        {
          selectionRank: 2,
          id: "btc_route_gap_base",
          lane: "route_gap",
          type: "route_gap",
          label: "BTC route gap (Base)",
          chain: "base",
          status: "single_provider_gap",
          selectionScore: 0.72,
          priorityScore: 0.68,
          blockers: ["dst_odos_chain_not_supported"],
          nextAction: {
            code: "scan_btc_quote_surface",
            command: "npm run scan:quote-surface -- --family=btc",
          },
          researchLoop: { recommendedDecision: "watch" },
        },
        {
          selectionRank: 3,
          id: "base:strategy-discovery",
          lane: "destination",
          type: "destination_candidate",
          label: "Base strategy discovery",
          chain: "base",
          status: "research_queue",
          selectionScore: 0.5,
          priorityScore: 0.44,
          blockers: ["economics_missing"],
          nextAction: {
            code: "measure_numeric_economics",
            command: "npm run report:destination-economics-queue -- --write",
          },
          researchLoop: { recommendedDecision: "keep" },
        },
      ],
    },
    now: NOW,
  });

  assert.deepEqual(report.tasks.map((task) => task.kind), [
    "route_coding",
    "route_finding",
    "strategy_discovery",
  ]);
  assert.equal(report.tasks.filter((task) => task.source.opportunityId === "base:wrapped_btc_lending:route_development").length, 1);
  assert.equal(report.tasks[1].safeCommands[0], "npm run scan:quote-surface -- --family=btc");
  assert.equal(report.tasks[1].safety.allowedToExecuteLive, false);
  assert.equal(report.tasks[2].safeCommands[0], "npm run report:destination-economics-queue -- --write");

  const summary = summarizeDevAgentAutomationBridge(report);
  assert.equal(summary.taskCount, 3);
  assert.equal(summary.kindCounts.route_coding, 1);
  assert.equal(summary.kindCounts.route_finding, 1);
  assert.equal(summary.kindCounts.strategy_discovery, 1);
  assert.equal(summary.modelPolicy.runtimeAuthority, "none");
});

test("dev-agent bridge refuses work orders that request runtime authority", () => {
  const report = buildDevAgentAutomationBridge({
    routeRemediation: {
      workOrders: [
        workOrder({
          candidateId: "unsafe",
          safety: {
            allowedToExecuteLive: true,
            signerBypass: false,
            llmSigningAllowed: false,
            runtimeMutation: false,
          },
        }),
      ],
    },
    now: NOW,
  });

  assert.equal(report.tasks.length, 0);
  assert.equal(report.rejectedItems.length, 1);
  assert.equal(report.rejectedItems[0].reason, "runtime_authority_requested");
  assert.equal(report.summary.liveExecutableTaskCount, 0);
});
