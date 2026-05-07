function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function recommendation(item = {}, queueItem = null) {
  const values = item.values || {};

  if (values.allowlistDecision && values.allowlistDecision !== "pending_review") {
    return {
      status: "decision_recorded",
      nextAction: "respect_recorded_decision",
    };
  }

  if (item.overfitRisk === "high") {
    return {
      status: "blocked_by_risk",
      nextAction: "do_not_allowlist_until_overfit_resolved",
    };
  }

  if (queueItem?.nextAction === "document_platform_surface" || item.category === "platform") {
    return {
      status: "contract_policy_review",
      nextAction: "review_destination_action_contracts_and_composer_flow",
    };
  }

  if (values.sourceName == null || values.sourceType == null || values.lastVerifiedAt == null) {
    return {
      status: "needs_source_metadata",
      nextAction: "seed_source_metadata_first",
    };
  }

  return {
    status: "candidate_for_allowlist_review",
    nextAction: "review_protocol_and_record_allowlist_decision",
  };
}

export function buildDestinationAllowlistBoard({ workbench = null, researchQueue = null } = {}) {
  const generatedAt = workbench?.generatedAt || new Date().toISOString();
  const queueByTemplate = byTemplateId(researchQueue?.queue);

  const items = (workbench?.workItems || []).map((item) => {
    const queueItem = queueByTemplate.get(item.templateId) || null;
    return {
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId,
      label: item.label,
      category: item.category,
      score: item.score,
      overfitRisk: item.overfitRisk,
      overrideStatus: item.overrideStatus,
      recommendation: recommendation(item, queueItem),
      values: item.values || {},
    };
  });

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      itemCount: items.length,
      candidateCount: items.filter((item) => item.recommendation.status === "candidate_for_allowlist_review").length,
      contractPolicyReviewCount: items.filter((item) => item.recommendation.status === "contract_policy_review").length,
      blockedByRiskCount: items.filter((item) => item.recommendation.status === "blocked_by_risk").length,
      observeOnlyCount: items.filter((item) => item.recommendation.status === "observe_only_policy").length,
      topReviewTargets: items
        .filter((item) => item.recommendation.status === "candidate_for_allowlist_review")
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || String(left.templateId).localeCompare(String(right.templateId)))
        .slice(0, 15)
        .map((item) => ({
          templateId: item.templateId,
          chain: item.chain,
          familyId: item.familyId,
          label: item.label,
          score: item.score,
        })),
    },
    items,
  };
}
