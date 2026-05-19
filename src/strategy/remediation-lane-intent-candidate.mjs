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
  "NO_LIVE_ROUTE",
  "BACKLOG_MISSING_EVIDENCE",
  "TYPED_MISSING_EVIDENCE",
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
      "receipt_target_identity",
      "tx_hash_or_stable_broadcast_id",
      "ledger_or_audit_source",
      "dry_run_reconciliation_path_or_exact_missing_producer",
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
      "chain_token_distributor_or_exact_missing_field",
      "cost_floor",
      "claim_readiness",
      "report_only_producer_or_missing_producer",
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
      "action_specific_exit_or_redeem_expected_net_usd",
      "cost_floor",
      "executor_binding_or_exact_missing_binding",
      "invalid_or_proxy_evidence_separation",
    ],
    nextStep: "declare_exit_redeem_evidence_contract",
    owningProducer: {
      module: "src/executor/merkl-portfolio-exit.mjs / src/executor/health/*",
      cli: "npm run report:strategy-execution-surfaces -- --json",
    },
  },
  producer_backlog: {
    requiredEvidence: ["missing_producer_name", "owner_or_best_owner_guess", "minimum_evidence_contract"],
    nextStep: "declare_producer_evidence_contract",
    owningProducer: {
      module: "src/strategy/family-action-classification.mjs",
      cli: "node src/cli/run-all-source-deployment-selector.mjs --json",
    },
  },
  policy_review: {
    requiredEvidence: [
      "policy_key",
      "source_truth_state",
      "semantic_defect_candidate_reason",
      "safe_case_regression_test",
      "unsafe_case_regression_test",
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
  waitlist: {
    requiredEvidence: ["valid_wait_reason", "recheck_condition", "governing_field_path"],
    nextStep: "wait_for_recheck_condition_without_live_authority",
    owningProducer: {
      module: "src/strategy/dry-run-remediation-planner.mjs",
      cli: "node src/cli/run-all-source-deployment-selector.mjs --json",
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

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstPresent(...values) {
  for (const value of values) {
    if (present(value)) return value;
  }
  return null;
}

function listMissing(map) {
  const missing = [];
  for (const [name, value] of Object.entries(map)) {
    if (!present(value)) missing.push(name);
  }
  return missing;
}

function stableSourceRef(item = {}, lane = null) {
  return (
    item.stableSourceRef ||
    item.sourceRef ||
    item.sourceActionRef ||
    item.governingFieldPath ||
    [
      item.family || "unknown_family",
      lane || item.lane || "unknown_lane",
      item.actionClass || item.reason || "unknown_reason",
    ]
      .join(":")
      .replaceAll(/\s+/g, "_")
  );
}

function commonLaneFields({
  item = {},
  lane = item.lane || null,
  status,
  evidenceComplete = false,
  missingEvidence = [],
  canDryRun = false,
  canIntent = false,
  nextAutomationStep = null,
} = {}) {
  return {
    family: item.family || null,
    lane,
    status,
    stableSourceRef: stableSourceRef(item, lane),
    evidenceComplete: Boolean(evidenceComplete),
    missingEvidence: [...array(missingEvidence)],
    governingFieldPath: item.governingFieldPath || null,
    canDryRun: Boolean(canDryRun),
    canIntent: Boolean(canIntent),
    canLive: false,
    reportOnly: true,
    runtimeAuthority: "none",
    nextAutomationStep,
  };
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
  // Producer-emitted authoritative staleness (src/status/all-chain-autopilot-slice.mjs#refillBlockers)
  // wins when present: it cross-references the live capital planner's current candidate
  // methods for the same (chain, asset) resource and is the canonical join surface.
  if (blocker.stalePlannerMethod === true) {
    return { ...blocker, mismatchClass: "stale_snapshot_method" };
  }
  if (!method) {
    return { ...blocker, mismatchClass: "destination_collision" };
  }
  if (blocker.stalePlannerMethod === false) {
    return { ...blocker, mismatchClass: "method_collision" };
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

// Normalized tuple match between the planner's selected source/method and a
// readiness blocker. When the readiness blocker exposes a source tuple via the
// producer-side projection (`refillBlockerDetails`), require all present source
// fields to match; otherwise fall back to method-only match. No protocol/chain
// literals are introduced — only structural key equality.
function blockerMatchesPlannerTuple(blocker, { sourceChain, sourceAsset, selectedMethod }) {
  if (selectedMethod && blocker.selectedMethod && blocker.selectedMethod !== selectedMethod) return false;
  if (sourceChain && blocker.sourceChain && blocker.sourceChain !== sourceChain) return false;
  if (sourceAsset && blocker.sourceAsset && blocker.sourceAsset !== sourceAsset) return false;
  return true;
}

function evaluateGoverningAgreement({ handlerResult, readinessReport }) {
  const dryRunIntent = handlerResult?.dryRunIntent || {};
  const destination = dryRunIntent.destination || {};
  const source = dryRunIntent.source || {};
  const handlerAgreement = dryRunIntent.governingAgreement || {};
  const plannerBlocker = dryRunIntent.blocker || null;
  const selectedMethod = dryRunIntent.selectedMethod || null;
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
  // Tuple-matched live collisions: current-method blockers whose normalized
  // source tuple matches the planner intent. When source fields are absent on
  // either side, the match falls back to method-only (existing behavior). The
  // tuple match is the join key used by the typed-missing-evidence path so the
  // lifecycle can recognize a precise structural disagreement instead of a
  // generic destination-only mismatch.
  const tupleMatchedCollisions = liveCollisions.filter((entry) =>
    blockerMatchesPlannerTuple(entry, {
      sourceChain: source.chain || null,
      sourceAsset: source.asset || null,
      selectedMethod,
    }),
  );
  return {
    handlerAgreement,
    plannerBlocker,
    plannerCandidateMethods,
    plannerSelectedMethod: selectedMethod,
    plannerSourceChain: source.chain || null,
    plannerSourceAsset: source.asset || null,
    readinessBlockers: classifiedBlockers,
    readinessBlockerCount: classifiedBlockers.length,
    liveCollisionCount: liveCollisions.length,
    tupleMatchedCollisions,
    tupleMatchedCollisionCount: tupleMatchedCollisions.length,
    staleSnapshotCount: staleBlockers.length,
    handlerAgrees,
    readinessAgrees,
    onlyStaleSnapshot,
    agrees: handlerAgrees && readinessAgrees && plannerBlocker === null,
  };
}

function blockerCostEvidence(blocker = {}) {
  return {
    expectedNetUsd: finiteNumber(blocker.expectedNetUsd),
    requiredNetUsd: finiteNumber(firstPresent(blocker.requiredNetUsd, blocker.requiredNetPnlUsd)),
    p90CostUsd: finiteNumber(firstPresent(blocker.p90CostUsd, blocker.receiptCostP90Usd, blocker.receiptCostFloorUsd)),
    effectiveFloorUsd: finiteNumber(firstPresent(blocker.effectiveFloorUsd, blocker.effectiveCostFloorUsd)),
  };
}

function hasCostFloorEvidence(evidence) {
  return (
    evidence.expectedNetUsd !== null &&
    (evidence.requiredNetUsd !== null || evidence.p90CostUsd !== null || evidence.effectiveFloorUsd !== null)
  );
}

function preciseNoLiveRouteEvidence({ governingAgreement, dryRunIntent, destination }) {
  const selectedMethod = dryRunIntent.selectedMethod || null;
  if (!selectedMethod || !governingAgreement.plannerBlocker) return null;
  const currentMethodBlockers = governingAgreement.readinessBlockers.filter(
    (blocker) =>
      blocker.mismatchClass === "method_collision" &&
      blocker.selectedMethod === selectedMethod &&
      [blocker.reason, blocker.category].includes(governingAgreement.plannerBlocker),
  );
  if (currentMethodBlockers.length === 0) return null;
  const costEvidence = currentMethodBlockers.map(blockerCostEvidence);
  if (!costEvidence.every(hasCostFloorEvidence)) return null;
  return {
    method: selectedMethod,
    resource: {
      chain: destination.chain || null,
      asset: destination.asset || null,
      token: destination.token || null,
    },
    plannerBlocker: governingAgreement.plannerBlocker,
    readinessBlockers: currentMethodBlockers,
    costEvidence,
  };
}

// Typed missing evidence path. Activates only when the planner has a fresh
// ready job (blocker:null) but readiness reports an authoritative current-method
// blocker for the SAME normalized tuple (chain + asset + sourceChain +
// sourceAsset + selectedMethod). This is the producer-gap shape: the planner is
// structurally blind to live route observation and the readiness blocker
// describes a route-absence/EV-rejected taxonomy whose required numeric cost
// floor is not propagated by the upstream projection. Emits explicit typed
// missing evidence labels so the consumer knows exactly what to supply before
// the lifecycle can advance to NO_LIVE_ROUTE or READY_FOR_INTENT_CANDIDATE.
// canIntent stays false; no policy/EV/cap/cooldown/kill-switch gate is relaxed.
function typedMissingEvidenceForTupleMatch({ governingAgreement, dryRunIntent, destination, source }) {
  if (governingAgreement.plannerBlocker !== null) return null;
  if (governingAgreement.tupleMatchedCollisionCount === 0) return null;
  const selectedMethod = dryRunIntent.selectedMethod || null;
  if (!selectedMethod) return null;
  // Require that the matched blocker carries enough structural source/method
  // metadata to prove the join is real (not a destination-only collision). When
  // no blocker exposes the source tuple, fall through to the existing
  // UNRESOLVED_GOVERNING_SYNC_MISMATCH verdict.
  const sourceSpecificBlockers = governingAgreement.tupleMatchedCollisions.filter(
    (blocker) => blocker.sourceChain || blocker.sourceAsset,
  );
  if (sourceSpecificBlockers.length === 0) return null;
  const costEvidence = sourceSpecificBlockers.map(blockerCostEvidence);
  const typed = [];
  // Planner emitted no blocker for a tuple readiness flagged as exhausted/locked.
  typed.push("planner_blocker_absent_for_normalized_tuple_with_active_readiness_blocker");
  // Cost-floor evidence is structurally absent for route-absence taxonomy or
  // because the producer projection drops the numeric fields. Flag whichever
  // applies so downstream surfaces can request the right producer field.
  const allCostFloorMissing = costEvidence.every((evidence) => !hasCostFloorEvidence(evidence));
  if (allCostFloorMissing) {
    const routeAbsence = sourceSpecificBlockers.some(
      (blocker) =>
        String(blocker.category || "") === "routing_exhausted" ||
        String(blocker.taxonomy || "") === "route_specific_failure_lock" ||
        String(blocker.reason || "") === "routing_exhausted",
    );
    if (routeAbsence) {
      typed.push("readiness_cost_floor_unavailable_for_route_absence_taxonomy");
    } else {
      typed.push("readiness_cost_floor_numeric_fields_missing_from_producer_projection");
    }
  }
  return {
    method: selectedMethod,
    resource: {
      chain: destination.chain || null,
      asset: destination.asset || null,
      token: destination.token || null,
      sourceChain: source.chain || null,
      sourceAsset: source.asset || null,
    },
    plannerBlocker: governingAgreement.plannerBlocker,
    readinessBlockers: sourceSpecificBlockers,
    costEvidence,
    typedMissingEvidence: typed,
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

function resolveLifecycleStatus({
  canDryRun,
  missingEvidence,
  governingAgreement,
  noLiveRouteEvidence,
  typedMissingEvidence,
}) {
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
  if (noLiveRouteEvidence) {
    return {
      status: "NO_LIVE_ROUTE",
      canIntent: false,
      nextAutomationStep: "wait_for_new_route_or_cost_floor_change_without_live_authority",
    };
  }
  if (typedMissingEvidence) {
    return {
      status: "TYPED_MISSING_EVIDENCE",
      canIntent: false,
      nextAutomationStep: "supply_typed_missing_evidence_fields_for_governing_alignment",
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
  const noLiveRouteEvidence = preciseNoLiveRouteEvidence({ governingAgreement, dryRunIntent, destination });
  const typedMissingEvidence = typedMissingEvidenceForTupleMatch({
    governingAgreement,
    dryRunIntent,
    destination,
    source,
  });
  const missingEvidence = collectMissingEvidence({
    canDryRun,
    dryRunIntent,
    source,
    destination,
    costs,
    handlerResult,
  });
  const lifecycle = resolveLifecycleStatus({
    canDryRun,
    missingEvidence,
    governingAgreement,
    noLiveRouteEvidence,
    typedMissingEvidence,
  });

  // canLive remains false in every path; this lifecycle never promotes live.
  return {
    ...commonLaneFields({
      item,
      lane: "capital_refill",
      status: lifecycle.status,
      evidenceComplete: missingEvidence.length === 0 && (lifecycle.canIntent || lifecycle.status === "NO_LIVE_ROUTE"),
      missingEvidence,
      canDryRun,
      canIntent: lifecycle.canIntent,
      nextAutomationStep: lifecycle.nextAutomationStep,
    }),
    family: item.family || handlerResult?.family || null,
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
    stalePlannerMethodEntries: governingAgreement.readinessBlockers.filter(
      (entry) => entry.mismatchClass === "stale_snapshot_method",
    ),
    currentBlockers: governingAgreement.readinessBlockers.filter(
      (entry) => entry.mismatchClass !== "stale_snapshot_method",
    ),
    noLiveRouteEvidence,
    typedMissingEvidenceDetail: typedMissingEvidence,
    typedMissingEvidence: typedMissingEvidence ? [...typedMissingEvidence.typedMissingEvidence] : [],
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
    ...commonLaneFields({
      item: {
        family: queueFamilies[0] || null,
        lane,
        governingFieldPath: relatedBacklog[0]?.governingFieldPath || relatedHandled[0]?.governingFieldPath || null,
      },
      lane,
      status: "FUTURE_HANDLER_BACKLOG",
      missingEvidence: requirements.requiredEvidence,
      nextAutomationStep: requirements.nextStep,
    }),
    lane,
    status: "FUTURE_HANDLER_BACKLOG",
    requiredEvidence: [...requirements.requiredEvidence],
    nextStep: requirements.nextStep,
    owningProducer: requirements.owningProducer || null,
    queueFamilies,
    handlerBacklogCount: relatedBacklog.length,
    allowedToExecuteLive: false,
  };
}

function laneBacklogItem(entry = {}) {
  const lane = entry.lane || "producer_backlog";
  const requirements = BACKLOG_REQUIREMENTS[lane] || BACKLOG_REQUIREMENTS.producer_backlog;
  const missingEvidence = [...requirements.requiredEvidence];
  if (entry.missingProducer && !missingEvidence.includes("missing_producer_name")) {
    missingEvidence.unshift("missing_producer_name");
  }
  return {
    ...commonLaneFields({
      item: entry,
      lane,
      status: entry.status || "BACKLOG_MISSING_EVIDENCE",
      missingEvidence,
      canDryRun: entry.canDryRun === true,
      nextAutomationStep: entry.nextAutomationStep || requirements.nextStep,
    }),
    reason: entry.reason || null,
    missingProducer: entry.missingProducer || null,
    bestOwnerGuess: entry.owner || entry.bestOwnerGuess || requirements.owningProducer?.module || null,
    evidenceContract: [...requirements.requiredEvidence],
    requiredEvidence: [...requirements.requiredEvidence],
    owningProducer: requirements.owningProducer || null,
  };
}

function waitlistItem(entry = {}) {
  const requirements = BACKLOG_REQUIREMENTS.waitlist;
  return {
    ...commonLaneFields({
      item: entry,
      lane: "waitlist",
      status: entry.status || "WAITLIST",
      missingEvidence: [],
      nextAutomationStep: entry.nextAutomationStep || requirements.nextStep,
    }),
    reason: entry.reason || null,
    recheckCondition: entry.recheckCondition || entry.reason || "wait_for_governing_field_change",
    validWaitReasons: ["dust", "negative_ev", "pending_receipt", "cooldown_cap_safety", "missing_official_route"],
    requiredEvidence: [...requirements.requiredEvidence],
    owningProducer: requirements.owningProducer,
  };
}

function laneHandlerCoverage({
  handlerResults = [],
  handlerBacklog = [],
  futureHandlerBacklog = [],
  laneWaitlist = [],
} = {}) {
  const countByLane = {};
  for (const entry of [...handlerResults, ...handlerBacklog, ...futureHandlerBacklog, ...laneWaitlist]) {
    const lane = entry?.lane || "unknown";
    countByLane[lane] = (countByLane[lane] || 0) + 1;
  }
  return {
    handledCount: handlerResults.length,
    backlogCount: handlerBacklog.length + futureHandlerBacklog.length,
    waitlistCount: laneWaitlist.length,
    countByLane,
    reportOnly: true,
    canLive: false,
    runtimeAuthority: "none",
  };
}

function summarize(candidates, backlog) {
  let intentCandidateCount = 0;
  let canLiveCount = 0;
  let blockedCount = 0;
  let staleSnapshotCount = 0;
  let governingMismatchCount = 0;
  let typedMissingEvidenceCount = 0;
  for (const candidate of candidates) {
    if (candidate.canIntent) intentCandidateCount += 1;
    if (candidate.canLive) canLiveCount += 1;
    if (!["READY_FOR_INTENT_CANDIDATE", "NO_LIVE_ROUTE"].includes(candidate.status)) blockedCount += 1;
    if (candidate.status === "UNRESOLVED_STALE_READINESS_SNAPSHOT") staleSnapshotCount += 1;
    if (candidate.status === "UNRESOLVED_GOVERNING_SYNC_MISMATCH") governingMismatchCount += 1;
    if (candidate.status === "TYPED_MISSING_EVIDENCE") typedMissingEvidenceCount += 1;
  }
  return {
    intentCandidateCount,
    canLiveCount,
    blockedCount,
    backlogCount: backlog.length,
    staleSnapshotCount,
    governingMismatchCount,
    typedMissingEvidenceCount,
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
  const laneWaitlist = handlerBacklog.filter((entry) => entry.lane === "waitlist").map(waitlistItem);
  const laneBacklog = [
    ...handlerBacklog.filter((entry) => entry.lane !== "waitlist").map(laneBacklogItem),
    ...futureHandlerBacklog,
  ];
  const laneSafetyProof = {
    ...REPORT_ONLY_SAFETY,
    handlerSafety: laneHandlerReport.safety || null,
    candidateCount: laneIntentCandidates.length,
    liveCandidateCount: laneIntentCandidates.filter((entry) => entry.canLive).length,
  };
  const coverage = laneHandlerCoverage({ handlerResults, handlerBacklog, futureHandlerBacklog, laneWaitlist });
  return {
    generatedAt,
    status: reportStatus(laneIntentCandidates, pilotLane),
    pilotLane,
    laneIntentCandidateSummary: summarize(laneIntentCandidates, laneBacklog),
    laneIntentCandidates,
    laneBacklog,
    laneWaitlist,
    laneHandlerCoverage: coverage,
    laneSafetyProof,
    futureHandlerBacklog,
    producers: LIFECYCLE_PRODUCERS,
    safety: { ...REPORT_ONLY_SAFETY },
  };
}
