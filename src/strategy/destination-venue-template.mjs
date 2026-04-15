function recommendedInputMode(strategy = {}) {
  return {
    lending: "lending_rate_snapshot",
    yield_action: "vault_or_yield_feed",
    lp_position: "lp_pool_snapshot",
    custom_destination_action: "custom_action_definition",
    cross_wrapper_spread: "cross_market_quote_pair",
  }[strategy.actionType] ?? "manual_definition";
}

function templateForStrategy(chain, strategy) {
  return {
    templateId: `${chain.chain}:${strategy.familyId}`,
    chain: chain.chain,
    familyId: strategy.familyId,
    label: strategy.label,
    category: strategy.category,
    actionType: strategy.actionType ?? null,
    gateStatus: strategy.gate.status,
    evidenceTier: strategy.evidenceTier,
    overfitRisk: strategy.overfitRisk,
    scoring: strategy.scoring,
    recommendedInputMode: recommendedInputMode(strategy),
    unresolvedInputs: [
      "grossReturnBps",
      "depositFeeBps",
      "withdrawFeeBps",
      "unwindSlippageBps",
      "withdrawalDelayHours",
      "minPositionUsd",
      "maxPositionUsd",
      "sourceName",
      "sourceType",
      "lastVerifiedAt",
      "allowlistDecision",
    ],
    defaults: {
      grossReturnBps: null,
      depositFeeBps: null,
      withdrawFeeBps: null,
      unwindSlippageBps: null,
      withdrawalDelayHours: null,
      minPositionUsd: null,
      maxPositionUsd: null,
      sourceName: null,
      sourceType: null,
      lastVerifiedAt: null,
      allowlistDecision: null,
    },
    blockers: strategy.blockerTags || [],
    nextAction: strategy.gate.nextAction,
    notes: strategy.gate.reasons || [],
  };
}

export function buildDestinationVenueTemplate({ gates = null } = {}) {
  const generatedAt = gates?.generatedAt || new Date().toISOString();
  const chains = (gates?.chains || []).map((chain) => {
    const templates = (chain.strategies || [])
      .filter((strategy) => ["research_only", "ready_for_venue_scoring"].includes(strategy.gate.status))
      .map((strategy) => templateForStrategy(chain, strategy));

    return {
      chain: chain.chain,
      templateCount: templates.length,
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
      readyForVenueScoringTemplates: allTemplates.filter((item) => item.gateStatus === "ready_for_venue_scoring").length,
      researchOnlyTemplates: allTemplates.filter((item) => item.gateStatus === "research_only").length,
      topTemplateTargets: allTemplates
        .sort(
          (left, right) =>
            (right.scoring?.deploymentPriorityScore ?? 0) - (left.scoring?.deploymentPriorityScore ?? 0) ||
            String(left.templateId).localeCompare(String(right.templateId)),
        )
        .slice(0, 10)
        .map((item) => ({
          chain: item.chain,
          familyId: item.familyId,
          label: item.label,
          gateStatus: item.gateStatus,
          score: item.scoring?.deploymentPriorityScore ?? null,
        })),
    },
    chains,
  };
}
