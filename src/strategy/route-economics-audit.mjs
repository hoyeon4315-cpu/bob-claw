import { summarizeShadowCandidateEvidence } from "../session/shadow-evidence.mjs";
import { buildCanarySelectionGap } from "./canary-selection-gap.mjs";

const LOOP_FAMILY_REASON_LABELS = {
  policy_ready_route: "measured loop already clears the minimum profit gate",
  positive_but_below_policy_route: "family has positive measured loops but still sits below the policy gate",
  near_policy_route: "family is close enough to the policy gate to keep testing",
  below_policy_route: "family remains below policy and should stay research-only",
  durable_no_edge_route: "family shows repeated no-edge across multiple measured levels",
  insufficient_route_evidence: "family still lacks enough measured loop coverage",
};

const EDGE_RESEARCH_REASON_LABELS = {
  definite_edge_candidate: "multiple profitable score levels with decay support keep this family in scope",
  multi_level_candidate: "multiple profitable score levels exist but the evidence is not yet durable",
  missing_decay_survival: "profitable levels exist but decay survival is still incomplete",
  missing_decay_coverage: "profitable levels exist but decay coverage is still incomplete",
  single_level_only: "only one profitable level exists so the family stays research-only",
  failure_rate_too_high: "route-level edge is overwhelmed by failure-rate risk",
  no_edge: "route-level edge research shows no profitable level",
  reject_outlier: "edge signal looks like an implausible outlier",
};

const CANDIDATE_REASON_LABELS = {
  candidate_review_only: "route-level score is already review-only after current costs",
  measured_loop_positive: "closed-loop measurement is positive, so the route should keep moving through evidence review",
  measured_positive_but_system_negative: "closed-loop measurement is positive, but effective system PnL is still negative after treasury costs",
  prep_ready_but_negative: "prep-ready baseline route is still economically negative and should not be promoted",
  durable_no_edge_family: "route family already shows durable no-edge evidence",
  thin_shadow_evidence: "shadow evidence is still too thin to make a stronger call",
  score_missing: "candidate is missing a current scored quote",
  blocked_by_readiness_or_data: "candidate still has readiness, freshness, or data-quality blockers",
};

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function variantKey(routeKey, amount) {
  return `${routeKey}|${String(amount ?? "")}`;
}

function sameVariant(left, right) {
  return Boolean(left?.routeKey) && Boolean(right?.routeKey) && variantKey(left.routeKey, left.amount) === variantKey(right.routeKey, right.amount);
}

function routeLabel(route) {
  if (!route) return null;
  if (route.label) return route.label;
  const srcChain = route.srcChain || route.route?.srcChain || null;
  const dstChain = route.dstChain || route.route?.dstChain || null;
  const srcTicker = route.srcTicker || route.srcAsset?.ticker || null;
  const dstTicker = route.dstTicker || route.dstAsset?.ticker || null;
  if (srcChain && dstChain && srcTicker && dstTicker) return `${srcChain}->${dstChain} ${srcTicker}->${dstTicker}`;
  return route.routeKey || null;
}

function appendUnique(target, values = []) {
  for (const value of values) {
    if (!value || target.includes(value)) continue;
    target.push(value);
  }
}

function latestScoreByVariant(scores = []) {
  const map = new Map();
  for (const score of scores) {
    if (!score?.routeKey) continue;
    map.set(variantKey(score.routeKey, score.amount), score);
  }
  return map;
}

function routeEvidenceByRoute({ scores = [], shadowObservations = [] } = {}) {
  const byRoute = new Map();
  const touch = (routeKey) => {
    if (!byRoute.has(routeKey)) {
      byRoute.set(routeKey, {
        routeKey,
        amountLevels: new Set(),
        hourBuckets: new Set(),
        shadowObservationCount: 0,
        latestObservationObservedAt: null,
      });
    }
    return byRoute.get(routeKey);
  };

  for (const score of scores) {
    if (!score?.routeKey) continue;
    const bucket = touch(score.routeKey);
    if (score.amount !== null && score.amount !== undefined) {
      bucket.amountLevels.add(String(score.amount));
    }
  }

  for (const observation of shadowObservations) {
    if (!observation?.routeKey) continue;
    const bucket = touch(observation.routeKey);
    if (observation.amount !== null && observation.amount !== undefined) {
      bucket.amountLevels.add(String(observation.amount));
    }
    if (observation.observedAt) {
      bucket.hourBuckets.add(String(observation.observedAt).slice(0, 13));
      if (!bucket.latestObservationObservedAt || new Date(observation.observedAt) > new Date(bucket.latestObservationObservedAt)) {
        bucket.latestObservationObservedAt = observation.observedAt;
      }
    }
    bucket.shadowObservationCount += 1;
  }

  return new Map(
    [...byRoute.entries()].map(([routeKey, summary]) => [
      routeKey,
      {
        routeKey,
        routeAmountLevels: [...summary.amountLevels].sort((left, right) => Number(left) - Number(right) || String(left).localeCompare(String(right))),
        routeAmountLevelCount: summary.amountLevels.size,
        routeHourBucketCount: summary.hourBuckets.size,
        routeShadowObservationCount: summary.shadowObservationCount,
        routeLatestObservationObservedAt: summary.latestObservationObservedAt,
      },
    ]),
  );
}

function measuredLoopMap(edgeViability = null) {
  const map = new Map();
  const loops = [
    ...(edgeViability?.loops || []),
    edgeViability?.closestLoop || null,
    edgeViability?.bestMeasuredLoop || null,
  ].filter((item) => item?.routeKey);
  for (const loop of loops) {
    const key = variantKey(loop.routeKey, loop.amount);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, loop);
      continue;
    }
    const existingGap = Number.isFinite(existing.gapToPolicyUsd) ? existing.gapToPolicyUsd : Number.POSITIVE_INFINITY;
    const nextGap = Number.isFinite(loop.gapToPolicyUsd) ? loop.gapToPolicyUsd : Number.POSITIVE_INFINITY;
    if (nextGap < existingGap) {
      map.set(key, loop);
    }
  }
  return map;
}

function bestStablecoinScore(scoreSnapshot = null) {
  const scores = scoreSnapshot?.scores || [];
  return [...scores]
    .filter((score) => score?.srcAsset?.family === "stablecoin" || score?.dstAsset?.family === "stablecoin")
    .sort(
      (left, right) =>
        (right.effectiveSystemNetPnlUsd ?? right.treasuryAdjustedExecutableNetEdgeUsd ?? right.executableNetEdgeUsd ?? right.netEdgeUsd ?? Number.NEGATIVE_INFINITY) -
          (left.effectiveSystemNetPnlUsd ?? left.treasuryAdjustedExecutableNetEdgeUsd ?? left.executableNetEdgeUsd ?? left.netEdgeUsd ?? Number.NEGATIVE_INFINITY) ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    )[0] || null;
}

function addCandidateVariant(candidateMap, { routeKey, amount, role, candidate = null, score = null } = {}) {
  if (!routeKey || amount === null || amount === undefined) return;
  const key = variantKey(routeKey, amount);
  const existing = candidateMap.get(key) || {
    key,
    routeKey,
    amount,
    roles: [],
    candidate: null,
    score: null,
  };
  appendUnique(existing.roles, [role]);
  if (candidate) existing.candidate = { ...(existing.candidate || {}), ...candidate };
  if (score) existing.score = score;
  if (!existing.routeKey && routeKey) existing.routeKey = routeKey;
  if ((existing.amount === null || existing.amount === undefined) && amount !== null && amount !== undefined) existing.amount = amount;
  candidateMap.set(key, existing);
}

function familyVerdictFromLoop(classification) {
  if (!classification) return null;
  if (classification === "durable_no_edge_route") {
    return {
      verdict: "drop",
      reasonCode: classification,
      reasonLabel: LOOP_FAMILY_REASON_LABELS[classification],
    };
  }
  if (classification === "policy_ready_route" || classification === "positive_but_below_policy_route" || classification === "near_policy_route") {
    return {
      verdict: "continue",
      reasonCode: classification,
      reasonLabel: LOOP_FAMILY_REASON_LABELS[classification],
    };
  }
  return {
    verdict: "observe_only",
    reasonCode: classification,
    reasonLabel: LOOP_FAMILY_REASON_LABELS[classification],
  };
}

function familyVerdictFromEdgeResearch(route = null) {
  const classification = route?.classification || null;
  if (!classification) return null;
  if (
    classification === "definite_edge_candidate" ||
    classification === "multi_level_candidate" ||
    classification === "missing_decay_survival" ||
    classification === "missing_decay_coverage"
  ) {
    return {
      verdict: "continue",
      reasonCode: classification,
      reasonLabel: EDGE_RESEARCH_REASON_LABELS[classification],
    };
  }
  if (classification === "single_level_only") {
    return {
      verdict: "observe_only",
      reasonCode: classification,
      reasonLabel: EDGE_RESEARCH_REASON_LABELS[classification],
    };
  }
  if (classification === "no_edge" && (route?.amountLevels ?? 0) < 2) {
    return {
      verdict: "observe_only",
      reasonCode: "single_level_only",
      reasonLabel: EDGE_RESEARCH_REASON_LABELS.single_level_only,
    };
  }
  return {
    verdict: "drop",
    reasonCode: classification,
    reasonLabel: EDGE_RESEARCH_REASON_LABELS[classification],
  };
}

function strongerVerdict(left, right) {
  const rank = { continue: 0, observe_only: 1, drop: 2 };
  if (!left) return right;
  if (!right) return left;
  return (rank[right.verdict] ?? 99) < (rank[left.verdict] ?? 99) ? right : left;
}

function buildRouteFamilyAudits({ noEdgePersistence = null, edgeResearch = null } = {}) {
  const noEdgeByRoute = new Map((noEdgePersistence?.routes || []).map((item) => [item.routeKey, item]));
  const edgeResearchByRoute = new Map((edgeResearch?.routes || []).map((item) => [item.routeKey, item]));
  const routeKeys = new Set([...noEdgeByRoute.keys(), ...edgeResearchByRoute.keys()]);

  const audits = [...routeKeys].map((routeKey) => {
    const noEdgeRoute = noEdgeByRoute.get(routeKey) || null;
    const edgeRoute = edgeResearchByRoute.get(routeKey) || null;
    const loopVerdict = familyVerdictFromLoop(noEdgeRoute?.classification || null);
    const edgeVerdict = familyVerdictFromEdgeResearch(edgeRoute);
    const selectedVerdict = strongerVerdict(loopVerdict, edgeVerdict);

    return {
      routeKey,
      label: routeLabel(noEdgeRoute || edgeRoute),
      verdict: selectedVerdict?.verdict || "observe_only",
      verdictReasonCode: selectedVerdict?.reasonCode || "insufficient_route_evidence",
      verdictReasonLabel: selectedVerdict?.reasonLabel || LOOP_FAMILY_REASON_LABELS.insufficient_route_evidence,
      loopClassification: noEdgeRoute?.classification || null,
      edgeResearchClassification: edgeRoute?.classification || null,
      measuredLevelCount: noEdgeRoute?.measuredLevelCount ?? null,
      positiveLevelCount: noEdgeRoute?.positiveLevelCount ?? null,
      policyReadyLevelCount: noEdgeRoute?.policyReadyLevelCount ?? null,
      bestMeasuredLoopNetUsd: finite(noEdgeRoute?.bestMeasuredLoopNetUsd),
      minGapToPolicyUsd: finite(noEdgeRoute?.minGapToPolicyUsd),
      medianGapToPolicyUsd: finite(noEdgeRoute?.medianGapToPolicyUsd),
      profitableLevels: edgeRoute?.profitableLevels ?? null,
      amountLevels: edgeRoute?.amountLevels ?? null,
      bestNetEdgeUsd: finite(edgeRoute?.bestNetEdgeUsd),
    };
  });

  const verdictRank = { continue: 0, observe_only: 1, drop: 2 };
  audits.sort(
    (left, right) =>
      (verdictRank[left.verdict] ?? 99) - (verdictRank[right.verdict] ?? 99) ||
      ((left.minGapToPolicyUsd ?? Number.POSITIVE_INFINITY) - (right.minGapToPolicyUsd ?? Number.POSITIVE_INFINITY)) ||
      ((right.bestMeasuredLoopNetUsd ?? right.bestNetEdgeUsd ?? Number.NEGATIVE_INFINITY) -
        (left.bestMeasuredLoopNetUsd ?? left.bestNetEdgeUsd ?? Number.NEGATIVE_INFINITY)) ||
      String(left.routeKey).localeCompare(String(right.routeKey)),
  );

  return audits;
}

function classifyCandidateAudit({ candidate, score, measuredLoop, evidence, routeFamily, roles }) {
  if (routeFamily?.verdict === "drop") {
    return {
      verdict: "drop",
      reasonCode: "durable_no_edge_family",
      reasonLabel: CANDIDATE_REASON_LABELS.durable_no_edge_family,
    };
  }

  if (score?.tradeReadiness === "shadow_candidate_review_only") {
    return {
      verdict: "continue",
      reasonCode: "candidate_review_only",
      reasonLabel: CANDIDATE_REASON_LABELS.candidate_review_only,
    };
  }

  if (Number.isFinite(measuredLoop?.measuredLoopNetUsd) && measuredLoop.measuredLoopNetUsd > 0) {
    if (Number.isFinite(score?.effectiveSystemNetPnlUsd) && score.effectiveSystemNetPnlUsd <= 0) {
      return {
        verdict: "continue",
        reasonCode: "measured_positive_but_system_negative",
        reasonLabel: CANDIDATE_REASON_LABELS.measured_positive_but_system_negative,
      };
    }
    return {
      verdict: "continue",
      reasonCode: "measured_loop_positive",
      reasonLabel: CANDIDATE_REASON_LABELS.measured_loop_positive,
    };
  }

  const isCurrentCanary = roles.includes("active_canary");
  const negativeSystemNet = Number.isFinite(score?.effectiveSystemNetPnlUsd) && score.effectiveSystemNetPnlUsd <= 0;
  if (isCurrentCanary && (negativeSystemNet || score?.tradeReadiness === "reject_no_net_edge")) {
    return {
      verdict: "observe_only",
      reasonCode: "prep_ready_but_negative",
      reasonLabel: CANDIDATE_REASON_LABELS.prep_ready_but_negative,
    };
  }

  if (!score) {
    return {
      verdict: "observe_only",
      reasonCode: "score_missing",
      reasonLabel: CANDIDATE_REASON_LABELS.score_missing,
    };
  }

  if ((evidence?.shadowObservationCount || 0) < 3 || (evidence?.quoteAttemptCount || 0) < 2) {
    return {
      verdict: "observe_only",
      reasonCode: "thin_shadow_evidence",
      reasonLabel: CANDIDATE_REASON_LABELS.thin_shadow_evidence,
    };
  }

  return {
    verdict: "observe_only",
    reasonCode: "blocked_by_readiness_or_data",
    reasonLabel: CANDIDATE_REASON_LABELS.blocked_by_readiness_or_data,
  };
}

function strategyDecision(familyAudits = []) {
  if (familyAudits.some((item) => item.verdict === "continue")) {
    return {
      code: "keep_researching",
      label: "Keep researching within the current BOB Gateway / BTC thesis",
    };
  }

  if (familyAudits.length > 0 && familyAudits.every((item) => item.verdict === "drop")) {
    return {
      code: "pivot_within_current_thesis",
      label: "Pivot within the current thesis instead of forcing the current candidates",
    };
  }

  return {
    code: "stay_blocked",
    label: "Stay blocked and keep collecting evidence before any canary promotion",
  };
}

export function buildPivotDecisionSummary({ economicsAudit = null, objectivePlans = null } = {}) {
  const summary = economicsAudit?.summary || null;
  if (!summary?.strategyDecisionCode) return null;
  const nextPlan =
    summary.strategyDecisionCode === "keep_researching"
      ? objectivePlans?.executionReview || objectivePlans?.discovery || null
      : summary.strategyDecisionCode === "pivot_within_current_thesis"
        ? objectivePlans?.discovery || null
        : null;
  return {
    decisionCode: summary.strategyDecisionCode,
    decisionLabel: summary.strategyDecisionLabel || null,
    status:
      summary.strategyDecisionCode === "keep_researching"
        ? "execution_review"
        : summary.strategyDecisionCode === "pivot_within_current_thesis"
          ? "pivot_within_current_thesis"
          : "stay_blocked",
    focusRouteKey: nextPlan?.routeKey || summary.measuredLeader?.routeKey || summary.currentCanary?.routeKey || null,
    focusRouteLabel: nextPlan?.label || nextPlan?.routeLabel || summary.measuredLeader?.label || summary.currentCanary?.label || null,
    focusAmount: nextPlan?.amount || summary.measuredLeader?.amount || summary.currentCanary?.amount || null,
    nextActionCode: nextPlan?.nextActionCode || null,
    nextActionLabel: nextPlan?.nextActionLabel || null,
    command: nextPlan?.command || null,
    currentCanaryVerdict: summary.currentCanary?.verdict || null,
    currentCanaryReasonCode: summary.currentCanary?.verdictReasonCode || null,
    measuredLeaderVerdict: summary.measuredLeader?.verdict || null,
    measuredLeaderReasonCode: summary.measuredLeader?.verdictReasonCode || null,
    candidateCounts: summary.candidateCounts || null,
    familyCounts: summary.familyCounts || null,
    evidenceCounts: summary.evidenceCounts || null,
  };
}

export function buildRouteEconomicsAudit({
  scoreSnapshot = null,
  routePlan = null,
  edgeViability = null,
  edgeResearch = null,
  noEdgePersistence = null,
  quotes = [],
  quoteFailures = [],
  shadowObservations = [],
} = {}) {
  const scores = scoreSnapshot?.scores || [];
  const scoreByKey = latestScoreByVariant(scores);
  const routeEvidenceMap = routeEvidenceByRoute({ scores, shadowObservations });
  const measuredByKey = measuredLoopMap(edgeViability);
  const routeFamilyAudits = buildRouteFamilyAudits({ noEdgePersistence, edgeResearch });
  const routeFamilyByRoute = new Map(routeFamilyAudits.map((item) => [item.routeKey, item]));
  const selectionGap = buildCanarySelectionGap({
    routePlan,
    edgeViability,
    scoreSnapshot,
  });

  const candidateMap = new Map();
  for (const [index, candidate] of (routePlan?.topCandidates || []).entries()) {
    addCandidateVariant(candidateMap, {
      routeKey: candidate.routeKey,
      amount: candidate.amount,
      role:
        index === 0
          ? "active_canary"
          : candidate.viableForPrep
            ? "prep_candidate"
            : candidate.txReady
              ? "tx_ready_shadow"
              : "research_candidate",
      candidate,
      score: scoreByKey.get(variantKey(candidate.routeKey, candidate.amount)) || null,
    });
  }

  if (selectionGap?.measuredLeader?.routeKey) {
    const key = variantKey(selectionGap.measuredLeader.routeKey, selectionGap.measuredLeader.amount);
    addCandidateVariant(candidateMap, {
      routeKey: selectionGap.measuredLeader.routeKey,
      amount: selectionGap.measuredLeader.amount,
      role: "measured_leader",
      candidate: routePlan?.candidates?.find((item) => sameVariant(item, selectionGap.measuredLeader)) || null,
      score: scoreByKey.get(key) || null,
    });
  }

  const stablecoinRoute = bestStablecoinScore(scoreSnapshot);
  if (stablecoinRoute?.routeKey) {
    addCandidateVariant(candidateMap, {
      routeKey: stablecoinRoute.routeKey,
      amount: stablecoinRoute.amount,
      role: "best_stablecoin_route",
      candidate: routePlan?.candidates?.find((item) => sameVariant(item, stablecoinRoute)) || null,
      score: stablecoinRoute,
    });
  }

  const roleRank = {
    active_canary: 0,
    measured_leader: 1,
    best_stablecoin_route: 2,
    prep_candidate: 3,
    tx_ready_shadow: 4,
    research_candidate: 5,
  };

  const candidateAudits = [...candidateMap.values()].map((entry) => {
    const key = entry.key;
    const score = entry.score || scoreByKey.get(key) || null;
    const measuredLoop = measuredByKey.get(key) || null;
    const candidate = entry.candidate || {
      routeKey: entry.routeKey,
      amount: entry.amount,
      label: routeLabel(score || measuredLoop || entry),
      srcChain: score?.srcChain || measuredLoop?.srcChain || null,
      dstChain: score?.dstChain || measuredLoop?.dstChain || null,
      tradeReadiness: score?.tradeReadiness || null,
    };
    const evidence = summarizeShadowCandidateEvidence({
      candidate,
      quotes,
      quoteFailures,
      shadowObservations,
      scores,
    });
    const routeFamily = routeFamilyByRoute.get(entry.routeKey) || null;
    const routeEvidence = routeEvidenceMap.get(entry.routeKey) || null;
    const blockers = [];
    appendUnique(blockers, candidate.prepBlockers || []);
    appendUnique(blockers, candidate.scoreDisqualifiers || []);
    appendUnique(blockers, score?.dataGaps || []);
    appendUnique(
      blockers,
      (evidence?.rejectionReasons || []).map((item) => item.reason),
    );
    const verdict = classifyCandidateAudit({
      candidate,
      score,
      measuredLoop,
      evidence,
      routeFamily,
      roles: entry.roles,
    });

    return {
      routeKey: entry.routeKey,
      amount: entry.amount,
      label: routeLabel(candidate || score || measuredLoop || entry),
      roles: entry.roles.sort((left, right) => (roleRank[left] ?? 99) - (roleRank[right] ?? 99)),
      verdict: verdict.verdict,
      verdictReasonCode: verdict.reasonCode,
      verdictReasonLabel: verdict.reasonLabel,
      tradeReadiness: score?.tradeReadiness || candidate.tradeReadiness || null,
      viableForPrep: candidate.viableForPrep ?? null,
      txReady: candidate.txReady ?? null,
      exactGasDone: candidate.exactGasDone ?? null,
      netEdgeUsd: finite(score?.netEdgeUsd ?? candidate.netEdgeUsd),
      executableNetEdgeUsd: finite(score?.executableNetEdgeUsd ?? candidate.executableNetEdgeUsd),
      effectiveSystemNetPnlUsd: finite(score?.effectiveSystemNetPnlUsd),
      measuredLoopNetUsd: finite(measuredLoop?.measuredLoopNetUsd),
      gapToPolicyUsd: finite(measuredLoop?.gapToPolicyUsd),
      routeFamilyVerdict: routeFamily?.verdict || null,
      routeFamilyClassification: routeFamily?.loopClassification || routeFamily?.edgeResearchClassification || null,
      blockers,
      evidence: evidence
        ? {
            quoteSampleCount: evidence.quoteSampleCount,
            quoteFailureCount: evidence.quoteFailureCount,
            quoteAttemptCount: evidence.quoteAttemptCount,
            quoteSuccessRate: finite(evidence.quoteSuccessRate),
            quoteLatencyP95Ms: finite(evidence.quoteLatencyP95Ms),
            shadowObservationCount: evidence.shadowObservationCount,
            latestQuoteObservedAt: evidence.latestQuoteObservedAt || null,
            latestFailureObservedAt: evidence.latestFailureObservedAt || null,
            latestObservationObservedAt: evidence.latestObservationObservedAt || null,
            latestObservedEdgeUsd: finite(evidence.latestObservedEdgeUsd),
            latestKnownCostUsd: finite(evidence.latestKnownCostUsd),
            latestRouteFailureRate: finite(evidence.latestRouteFailureRate),
            latestTradeReadiness: evidence.latestTradeReadiness || null,
            routeAmountLevelCount: routeEvidence?.routeAmountLevelCount ?? (candidate.amount !== null && candidate.amount !== undefined ? 1 : 0),
            routeAmountLevels: routeEvidence?.routeAmountLevels || (candidate.amount !== null && candidate.amount !== undefined ? [String(candidate.amount)] : []),
            routeHourBucketCount: routeEvidence?.routeHourBucketCount ?? 0,
            routeShadowObservationCount: routeEvidence?.routeShadowObservationCount ?? 0,
            routeLatestObservationObservedAt: routeEvidence?.routeLatestObservationObservedAt || null,
            rejectionReasons: evidence.rejectionReasons,
          }
        : null,
    };
  });

  const verdictRank = { continue: 0, observe_only: 1, drop: 2 };
  candidateAudits.sort(
    (left, right) =>
      Math.min(...left.roles.map((role) => roleRank[role] ?? 99)) - Math.min(...right.roles.map((role) => roleRank[role] ?? 99)) ||
      (verdictRank[left.verdict] ?? 99) - (verdictRank[right.verdict] ?? 99) ||
      ((right.measuredLoopNetUsd ?? right.effectiveSystemNetPnlUsd ?? Number.NEGATIVE_INFINITY) -
        (left.measuredLoopNetUsd ?? left.effectiveSystemNetPnlUsd ?? Number.NEGATIVE_INFINITY)) ||
      String(left.routeKey).localeCompare(String(right.routeKey)),
  );

  const candidateCounts = {
    continue: candidateAudits.filter((item) => item.verdict === "continue").length,
    observeOnly: candidateAudits.filter((item) => item.verdict === "observe_only").length,
    drop: candidateAudits.filter((item) => item.verdict === "drop").length,
    continueWhileSystemNegative: candidateAudits.filter(
      (item) => item.verdict === "continue" && Number.isFinite(item.effectiveSystemNetPnlUsd) && item.effectiveSystemNetPnlUsd <= 0,
    ).length,
  };
  const familyCounts = {
    continue: routeFamilyAudits.filter((item) => item.verdict === "continue").length,
    observeOnly: routeFamilyAudits.filter((item) => item.verdict === "observe_only").length,
    drop: routeFamilyAudits.filter((item) => item.verdict === "drop").length,
  };
  const evidenceCounts = {
    denseShadowCandidates: candidateAudits.filter((item) => (item.evidence?.routeShadowObservationCount ?? 0) >= 3).length,
    multiAmountCandidates: candidateAudits.filter((item) => (item.evidence?.routeAmountLevelCount ?? 0) >= 2).length,
    multiHourCandidates: candidateAudits.filter((item) => (item.evidence?.routeHourBucketCount ?? 0) >= 2).length,
  };
  const currentCanary = candidateAudits.find((item) => item.roles.includes("active_canary")) || null;
  const measuredLeader = candidateAudits.find((item) => item.roles.includes("measured_leader")) || null;
  const decision = strategyDecision(routeFamilyAudits);

  return {
    schemaVersion: 1,
    generatedAt: scoreSnapshot?.generatedAt || null,
    summary: {
      strategyDecisionCode: decision.code,
      strategyDecisionLabel: decision.label,
      candidateCounts,
      familyCounts,
      evidenceCounts,
      currentCanary: currentCanary
        ? {
            routeKey: currentCanary.routeKey,
            amount: currentCanary.amount,
            label: currentCanary.label,
            verdict: currentCanary.verdict,
            verdictReasonCode: currentCanary.verdictReasonCode,
            verdictReasonLabel: currentCanary.verdictReasonLabel,
          }
        : null,
      measuredLeader: measuredLeader
        ? {
            routeKey: measuredLeader.routeKey,
            amount: measuredLeader.amount,
            label: measuredLeader.label,
            verdict: measuredLeader.verdict,
            verdictReasonCode: measuredLeader.verdictReasonCode,
            verdictReasonLabel: measuredLeader.verdictReasonLabel,
          }
        : null,
    },
    selectionGap,
    candidateAudits,
    routeFamilyAudits,
  };
}
