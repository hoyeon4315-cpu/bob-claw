// Deterministic report-only planner that converts existing selector family
// action classifications into remediation lanes. It does not sign, enqueue,
// mutate runtime state, or create live eligibility.

export const ACTION_LANES = Object.freeze([
  "receipt_reconciliation",
  "capital_refill",
  "claim_harvest",
  "exit_redeem",
  "entry_candidate",
  "producer_backlog",
  "policy_review",
  "sync_repair",
  "waitlist",
]);

export const ACTION_CLASS_TO_LANE = Object.freeze({
  RECONCILE_RECEIPT_REQUIRED: "receipt_reconciliation",
  REFILL_REQUIRED: "capital_refill",
  CLAIM_OR_HARVEST_REQUIRED: "claim_harvest",
  EXIT_OR_REDEEM_REQUIRED: "exit_redeem",
  ENTERABLE_NOW: "entry_candidate",
  BLOCKED_BY_MISSING_PRODUCER: "producer_backlog",
  POLICY_SEMANTIC_DEFECT_CANDIDATE: "policy_review",
  BLOCKED_BY_POLICY_SAFETY: "policy_review",
  BLOCKED_BY_GOVERNING_SYNC_MISMATCH: "sync_repair",
  TRUE_NO_TRADE_ECONOMICS: "waitlist",
  TRUE_HOLD_NOOP: "waitlist",
});

const LANE_BASE_PRIORITY = Object.freeze({
  receipt_reconciliation: 10,
  capital_refill: 20,
  claim_harvest: 30,
  exit_redeem: 40,
  entry_candidate: 50,
  sync_repair: 60,
  producer_backlog: 70,
  policy_review: 80,
  waitlist: 90,
});

const LANE_COMMANDS = Object.freeze({
  receipt_reconciliation: "npm run report:receipt-ledger -- --json",
  capital_refill: "node src/cli/plan-capital-manager-refill-jobs.mjs --json",
  claim_harvest: "node src/cli/report-merkl-user-rewards.mjs --json",
  exit_redeem: "node src/cli/report-strategy-execution-surfaces.mjs --json",
  entry_candidate: "node src/cli/run-all-source-deployment-selector.mjs --json",
  sync_repair: "node src/cli/run-all-source-deployment-selector.mjs --json",
});

const LANE_REQUIRED_EVIDENCE = Object.freeze({
  receipt_reconciliation: ["receipt_ledger", "signer_audit_record", "reconciliation_status"],
  capital_refill: ["refill_planner_output", "funding_source_method", "policy_cost_guard"],
  claim_harvest: ["claimHarvestSummary", "claimable_amount", "claim_binding"],
  exit_redeem: ["executableActionPath", "position_mark", "exit_or_redeem_producer"],
  entry_candidate: ["signerIntentReadyCount", "policy_eligible_candidate", "existing_committed_caps"],
  producer_backlog: ["missingProducer_or_missingBinding", "source_family", "required_producer_contract"],
  policy_review: ["policy_key_or_function", "safe_case_regression_test", "unsafe_case_regression_test"],
  sync_repair: ["same_bundle_selector", "same_bundle_governing_surface", "field_agreement_proof"],
  waitlist: ["economic_inputs", "current_governing_field", "next_refresh_trigger"],
});

const LANE_SAFETY_BLOCKERS = Object.freeze({
  entry_candidate: ["live_execution_not_enabled_by_planner"],
  policy_review: ["policy_review_required"],
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function laneForActionClass(actionClass) {
  return ACTION_CLASS_TO_LANE[actionClass] || "sync_repair";
}

function bindingFromMissingProducer(missingProducer) {
  if (!missingProducer) return null;
  const text = String(missingProducer);
  if (text.includes("::binding_executor_unregistered")) {
    return text.slice(0, text.indexOf("::binding_executor_unregistered")) || null;
  }
  if (text.includes("::exit_executor_unbound")) {
    return text.slice(0, text.indexOf("::exit_executor_unbound")) || null;
  }
  return null;
}

function sourceTruthStatusFor(row, lane) {
  if (lane === "producer_backlog") return "blocked_missing_producer";
  if (lane === "policy_review") return "blocked_policy_or_semantic_review";
  if (lane === "sync_repair") return "blocked_governing_sync_mismatch";
  if (lane === "waitlist") return "waiting_for_economic_or_hold_change";
  if (row.actionClass === "ENTERABLE_NOW") return "dry_run_candidate_only";
  return "dry_run_plannable";
}

function priorityFor(row, lane, canDryRun) {
  let priority = LANE_BASE_PRIORITY[lane] || 100;
  if (canDryRun) priority -= 5;
  if (finiteNumber(row.signerIntentReadyCount, 0) > 0) priority -= 3;
  if (finiteNumber(row.policyEligibleCandidateCount, 0) > 0) priority -= 2;
  if (finiteNumber(row.evPositiveCandidateCount, 0) > 0) priority -= 1;
  if (row.governingFieldPath) priority -= 1;
  if (row.missingProducer) priority += 2;
  return priority;
}

function laneItemFromActionRow(row) {
  const lane = laneForActionClass(row.actionClass);
  const suggestedDryRunCommand = LANE_COMMANDS[lane] || null;
  const canDryRun = Boolean(suggestedDryRunCommand);
  const missingBinding = row.missingBinding || bindingFromMissingProducer(row.missingProducer);
  const safetyBlockers = [...(LANE_SAFETY_BLOCKERS[lane] || [])];
  return {
    lane,
    family: row.family || "unknown",
    priority: priorityFor(row, lane, canDryRun),
    actionClass: row.actionClass || null,
    reason: row.reason || "unclassified_selector_reason",
    governingFieldPath: row.governingFieldPath || `familyActionTable[family=${row.family || "unknown"}].actionClass`,
    canDryRun,
    suggestedDryRunCommand,
    canLive: false,
    currentLiveEligible: false,
    selectedMode: canDryRun ? "dry_run" : "analysis",
    allowedToExecuteLive: false,
    liveExecutionAuthority: "none",
    missingProducer: row.missingProducer || null,
    missingBinding,
    requiredEvidence: [...(LANE_REQUIRED_EVIDENCE[lane] || ["same_bundle_governing_evidence"])],
    safetyBlockers,
    sourceTruthStatus: sourceTruthStatusFor(row, lane),
  };
}

function laneCounts(items) {
  const counts = Object.fromEntries(ACTION_LANES.map((lane) => [lane, 0]));
  for (const item of items) counts[item.lane] = (counts[item.lane] || 0) + 1;
  return counts;
}

export function buildDryRunRemediationPlan({ selectorReport = {} } = {}) {
  const familyActionRows = array(selectorReport.familyActionTable);
  const actionLaneQueue = familyActionRows
    .map(laneItemFromActionRow)
    .sort((left, right) => left.priority - right.priority || left.family.localeCompare(right.family));
  const families = new Set(actionLaneQueue.map((item) => item.family));
  return {
    generatedAt: selectorReport.generatedAt || new Date(0).toISOString(),
    status: actionLaneQueue.length > 0 ? "ACTION_LANE_QUEUE_READY" : "NO_FAMILY_ACTION_INPUT",
    laneCounts: laneCounts(actionLaneQueue),
    familyCount: families.size,
    actionItemCount: actionLaneQueue.length,
    familiesAssignedExactlyOnce: families.size === actionLaneQueue.length,
    actionLaneQueue,
    safety: {
      reportOnly: true,
      canLiveDefault: false,
      allowedToExecuteLive: false,
      liveExecutionAuthority: "none",
      signerCalled: false,
      runtimeStateMutated: false,
      autoExecuteChanged: false,
    },
  };
}
