function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function gateStatus(boardItem = null, policyItem = null, economicsItem = null) {
  const blockers = [];

  if (!boardItem) {
    blockers.push("missing_allowlist_board_item");
    return { status: "blocked", blockers };
  }

  const decision = boardItem.values?.allowlistDecision ?? null;
  if (boardItem.recommendation?.status === "manual_contract_review") blockers.push("manual_contract_review_required");
  if (boardItem.recommendation?.status === "observe_only_policy") blockers.push("observe_only_policy");
  if (boardItem.recommendation?.status === "blocked_by_risk") blockers.push("blocked_by_risk");
  if (decision == null) blockers.push("allowlist_decision_missing");
  if (decision && !["approved", "candidate_for_review"].includes(decision)) blockers.push(`allowlist_${decision}`);

  if ((policyItem?.unmetPolicyInputs || []).length > 0) {
    blockers.push("evidence_policy_incomplete");
  }

  if (economicsItem?.economicsStatus === "missing_inputs") blockers.push("economics_inputs_missing");
  if (economicsItem?.economicsStatus === "blocked") blockers.push(economicsItem.blockerCode || "destination_economics_blocked");
  if (economicsItem?.economicsStatus === "non_numeric_track") blockers.push("non_numeric_track");
  if (economicsItem?.economicsStatus === "estimated") {
    const activePass = economicsItem.activeBudgetEstimate?.passesPolicy;
    const planningPass = economicsItem.planningBudgetEstimate?.passesPolicy;
    if (!activePass && !planningPass) blockers.push("estimated_below_policy");
  }

  return {
    status: blockers.length === 0 ? "promotable" : "blocked",
    blockers,
  };
}

function commandSuggestion(templateId, fields = []) {
  const firstField = fields[0] || "<field>";
  return [
    `node src/cli/add-destination-economics-observation.mjs --template-id=${templateId} --field=${firstField} --value=<value> --source-name='<sourceName>' --source-type=<sourceType> --observed-at=<observedAt> --note='<note>' --write`,
    "npm run sync:destination-economics-observations -- --write",
  ].join(" && ");
}

function allocationGateStatus({ templateId, gate = null, policyItem = null, freshnessItem = null, ledgerItem = null } = {}) {
  const policy = policyItem?.policy || {};
  const evidence = {
    coveragePct: ledgerItem?.coveragePct ?? 0,
    requiredFieldCount: ledgerItem?.targetEconomicFields?.length ?? 0,
    coveredFieldCount: ledgerItem?.coveredFields?.length ?? 0,
    missingEconomicFields: ledgerItem?.missingEconomicFields || [],
    sourceCount: ledgerItem?.sourceCount ?? 0,
    sourceNames: ledgerItem?.sourceNames || [],
    sourceTypes: ledgerItem?.sourceTypes || [],
    independentObservationCount: ledgerItem?.observedAtCount ?? 0,
    latestObservedAt: ledgerItem?.latestObservedAt ?? null,
    fieldObservationCounts: ledgerItem?.fieldObservationCounts || {},
    volatileFields: policy.volatileFields || [],
    minVolatileFieldObservations: policy.minVolatileFieldObservations ?? 0,
    minIndependentChecks: policy.minIndependentChecks ?? 0,
    minSources: policy.minSources ?? 0,
  };

  if (gate?.status !== "promotable") {
    return {
      status: "blocked",
      blockers: [...(gate?.blockers || [])],
      evidence,
      nextAction: null,
    };
  }

  const blockers = [];
  if ((freshnessItem?.freshnessStatus ?? "unknown") !== "fresh") blockers.push("allocation_evidence_not_fresh");
  if ((evidence.coveragePct ?? 0) < 1) blockers.push("allocation_fields_incomplete");
  if ((evidence.sourceCount ?? 0) < (evidence.minSources ?? 0)) blockers.push("allocation_source_count_below_policy");
  if ((evidence.independentObservationCount ?? 0) < (evidence.minIndependentChecks ?? 0)) {
    blockers.push("allocation_check_count_below_policy");
  }

  const recheckFields = evidence.volatileFields.filter(
    (field) => (evidence.fieldObservationCounts?.[field] ?? 0) < evidence.minVolatileFieldObservations,
  );
  for (const field of recheckFields) {
    blockers.push(`allocation_${field}_recheck_required`);
  }

  const nextActionFields = recheckFields.length > 0 ? recheckFields : evidence.missingEconomicFields;

  return {
    status: blockers.length === 0 ? "allocation_ready" : "review_only",
    blockers,
    evidence,
    nextAction:
      blockers.length === 0
        ? null
        : {
            code: "collect_repeat_observations",
            label: "collect repeat destination observations",
            command: nextActionFields.length > 0 ? commandSuggestion(templateId, nextActionFields) : null,
          },
  };
}

export function buildDestinationPromotionGate({
  allowlistBoard = null,
  evidencePolicy = null,
  economics = null,
  freshnessAudit = null,
  ledger = null,
} = {}) {
  const generatedAt = allowlistBoard?.generatedAt || new Date().toISOString();
  const boardByTemplate = byTemplateId(allowlistBoard?.items);
  const policyByTemplate = byTemplateId(evidencePolicy?.items);
  const economicsByTemplate = byTemplateId(economics?.items);
  const freshnessByTemplate = byTemplateId(freshnessAudit?.items);
  const ledgerByTemplate = byTemplateId(ledger?.items);

  const items = [...boardByTemplate.keys()].map((templateId) => {
    const boardItem = boardByTemplate.get(templateId);
    const policyItem = policyByTemplate.get(templateId) || null;
    const economicsItem = economicsByTemplate.get(templateId) || null;
    const freshnessItem = freshnessByTemplate.get(templateId) || null;
    const ledgerItem = ledgerByTemplate.get(templateId) || null;
    const gate = gateStatus(boardItem, policyItem, economicsItem);
    if (freshnessItem?.freshnessStatus === "missing") gate.blockers.push("evidence_freshness_missing");
    if (freshnessItem?.freshnessStatus === "stale") gate.blockers.push("evidence_stale");
    if (gate.blockers.length > 0) gate.status = "blocked";
    const allocationGate = allocationGateStatus({
      templateId,
      gate,
      policyItem,
      freshnessItem,
      ledgerItem,
    });

    return {
      templateId,
      chain: boardItem.chain,
      familyId: boardItem.familyId,
      label: boardItem.label,
      score: boardItem.score,
      recommendation: boardItem.recommendation,
      freshnessStatus: freshnessItem?.freshnessStatus ?? "unknown",
      gate,
      allocationGate,
    };
  });

  const blockerCounts = items.flatMap((item) => item.gate.blockers).reduce((acc, blocker) => {
    acc[blocker] = (acc[blocker] || 0) + 1;
    return acc;
  }, {});
  const allocationBlockerCounts = items.flatMap((item) => item.allocationGate?.blockers || []).reduce((acc, blocker) => {
    acc[blocker] = (acc[blocker] || 0) + 1;
    return acc;
  }, {});

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      itemCount: items.length,
      promotableCount: items.filter((item) => item.gate.status === "promotable").length,
      blockedCount: items.filter((item) => item.gate.status === "blocked").length,
      allocationReadyCount: items.filter((item) => item.allocationGate?.status === "allocation_ready").length,
      reviewOnlyCount: items.filter((item) => item.allocationGate?.status === "review_only").length,
      topBlockers: Object.entries(blockerCounts)
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, 12)
        .map(([blocker, count]) => ({ blocker, count })),
      topAllocationBlockers: Object.entries(allocationBlockerCounts)
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, 12)
        .map(([blocker, count]) => ({ blocker, count })),
      topPromotable: items
        .filter((item) => item.gate.status === "promotable")
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || String(left.templateId).localeCompare(String(right.templateId)))
        .slice(0, 10),
      topAllocationReady: items
        .filter((item) => item.allocationGate?.status === "allocation_ready")
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || String(left.templateId).localeCompare(String(right.templateId)))
        .slice(0, 10),
      topReviewOnly: items
        .filter((item) => item.allocationGate?.status === "review_only")
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || String(left.templateId).localeCompare(String(right.templateId)))
        .slice(0, 10),
    },
    items,
  };
}
