// Report-only lifecycle that promotes the selected lane handler's dry-run
// result into a structured intent candidate when, and only when, the lane's
// evidence contract is complete and internally consistent with the governing
// readiness surface. Never signs, enqueues, mutates runtime state, changes
// autoExecute, or relaxes policy/cost/cap/cooldown/kill-switch gates.
//
// `canIntent:true` is a report-only lifecycle field. It is not an executable
// intent, signer input, or runtime authority and never implies `canLive:true`.

export const CANDIDATE_STATUSES = Object.freeze([
  "READY_FOR_INTENT_CANDIDATE",
  "BACKLOG_MISSING_EVIDENCE",
  "UNRESOLVED_GOVERNING_SYNC_MISMATCH",
  "UNRESOLVED_STALE_READINESS_SNAPSHOT",
]);

export const FUTURE_BACKLOG_LANES = Object.freeze([
  "receipt_reconciliation",
  "claim_harvest",
  "exit_redeem",
  "producer_backlog",
  "policy_review",
  "live_eligibility",
]);

export const READINESS_BLOCKER_CLASSES = Object.freeze([
  "method_collision",
  "destination_collision",
  "method_unspecified_collision",
  "stale_snapshot_method",
]);

export const LIFECYCLE_PRODUCERS = Object.freeze({
  refillPlanner: Object.freeze({
    module: "src/treasury/refill-job.mjs",
    function: "buildCapitalRefillJobs / computeRefillSelectedMethod",
    cli: "node src/cli/plan-capital-manager-refill-jobs.mjs --json",
  }),
  readinessRefillBlockers: Object.freeze({
    module: "src/cli/check-full-automation-readiness.mjs",
    function: "buildFullAutomationReadiness / refillBlockerDetails",
    upstreamModule: "src/status/all-chain-autopilot-slice.mjs",
    upstreamFunction: "refillBlockers",
    cli: "node src/cli/check-full-automation-readiness.mjs --json",
  }),
  laneHandler: Object.freeze({
    module: "src/strategy/lane-handler-framework.mjs",
    function: "buildLaneHandlerReport / capitalRefillDryRunIntent",
  }),
  selectorActionLaneQueue: Object.freeze({
    module: "src/strategy/all-source-deployment-selector.mjs",
    function: "buildAllSourceDeploymentSelectorReport",
  }),
});

const BACKLOG_REQUIREMENTS = Object.freeze({
  receipt_reconciliation: {
    requiredEvidence: [
      "receipt_target_identity_list",
      "ledger_or_audit_source",
      "non_mutating_dry_run_command",
      "unreconciled_broadcast_proof",
    ],
    nextStep: "declare_receipt_reconciliation_evidence_contract",
    owningProducer: {
      module: "src/executor/ingestor/*",
      cli: "npm run report:receipt-ledger -- --json",
    },
  },
  claim_harvest: {
    requiredEvidence: [
      "claimable_amount",
      "distributor_or_producer_binding",
      "cost_floor",
      "chain_readiness",
      "claim_dry_run_command",
    ],
    nextStep: "declare_claim_harvest_evidence_contract",
    owningProducer: {
      module: "src/strategy/merkl-* / src/strategy/radar/*",
      cli: "npm run report:merkl-user-rewards -- --json",
    },
  },
  exit_redeem: {
    requiredEvidence: [
      "lifecycle_evidence",
      "action_specific_expected_net_usd",
      "cost_floor",
      "receipt_truth",
      "executor_binding",
      "invalid_input_separation",
    ],
    nextStep: "declare_exit_redeem_evidence_contract",
    owningProducer: {
      module: "src/executor/merkl-portfolio-exit.mjs / src/executor/health/*",
      cli: "npm run report:strategy-execution-surfaces -- --json",
    },
  },
  producer_backlog: {
    requiredEvidence: ["missing_producer_name", "owning_module", "minimum_evidence_contract"],
    nextStep: "declare_producer_evidence_contract",
    owningProducer: {
      module: "src/strategy/family-action-classification.mjs",
      cli: "node src/cli/run-all-source-deployment-selector.mjs --json",
    },
  },
  policy_review: {
    requiredEvidence: [
      "policy_key_or_function",
      "safety_rationale",
      "allowed_case_regression_test",
      "blocked_case_regression_test",
    ],
    nextStep: "policy_review_requires_allowed_and_blocked_regression_proof",
    owningProducer: {
      module: "src/executor/policy/* / src/risk/*",
      cli: "node --test test/executor-policy-index.test.mjs",
    },
  },
  live_eligibility: {
    requiredEvidence: [
      "policy_proof",
      "cap_proof",
      "cooldown_proof",
      "signer_proof",
      "kill_switch_proof",
      "preflight_proof",
      "receipt_proof",
      "payback_proof",
    ],
    nextStep: "live_eligibility_blocked_until_intent_candidate_exists_and_gates_pass",
    owningProducer: {
      module: "src/executor/policy/index.mjs / src/executor/signer/daemon.mjs",
      cli: "node src/cli/check-full-automation-readiness.mjs --json",
    },
  },
});

const REPORT_ONLY_SAFETY = Object.freeze({
  reportOnly: true,
  canLive: false,
  runtimeAuthority: "none",
  allowedToExecuteLive: false,
  liveExecutionAuthority: "none",
  signerCalled: false,
  runtimeStateMutated: false,
  liveQueueEnqueued: false,
  autoExecuteChanged: false,
  policyRelaxed: false,
  evCostRelaxed: false,
  capRelaxed: false,
  cooldownRelaxed: false,
  killSwitchBypassed: false,
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function present(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function listMissing(map) {
  const missing = [];
  for (const [name, value] of Object.entries(map)) {
    if (!present(value)) missing.push(name);
  }
  return missing;
}

function readinessRefillBlockers(readinessReport) {
  return array(readinessReport?.liveAutomation?.refillBlockers);
}

function readinessBlockersForDestination({ readinessReport, chain, asset }) {
  if (!chain && !asset) return [];
  return readinessRefillBlockers(readinessReport).filter((entry) => {
    if (!entry) return false;
    const chainMatch = !entry.chain || !chain || entry.chain === chain;
    const assetMatch = !entry.asset || !asset || entry.asset === asset;
    return chainMatch && assetMatch;
  });
}

function classifyReadinessBlocker(blocker, plannerCandidateMethods) {
  const method = blocker.selectedMethod || null;
  if (!method) {
    return { ...blocker, mismatchClass: "destination_collision" };
  }
  if (!Array.isArray(plannerCandidateMethods) || plannerCandidateMethods.length === 0) {
    return { ...blocker, mismatchClass: "method_unspecified_collision" };
  }
  if (plannerCandidateMethods.includes(method)) {
    return { ...blocker, mismatchClass: "method_collision" };
  }
  return { ...blocker, mismatchClass: "stale_snapshot_method" };
}

const STALE_CLASSES = new Set(["stale_snapshot_method"]);
const COLLISION_CLASSES = new Set(["method_collision", "destination_collision", "method_unspecified_collision"]);

function evaluateGoverningAgreement({ handlerResult, readinessReport }) {
  const dryRunIntent = handlerResult?.dryRunIntent || {};
  const destination = dryRunIntent.destination || {};
  const handlerAgreement = dryRunIntent.governingAgreement || {};
  const plannerBlocker = dryRunIntent.blocker || null;
  const plannerCandidateMethods = array(dryRunIntent.plannerCandidateMethods);
  const rawBlockers = readinessBlockersForDestination({
    readinessReport,
    chain: destination.chain,
    asset: destination.asset,
  });
  const classifiedBlockers = rawBlockers.map((blocker) => classifyReadinessBlocker(blocker, plannerCandidateMethods));
  const liveCollisions = classifiedBlockers.filter((entry) => COLLISION_CLASSES.has(entry.mismatchClass));
  const staleBlockers = classifiedBlockers.filter((entry) => STALE_CLASSES.has(entry.mismatchClass));
  const handlerAgrees = handlerAgreement.agrees === true;
  const readinessAgrees = classifiedBlockers.length === 0;
  const onlyStaleSnapshot =
    !readinessAgrees && liveCollisions.length === 0 && staleBlockers.length === classifiedBlockers.length;
  return {
    handlerAgreement,
    plannerBlocker,
    plannerCandidateMethods,
    readinessBlockers: classifiedBlockers,
    readinessBlockerCount: classifiedBlockers.length,
    liveCollisionCount: liveCollisions.length,
    staleSnapshotCount: staleBlockers.length,
    handlerAgrees,
    readinessAgrees,
    onlyStaleSnapshot,
    agrees: handlerAgrees && readinessAgrees && plannerBlocker === null,
  };
}

function extractCandidateContext(handlerResult) {
  const item = handlerResult?.sourceQueueItem || handlerResult || {};
  const dryRunIntent = handlerResult?.dryRunIntent || {};
  return {
    item,
    dryRunIntent,
    source: dryRunIntent.source || {},
    destination: dryRunIntent.destination || {},
    costs: dryRunIntent.costs || {},
    safetyBlockers: [...array(handlerResult?.safetyBlockers)],
    canDryRun: handlerResult?.status === "READY_FOR_DRY_RUN" && Boolean(handlerResult?.canDryRun),
  };
}

function collectMissingEvidence({ canDryRun, dryRunIntent, source, destination, costs, handlerResult }) {
  const missingEvidence = listMissing({
    selectedMethod: dryRunIntent.selectedMethod,
    sourceChain: source.chain,
    sourceAsset: source.asset,
    destinationChain: destination.chain,
    destinationAsset: destination.asset,
    expectedNetUsd: dryRunIntent.expectedNetUsd,
    expectedExecutionRefillCostUsd: costs.expectedExecutionRefillCostUsd,
  });
  if (canDryRun || !Array.isArray(handlerResult?.missingInputs)) return missingEvidence;
  for (const entry of handlerResult.missingInputs) {
    if (!missingEvidence.includes(entry)) missingEvidence.push(entry);
  }
  return missingEvidence;
}

function resolveLifecycleStatus({ canDryRun, missingEvidence, governingAgreement }) {
  if (!canDryRun) {
    return {
      status: "BACKLOG_MISSING_EVIDENCE",
      canIntent: false,
      nextAutomationStep: "complete_capital_refill_dry_run_handler_evidence",
    };
  }
  if (missingEvidence.length > 0) {
    return {
      status: "BACKLOG_MISSING_EVIDENCE",
      canIntent: false,
      nextAutomationStep: "supply_missing_refill_intent_evidence_fields",
    };
  }
  if (governingAgreement.agrees) {
    return {
      status: "READY_FOR_INTENT_CANDIDATE",
      canIntent: true,
      nextAutomationStep: "await_live_eligibility_gates_after_intent_candidate",
    };
  }
  if (governingAgreement.onlyStaleSnapshot) {
    return {
      status: "UNRESOLVED_STALE_READINESS_SNAPSHOT",
      canIntent: false,
      nextAutomationStep: "rerun_autopilot_to_refresh_governing_refill_blockers",
    };
  }
  return {
    status: "UNRESOLVED_GOVERNING_SYNC_MISMATCH",
    canIntent: false,
    nextAutomationStep: "reconcile_refill_planner_and_readiness_governing_fields",
  };
}

function refillIntentCandidate({ handlerResult, readinessReport }) {
  const context = extractCandidateContext(handlerResult);
  const { item, dryRunIntent, source, destination, costs, safetyBlockers, canDryRun } = context;
  const governingAgreement = evaluateGoverningAgreement({ handlerResult, readinessReport });
  const missingEvidence = collectMissingEvidence({
    canDryRun,
    dryRunIntent,
    source,
    destination,
    costs,
    handlerResult,
  });
  const lifecycle = resolveLifecycleStatus({ canDryRun, missingEvidence, governingAgreement });

  // canLive remains false in every path; this lifecycle never promotes live.
  return {
    family: item.family || handlerResult?.family || null,
    lane: "capital_refill",
    status: lifecycle.status,
    sourceActionItem: item,
    selectedMethod: dryRunIntent.selectedMethod || null,
    executionMethod: dryRunIntent.selectedMethod || null,
    plannerCandidateMethods: [...array(dryRunIntent.plannerCandidateMethods)],
    sourceChain: source.chain || null,
    sourceAsset: source.asset || null,
    destinationChain: destination.chain || null,
    destinationAsset: destination.asset || null,
    amount: destination.targetAmount || null,
    amountDecimal: destination.targetAmountDecimal ?? null,
    amountUsd: destination.estimatedAssetValueUsd ?? null,
    expectedNetUsd: dryRunIntent.expectedNetUsd ?? null,
    costs: { ...costs },
    plannerBlocker: governingAgreement.plannerBlocker,
    readinessBlockers: governingAgreement.readinessBlockers,
    governingAgreement,
    canDryRun,
    canIntent: lifecycle.canIntent,
    canLive: false,
    reportOnly: true,
    runtimeAuthority: "none",
    allowedToExecuteLive: false,
    liveExecutionAuthority: "none",
    safetyBlockers,
    missingEvidence,
    nextAutomationStep: lifecycle.nextAutomationStep,
    producers: LIFECYCLE_PRODUCERS,
  };
}

function futureBacklogItem(lane, { handlerResults = [], handlerBacklog = [] } = {}) {
  const requirements = BACKLOG_REQUIREMENTS[lane] || {
    requiredEvidence: ["lane_specific_evidence_contract"],
    nextStep: "declare_evidence_contract_for_lane",
    owningProducer: null,
  };
  const relatedHandled = array(handlerResults).filter((entry) => entry.lane === lane);
  const relatedBacklog = array(handlerBacklog).filter((entry) => entry.lane === lane);
  const queueFamilies = Array.from(
    new Set([...relatedHandled, ...relatedBacklog].map((entry) => entry.family).filter(Boolean)),
  );
  return {
    lane,
    status: "FUTURE_HANDLER_BACKLOG",
    requiredEvidence: [...requirements.requiredEvidence],
    nextStep: requirements.nextStep,
    owningProducer: requirements.owningProducer || null,
    queueFamilies,
    handlerBacklogCount: relatedBacklog.length,
    canDryRun: false,
    canIntent: false,
    canLive: false,
    reportOnly: true,
    runtimeAuthority: "none",
    allowedToExecuteLive: false,
  };
}

function summarize(candidates, backlog) {
  let intentCandidateCount = 0;
  let canLiveCount = 0;
  let blockedCount = 0;
  let staleSnapshotCount = 0;
  let governingMismatchCount = 0;
  for (const candidate of candidates) {
    if (candidate.canIntent) intentCandidateCount += 1;
    if (candidate.canLive) canLiveCount += 1;
    if (candidate.status !== "READY_FOR_INTENT_CANDIDATE") blockedCount += 1;
    if (candidate.status === "UNRESOLVED_STALE_READINESS_SNAPSHOT") staleSnapshotCount += 1;
    if (candidate.status === "UNRESOLVED_GOVERNING_SYNC_MISMATCH") governingMismatchCount += 1;
  }
  return {
    intentCandidateCount,
    canLiveCount,
    blockedCount,
    backlogCount: backlog.length,
    staleSnapshotCount,
    governingMismatchCount,
  };
}

function reportStatus(candidates, pilotLane) {
  if (candidates.length === 0) {
    if (pilotLane === "capital_refill") return "BACKLOG_MISSING_EVIDENCE";
    return "NO_PILOT_LANE_FOR_INTENT_CANDIDATE";
  }
  return candidates[0].status;
}

export function buildLaneIntentCandidateReport({
  selectorReport = {},
  laneHandlerReport = {},
  readinessReport = {},
  now = null,
} = {}) {
  const generatedAt = now || laneHandlerReport.generatedAt || selectorReport.generatedAt || new Date(0).toISOString();
  const handlerResults = array(laneHandlerReport.handlerResults);
  const handlerBacklog = array(laneHandlerReport.handlerBacklog);
  const pilotLane = laneHandlerReport.selectedPilotLane || null;
  const laneIntentCandidates = [];
  if (pilotLane === "capital_refill") {
    const handlerResult = handlerResults.find((entry) => entry.lane === "capital_refill");
    if (handlerResult) {
      laneIntentCandidates.push(refillIntentCandidate({ handlerResult, readinessReport }));
    }
  }
  const futureHandlerBacklog = FUTURE_BACKLOG_LANES.map((lane) =>
    futureBacklogItem(lane, { handlerResults, handlerBacklog }),
  );
  return {
    generatedAt,
    status: reportStatus(laneIntentCandidates, pilotLane),
    pilotLane,
    laneIntentCandidateSummary: summarize(laneIntentCandidates, futureHandlerBacklog),
    laneIntentCandidates,
    futureHandlerBacklog,
    producers: LIFECYCLE_PRODUCERS,
    safety: { ...REPORT_ONLY_SAFETY },
  };
}
