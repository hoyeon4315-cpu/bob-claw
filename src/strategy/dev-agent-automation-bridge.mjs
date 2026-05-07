export const DEFAULT_DEV_AGENT_MODEL_POLICY = Object.freeze({
  schemaVersion: 1,
  lane: "dev_automation",
  allowedRole: "coding_session_llm",
  runtimeAuthority: "none",
  artifactOnly: true,
  requiresCommittedDiff: true,
  llmMayReadRepo: true,
  llmMayWriteCode: true,
  llmMayRunTests: true,
  llmMayGenerateReports: true,
  llmMaySign: false,
  llmMayCallSigner: false,
  llmMayBypassPolicy: false,
  llmMayMutateRuntimeCaps: false,
  llmMayToggleAutoExecuteAtRuntime: false,
  llmMayDecidePaybackRuntime: false,
  deterministicRuntimeBoundary:
    "Dev-agent tasks may propose code and committed diffs only; policy validates intents and signer daemons hold keys.",
});

const BASE_SAFE_INSTRUCTIONS = Object.freeze([
  "Treat this as a coding-session task only; produce source/test diffs or reports, not live execution.",
  "Keep all future execution inside proposer -> policy -> signer; do not call signer code or construct raw signed transactions.",
  "Do not raise caps, flip runtime autoExecute state, or change payback timing/ratio outside committed config diffs and tests.",
  "Keep PnL, costs, and settlement claims evidence-backed; displayed APR is not strategy evidence.",
]);

const DEFAULT_DISCOVERY_WRITE_SCOPE = Object.freeze(["src/strategy/", "src/config/", "src/executor/policy/", "test/"]);
const DEV_AGENT_ALLOWED_LIFECYCLE_STAGES = Object.freeze([
  "proposed",
  "scoped",
  "submitted",
  "validated",
  "accepted",
  "rejected",
]);

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function countBy(items = [], selector) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function taskKindForAction(action = null) {
  if (action === "build_route_adapter" || action === "build_exit_unwind_proof" || action === "optimize_cost_route") {
    return "route_coding";
  }
  if (action === "build_protocol_binding" || action === "bind_executor") return "strategy_discovery";
  if (action === "plan_inventory_refill") return "route_finding";
  return "strategy_discovery";
}

function taskKindForOpportunity(opportunity = {}) {
  if (opportunity.lane === "route_gap") return "route_finding";
  if (opportunity.lane === "route_development") return "route_coding";
  return "strategy_discovery";
}

function queueStatusForTask({ rejected = false } = {}) {
  return rejected ? "rejected" : "ready_for_dev_agent";
}

function safeCommandFromOpportunity(opportunity = {}) {
  const command = opportunity.nextAction?.command || null;
  if (!command) return [];
  if (command.includes("executor:") || command.includes("kill:") || command.includes("live:")) return [];
  return [command];
}

function baseSafety(overrides = {}) {
  return {
    artifactOnly: true,
    allowedToAutocode: true,
    allowedToExecuteLive: false,
    liveExecutionAuthority: "none",
    requiresCommittedDiff: true,
    runtimeMutation: false,
    signerBypass: false,
    policyPipelineRequired: true,
    llmSigningAllowed: false,
    ...overrides,
  };
}

function reportOnlyLifecycle(stage = "proposed") {
  return {
    stage,
    allowedStages: [...DEV_AGENT_ALLOWED_LIFECYCLE_STAGES],
    runtimeAuthority: "none",
    requiresCommittedDiff: true,
  };
}

function runtimeAuthorityRequested(safety = {}) {
  return (
    safety.allowedToExecuteLive === true ||
    safety.runtimeMutation === true ||
    safety.signerBypass === true ||
    safety.llmSigningAllowed === true ||
    safety.liveExecutionAuthority && safety.liveExecutionAuthority !== "none"
  );
}

function sourceRef(kind, item = {}) {
  if (kind === "route_remediation_work_order") {
    return {
      kind,
      candidateId: item.candidateId || null,
      opportunityId: item.candidateId || null,
      action: item.action || null,
      rank: item.rank ?? null,
    };
  }
  return {
    kind,
    opportunityId: item.id || null,
    lane: item.lane || null,
    type: item.type || null,
    selectionRank: item.selectionRank ?? null,
  };
}

function workOrderTask(order = {}) {
  const safety = baseSafety(order.safety || {});
  if (runtimeAuthorityRequested(safety)) {
    return {
      rejected: true,
      rejectedItem: {
        source: sourceRef("route_remediation_work_order", order),
        id: order.candidateId || null,
        reason: "runtime_authority_requested",
      },
    };
  }

  const kind = taskKindForAction(order.action);
  const plan = order.implementationPlan || {};
  return {
    rejected: false,
    task: {
      schemaVersion: 1,
      id: `dev-agent:route-remediation:${order.candidateId || "unknown"}:${order.action || "unknown"}`,
      kind,
      queueStatus: queueStatusForTask(),
      title: `${order.action || "route remediation"} for ${order.candidateLabel || order.candidateId || "candidate"}`,
      objective:
        `Implement the dev-lane remediation needed for ${order.candidateLabel || order.candidateId || "candidate"} without live execution authority.`,
      priority: {
        rank: order.rank ?? null,
        score: round(order.costEfficiencyScore ?? order.estimatedNetAfterBuildUsd ?? 0),
      },
      source: sourceRef("route_remediation_work_order", order),
      lifecycle: reportOnlyLifecycle(),
      chain: order.chain || null,
      blockers: unique(order.sourceBlockers || []),
      resolves: unique(order.resolves || []),
      remainingBlockers: unique(order.remainingBlockers || []),
      economics: {
        expectedNetProfitUsd: order.expectedNetProfitUsd ?? null,
        estimatedBuildCostUsd: order.estimatedBuildCostUsd ?? null,
        estimatedNetAfterBuildUsd: order.estimatedNetAfterBuildUsd ?? null,
      },
      writeScope: unique(plan.writeScope || DEFAULT_DISCOVERY_WRITE_SCOPE),
      requiredTests: unique(plan.requiredTests || [
        "targeted unit tests for generated policy/report behavior",
      ]),
      safeCommands: [],
      instructions: unique([
        ...BASE_SAFE_INSTRUCTIONS,
        ...(plan.steps || []),
        plan.promotionRule || null,
      ]),
      modelPolicy: DEFAULT_DEV_AGENT_MODEL_POLICY,
      safety,
    },
  };
}

function opportunityTask(opportunity = {}) {
  const kind = taskKindForOpportunity(opportunity);
  return {
    rejected: false,
    task: {
      schemaVersion: 1,
      id: `dev-agent:autonomous-discovery:${opportunity.id || "unknown"}`,
      kind,
      queueStatus: queueStatusForTask(),
      title: `${opportunity.label || opportunity.id || "Discovery opportunity"}`,
      objective:
        `Turn the ${opportunity.lane || "discovery"} opportunity into evidence-backed code, reports, or route research only.`,
      priority: {
        rank: opportunity.selectionRank ?? null,
        score: round(opportunity.selectionScore ?? opportunity.priorityScore ?? 0),
      },
      source: sourceRef("autonomous_discovery_opportunity", opportunity),
      lifecycle: reportOnlyLifecycle(),
      chain: opportunity.chain || null,
      blockers: unique(opportunity.blockers || []),
      resolves: [],
      remainingBlockers: unique(opportunity.blockers || []),
      economics: {
        paper: opportunity.pnl?.paper || null,
        estimated: opportunity.pnl?.estimated || null,
        realized: opportunity.pnl?.realized || null,
      },
      writeScope: DEFAULT_DISCOVERY_WRITE_SCOPE,
      requiredTests: [
        "targeted unit tests or report fixture for the selected dev-lane change",
      ],
      safeCommands: safeCommandFromOpportunity(opportunity),
      instructions: unique([
        ...BASE_SAFE_INSTRUCTIONS,
        opportunity.nextAction?.code ? `Start from nextAction=${opportunity.nextAction.code}.` : null,
        opportunity.reason ? `Current reason: ${opportunity.reason}.` : null,
      ]),
      modelPolicy: DEFAULT_DEV_AGENT_MODEL_POLICY,
      safety: baseSafety(),
    },
  };
}

function sortTasks(left, right) {
  const leftRank = Number.isFinite(left.priority?.rank) ? left.priority.rank : Number.POSITIVE_INFINITY;
  const rightRank = Number.isFinite(right.priority?.rank) ? right.priority.rank : Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if ((right.priority?.score ?? 0) !== (left.priority?.score ?? 0)) {
    return (right.priority?.score ?? 0) - (left.priority?.score ?? 0);
  }
  return String(left.id).localeCompare(String(right.id));
}

export function summarizeDevAgentAutomationBridge(report = {}) {
  const tasks = report.tasks || [];
  return {
    schemaVersion: 1,
    generatedAt: report.generatedAt || null,
    taskCount: tasks.length,
    readyTaskCount: tasks.filter((task) => task.queueStatus === "ready_for_dev_agent").length,
    rejectedCount: (report.rejectedItems || []).length,
    liveExecutableTaskCount: tasks.filter((task) => task.safety?.allowedToExecuteLive === true).length,
    lifecycleStageCounts: countBy(tasks, (task) => task.lifecycle?.stage),
    kindCounts: countBy(tasks, (task) => task.kind),
    sourceCounts: countBy(tasks, (task) => task.source?.kind),
    topTask: tasks[0]
      ? {
          id: tasks[0].id,
          kind: tasks[0].kind,
          source: tasks[0].source,
          score: tasks[0].priority?.score ?? null,
        }
      : null,
    modelPolicy: {
      runtimeAuthority: DEFAULT_DEV_AGENT_MODEL_POLICY.runtimeAuthority,
      artifactOnly: DEFAULT_DEV_AGENT_MODEL_POLICY.artifactOnly,
      llmMaySign: DEFAULT_DEV_AGENT_MODEL_POLICY.llmMaySign,
      llmMayCallSigner: DEFAULT_DEV_AGENT_MODEL_POLICY.llmMayCallSigner,
      llmMayMutateRuntimeCaps: DEFAULT_DEV_AGENT_MODEL_POLICY.llmMayMutateRuntimeCaps,
      llmMayDecidePaybackRuntime: DEFAULT_DEV_AGENT_MODEL_POLICY.llmMayDecidePaybackRuntime,
    },
  };
}

export function buildDevAgentAutomationBridge({
  autonomousDiscoveryBoard = null,
  routeRemediation = null,
  now = new Date().toISOString(),
  limit = null,
} = {}) {
  const taskResults = [];
  const rejectedItems = [];
  const remediationOpportunityIds = new Set();

  for (const order of routeRemediation?.workOrders || []) {
    const result = workOrderTask(order);
    if (result.rejected) {
      rejectedItems.push(result.rejectedItem);
      continue;
    }
    taskResults.push(result.task);
    if (order.candidateId) remediationOpportunityIds.add(order.candidateId);
  }

  for (const opportunity of autonomousDiscoveryBoard?.opportunities || []) {
    if (remediationOpportunityIds.has(opportunity.id)) continue;
    const result = opportunityTask(opportunity);
    taskResults.push(result.task);
  }

  const sorted = taskResults.sort(sortTasks);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
  const tasks = safeLimit ? sorted.slice(0, safeLimit) : sorted;
  const report = {
    schemaVersion: 1,
    generatedAt: now,
    mode: "dev_agent_task_queue",
    modelPolicy: DEFAULT_DEV_AGENT_MODEL_POLICY,
    sourceReports: {
      autonomousDiscoveryBoardGeneratedAt: autonomousDiscoveryBoard?.generatedAt || null,
      routeRemediationGeneratedAt: routeRemediation?.generatedAt || null,
    },
    tasks,
    rejectedItems,
  };
  return {
    ...report,
    summary: summarizeDevAgentAutomationBridge(report),
  };
}
