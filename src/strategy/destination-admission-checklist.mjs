function overrideMap(overrides = null) {
  const map = new Map();
  for (const entry of overrides?.entries || []) {
    if (!entry?.templateId) continue;
    map.set(entry.templateId, entry);
  }
  return map;
}

function requirementsForTemplate(template = {}) {
  if (template.category === "yield") {
    return [
      "allowlistDecision",
      "grossReturnBps",
      "depositFeeBps",
      "withdrawFeeBps",
      "unwindSlippageBps",
      "withdrawalDelayHours",
      "minPositionUsd",
      "sourceName",
      "sourceType",
      "lastVerifiedAt",
    ];
  }

  if (template.category === "platform") {
    return ["allowlistDecision", "sourceName", "sourceType", "lastVerifiedAt"];
  }

  if (template.category === "arbitrage") {
    return [
      "allowlistDecision",
      "grossReturnBps",
      "depositFeeBps",
      "withdrawFeeBps",
      "unwindSlippageBps",
      "sourceName",
      "sourceType",
      "lastVerifiedAt",
    ];
  }

  return ["allowlistDecision", "sourceName", "sourceType", "lastVerifiedAt"];
}

function evaluateTemplate(template = {}) {
  const requiredFields = requirementsForTemplate(template);
  const defaults = template.defaults || {};
  const missing = requiredFields.filter((field) => defaults[field] == null);

  return {
    requiredFields,
    missingFields: missing,
    readyForPolicyReview: missing.length === 0,
    admissionStatus: missing.length === 0 ? "complete_for_policy_review" : "incomplete",
  };
}

export function buildDestinationAdmissionChecklist({ venueTemplate = null, overrides = null } = {}) {
  const generatedAt = venueTemplate?.generatedAt || new Date().toISOString();
  const overridesByTemplate = overrideMap(overrides);
  const chains = (venueTemplate?.chains || []).map((chain) => {
    const templates = (chain.templates || []).map((template) => {
      const override = overridesByTemplate.get(template.templateId);
      const mergedTemplate = {
        ...template,
        defaults: {
          ...(template.defaults || {}),
          ...(override?.values || {}),
        },
      };
      return {
        ...mergedTemplate,
        admission: evaluateTemplate(mergedTemplate),
      };
    });

    return {
      chain: chain.chain,
      readyForPolicyReviewCount: templates.filter((template) => template.admission.readyForPolicyReview).length,
      templates,
    };
  });

  const allTemplates = chains.flatMap((chain) => chain.templates);

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      chainCount: chains.length,
      templateCount: allTemplates.length,
      readyForPolicyReviewCount: allTemplates.filter((template) => template.admission.readyForPolicyReview).length,
      incompleteCount: allTemplates.filter((template) => !template.admission.readyForPolicyReview).length,
      topMissingFields: Object.entries(
        allTemplates.flatMap((template) => template.admission.missingFields).reduce((acc, field) => {
          acc[field] = (acc[field] || 0) + 1;
          return acc;
        }, {}),
      )
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, 10)
        .map(([field, count]) => ({ field, count })),
    },
    chains,
  };
}
