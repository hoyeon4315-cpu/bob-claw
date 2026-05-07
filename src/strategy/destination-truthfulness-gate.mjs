function blockerTags(blockers = []) {
  const values = new Set();

  for (const blocker of blockers || []) {
    const text = String(blocker || "").toLowerCase();
    if (!text) continue;
    if (text.includes("overfit") || text.includes("stale") || text.includes("thin_")) values.add("overfit_or_stale");
    if (text.includes("allowlist") || text.includes("denied")) values.add("allowlist_gap");
    if (text.includes("unwind") || text.includes("withdraw")) values.add("unwind_gap");
    if (text.includes("venue") || text.includes("protocol") || text.includes("destination")) values.add("destination_gap");
    if (text.includes("measured no-edge") || text.includes("economically blocked") || text.includes("amount_mismatch")) {
      values.add("negative_edge");
    }
  }

  return [...values];
}

function evidenceTier(strategy = {}) {
  return {
    live_transport_supported: "transport_only",
    live_transport_supported_destination_unscored: "transport_plus_destination_gap",
    docs_supported_live_arrival_asset: "docs_plus_live_arrival",
    docs_surface_supported: "docs_surface_only",
    blog_surface_supported: "blog_surface_only",
  }[strategy.evidenceStatus] ?? "unknown";
}

function overfitRisk(strategy = {}) {
  const tags = blockerTags(strategy.blockers);
  if (strategy.scoring?.track === "blocked_research" || tags.includes("overfit_or_stale")) return "high";
  if (strategy.scoring?.track === "observe_only_research" || strategy.evidenceStatus === "docs_surface_supported") return "medium";
  if ((strategy.blockers || []).length >= 2) return "medium";
  return "low";
}

function gateDecision(strategy = {}) {
  const tags = blockerTags(strategy.blockers);
  const tier = evidenceTier(strategy);
  const track = strategy.scoring?.track;

  if (track === "monetization_track") {
    return {
      status: "non_capital_track",
      allocatable: false,
      nextAction: "keep separate from capital allocator",
      reasons: ["not a deployable capital strategy"],
    };
  }

  if (track === "observe_only_research") {
    return {
      status: "observe_only",
      allocatable: false,
      nextAction: "wait for explicit policy reapproval",
      reasons: ["chain is observe-only in current capital phase"],
    };
  }

  if (track === "blocked_research") {
    return {
      status: "blocked",
      allocatable: false,
      nextAction: "collect new evidence before rescoring",
      reasons: tags.includes("negative_edge")
        ? ["measured edge is blocked or negative on current evidence"]
        : ["overfit or evidence blockers prevent score readiness"],
    };
  }

  if (track === "transport_rail") {
    return {
      status: "transport_only",
      allocatable: false,
      nextAction: "map destination venues on this rail",
      reasons: ["transport support exists, but destination deployment is not yet scored"],
    };
  }

  if (track === "macro_rotation") {
    return {
      status: "thesis_review_required",
      allocatable: false,
      nextAction: "define macro exposure policy and unwind rules first",
      reasons: ["directional rotation is not score-ready in the current allocator"],
    };
  }

  if (track === "experimental_research") {
    return {
      status: "policy_review_only",
      allocatable: false,
      nextAction: "require policy review and explicit allowlist decision",
      reasons: ["experimental paths need policy review before any deeper scoring"],
    };
  }

  if (tier === "docs_surface_only" || tier === "blog_surface_only") {
    return {
      status: "research_only",
      allocatable: false,
      nextAction: "replace surface evidence with live destination support",
      reasons: ["product surface exists but live destination evidence is incomplete"],
    };
  }

  if (tags.includes("destination_gap") || tags.includes("unwind_gap") || tags.includes("allowlist_gap")) {
    return {
      status: "research_only",
      allocatable: false,
      nextAction: "complete venue scoring, allowlist review, and unwind measurement",
      reasons: ["destination deployment evidence is incomplete"],
    };
  }

  return {
    status: "ready_for_venue_scoring",
    allocatable: false,
    nextAction: "add deterministic venue economics inputs",
    reasons: ["eligible for deeper venue-level scoring but not yet allocatable"],
  };
}

export function buildDestinationTruthfulnessGate({ scoring = null } = {}) {
  const generatedAt = scoring?.generatedAt || new Date().toISOString();
  const chains = (scoring?.chains || []).map((chain) => {
    const strategies = (chain.strategies || []).map((strategy) => {
      const tags = blockerTags(strategy.blockers);
      const gate = gateDecision(strategy);

      return {
        familyId: strategy.familyId,
        label: strategy.label,
        category: strategy.category,
        actionType: strategy.actionType,
        scoring: strategy.scoring,
        evidenceTier: evidenceTier(strategy),
        overfitRisk: overfitRisk(strategy),
        blockerTags: tags,
        gate,
      };
    });

    return {
      chain: chain.chain,
      topGateReadyCandidate:
        strategies
          .filter((strategy) => strategy.gate.status === "ready_for_venue_scoring")
          .sort(
            (left, right) =>
              (right.scoring?.deploymentPriorityScore ?? 0) - (left.scoring?.deploymentPriorityScore ?? 0) ||
              String(left.familyId).localeCompare(String(right.familyId)),
          )[0] || null,
      strategies,
    };
  });

  const allStrategies = chains.flatMap((chain) => chain.strategies.map((strategy) => ({ chain: chain.chain, ...strategy })));

  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      chainCount: chains.length,
      strategyCount: allStrategies.length,
      readyForVenueScoringCount: allStrategies.filter((strategy) => strategy.gate.status === "ready_for_venue_scoring").length,
      researchOnlyCount: allStrategies.filter((strategy) => strategy.gate.status === "research_only").length,
      blockedCount: allStrategies.filter((strategy) => strategy.gate.status === "blocked").length,
      observeOnlyCount: allStrategies.filter((strategy) => strategy.gate.status === "observe_only").length,
      transportOnlyCount: allStrategies.filter((strategy) => strategy.gate.status === "transport_only").length,
      thesisReviewRequiredCount: allStrategies.filter((strategy) => strategy.gate.status === "thesis_review_required").length,
      policyReviewOnlyCount: allStrategies.filter((strategy) => strategy.gate.status === "policy_review_only").length,
      topGateReadyCandidates: allStrategies
        .filter((strategy) => strategy.gate.status === "ready_for_venue_scoring")
        .sort(
          (left, right) =>
            (right.scoring?.deploymentPriorityScore ?? 0) - (left.scoring?.deploymentPriorityScore ?? 0) ||
            String(left.familyId).localeCompare(String(right.familyId)),
        )
        .slice(0, 10)
        .map((strategy) => ({
          chain: strategy.chain,
          familyId: strategy.familyId,
          label: strategy.label,
          score: strategy.scoring?.deploymentPriorityScore ?? null,
        })),
    },
    chains,
  };
}
