function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function nextAction(workItem, policyItem, economicsItem) {
  const missing = new Set(workItem?.missingFields || []);
  const policyMissing = new Set(policyItem?.unmetPolicyInputs || []);

  if (economicsItem?.economicsStatus === "non_numeric_track") {
    return {
      action: "document_platform_surface",
      reason: "non_numeric_track",
    };
  }

  if (economicsItem?.economicsStatus === "blocked") {
    return {
      action: "wait_blocked_destination_venue",
      reason: economicsItem.blockerCode || "destination_economics_blocked",
    };
  }

  if (workItem?.overrideStatus === "empty") {
    return {
      action: "seed_source_metadata",
      reason: "override_missing",
    };
  }

  if (missing.has("allowlistDecision")) {
    return {
      action: "run_allowlist_review",
      reason: "allowlist_missing",
    };
  }

  if (missing.has("sourceName") || missing.has("sourceType") || missing.has("lastVerifiedAt")) {
    return {
      action: "collect_source_metadata",
      reason: "source_metadata_missing",
    };
  }

  if (economicsItem?.economicsStatus === "missing_inputs") {
    return {
      action: "measure_numeric_economics",
      reason: "economic_inputs_missing",
    };
  }

  if ((policyItem?.unmetPolicyInputs || []).length > 0) {
    return {
      action: "satisfy_evidence_policy",
      reason: "evidence_policy_incomplete",
    };
  }

  if (economicsItem?.activeBudgetEstimate?.passesPolicy || economicsItem?.planningBudgetEstimate?.passesPolicy) {
    return {
      action: "mark_score_ready_for_allocation_review",
      reason: "estimated_policy_pass",
    };
  }

  return {
    action: "hold_below_policy",
    reason: "estimated_below_policy",
  };
}

function priorityBoost(chain) {
  return {
    base: 0.04,
    bsc: 0.04,
    bob: 0.03,
    bera: 0.02,
  }[chain] ?? 0;
}

function queueScore(workItem, policyItem, economicsItem) {
  const baseScore = Number(workItem?.score || 0);
  const readiness = Number(workItem?.readinessScore || 0);
  const overfitPenalty = workItem?.overfitRisk === "high" ? 0.08 : workItem?.overfitRisk === "medium" ? 0.04 : 0;
  const policyPenalty = (policyItem?.unmetPolicyInputs || []).length * 0.01;
  const missingPenalty = (workItem?.missingFields || []).length * 0.004;
  const economicsBoost = economicsItem?.economicsStatus === "estimated" ? 0.05 : 0;
  const blockedPenalty = economicsItem?.economicsStatus === "blocked" ? 0.12 : 0;
  const seedBoost = workItem?.overrideStatus === "partially_seeded" ? 0.03 : 0;
  const score =
    baseScore +
    readiness * 0.05 +
    seedBoost +
    economicsBoost +
    priorityBoost(workItem?.chain) -
    overfitPenalty -
    blockedPenalty -
    policyPenalty -
    missingPenalty;
  return Math.max(0, Math.round(score * 10000) / 10000);
}

export function buildDestinationResearchQueue({ workbench = null, evidencePolicy = null, economics = null } = {}) {
  const generatedAt = workbench?.generatedAt || new Date().toISOString();
  const policyByTemplate = byTemplateId(evidencePolicy?.items);
  const economicsByTemplate = byTemplateId(economics?.items);

  const queue = (workbench?.workItems || [])
    .map((workItem) => {
      const policyItem = policyByTemplate.get(workItem.templateId) || null;
      const economicsItem = economicsByTemplate.get(workItem.templateId) || null;
      const next = nextAction(workItem, policyItem, economicsItem);
      return {
        templateId: workItem.templateId,
        chain: workItem.chain,
        familyId: workItem.familyId,
        label: workItem.label,
        category: workItem.category,
        score: workItem.score,
        readinessScore: workItem.readinessScore,
        overrideStatus: workItem.overrideStatus,
        overfitRisk: workItem.overfitRisk,
        missingFields: workItem.missingFields,
        unmetPolicyInputs: policyItem?.unmetPolicyInputs || [],
        economicsStatus: economicsItem?.economicsStatus || "unknown",
        nextAction: next.action,
        reason: next.reason,
        queueScore: queueScore(workItem, policyItem, economicsItem),
      };
    })
    .sort(
      (left, right) =>
        (right.queueScore ?? 0) - (left.queueScore ?? 0) ||
        String(left.templateId).localeCompare(String(right.templateId)),
    );

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      queueCount: queue.length,
      seededQueueCount: queue.filter((item) => item.overrideStatus === "partially_seeded").length,
      topActions: Object.entries(
        queue.reduce((acc, item) => {
          acc[item.nextAction] = (acc[item.nextAction] || 0) + 1;
          return acc;
        }, {}),
      )
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, 10)
        .map(([action, count]) => ({ action, count })),
      topQueue: queue.slice(0, 15),
    },
    queue,
  };
}
