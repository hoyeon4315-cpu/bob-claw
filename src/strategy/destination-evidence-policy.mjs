function policyForCategory(item = {}) {
  if (item.category === "yield") {
    return {
      freshnessHours: 24,
      minIndependentChecks: 3,
      minSources: 2,
      volatileFields: ["grossReturnBps", "unwindSlippageBps"],
      minVolatileFieldObservations: 2,
      requireAllowlist: true,
      requireUnwindModel: true,
      requireDelayMeasurement: true,
    };
  }

  if (item.category === "platform") {
    return {
      freshnessHours: 168,
      minIndependentChecks: 1,
      minSources: 1,
      volatileFields: [],
      minVolatileFieldObservations: 0,
      requireAllowlist: true,
      requireUnwindModel: false,
      requireDelayMeasurement: false,
    };
  }

  if (item.category === "arbitrage") {
    return {
      freshnessHours: 1,
      minIndependentChecks: 30,
      minSources: 2,
      volatileFields: ["grossReturnBps", "unwindSlippageBps"],
      minVolatileFieldObservations: 3,
      requireAllowlist: true,
      requireUnwindModel: true,
      requireDelayMeasurement: false,
    };
  }

  return {
    freshnessHours: 72,
    minIndependentChecks: 2,
    minSources: 1,
    volatileFields: ["grossReturnBps"],
    minVolatileFieldObservations: 1,
    requireAllowlist: true,
    requireUnwindModel: false,
    requireDelayMeasurement: false,
  };
}

function unmetRequirements(item = {}, policy = {}) {
  const unmet = [];
  const values = item.values || {};

  if (policy.requireAllowlist && values.allowlistDecision == null) unmet.push("allowlistDecision");
  if (values.sourceName == null) unmet.push("sourceName");
  if (values.sourceType == null) unmet.push("sourceType");
  if (values.lastVerifiedAt == null) unmet.push("lastVerifiedAt");
  if (policy.requireUnwindModel && values.unwindSlippageBps == null) unmet.push("unwindSlippageBps");
  if (policy.requireDelayMeasurement && values.withdrawalDelayHours == null) unmet.push("withdrawalDelayHours");

  return unmet;
}

export function buildDestinationEvidencePolicy({ workbench = null } = {}) {
  const generatedAt = workbench?.generatedAt || new Date().toISOString();
  const items = (workbench?.workItems || []).map((item) => {
    const policy = policyForCategory(item);
    const unmet = unmetRequirements(item, policy);

    return {
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId,
      label: item.label,
      category: item.category,
      score: item.score,
      overfitRisk: item.overfitRisk,
      policy,
      unmetPolicyInputs: unmet,
      policyStatus: unmet.length === 0 ? "inputs_seeded" : "inputs_missing",
    };
  });

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      policyItemCount: items.length,
      inputsSeededCount: items.filter((item) => item.policyStatus === "inputs_seeded").length,
      inputsMissingCount: items.filter((item) => item.policyStatus === "inputs_missing").length,
      strictestFamilies: items
        .slice()
        .sort(
          (left, right) =>
            (right.policy.minIndependentChecks ?? 0) - (left.policy.minIndependentChecks ?? 0) ||
            (left.policy.freshnessHours ?? 0) - (right.policy.freshnessHours ?? 0) ||
            String(left.templateId).localeCompare(String(right.templateId)),
        )
        .slice(0, 10)
        .map((item) => ({
          templateId: item.templateId,
          chain: item.chain,
          familyId: item.familyId,
          checks: item.policy.minIndependentChecks,
          freshnessHours: item.policy.freshnessHours,
        })),
    },
    items,
  };
}
