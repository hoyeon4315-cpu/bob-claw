import { MERKL_OPPORTUNITY_POLICY } from "../config/merkl-opportunity-policy.mjs";
import { evaluateMerklOpportunities } from "./merkl-opportunity-prefilter.mjs";
import { normalizeMerklOpportunities } from "./merkl-opportunity-normalizer.mjs";

function compareOpportunities(left, right) {
  const decisionRank = { candidate: 0, watch: 1, blocked: 2 };
  if ((decisionRank[left.decision] ?? 9) !== (decisionRank[right.decision] ?? 9)) {
    return (decisionRank[left.decision] ?? 9) - (decisionRank[right.decision] ?? 9);
  }
  if ((right.score ?? 0) !== (left.score ?? 0)) return (right.score ?? 0) - (left.score ?? 0);
  return String(left.opportunityId || "").localeCompare(String(right.opportunityId || ""));
}

function summarizeCounts(items = []) {
  return {
    candidateCount: items.filter((item) => item.decision === "candidate").length,
    watchCount: items.filter((item) => item.decision === "watch").length,
    blockedCount: items.filter((item) => item.decision === "blocked").length,
    highOverfitRiskCount: items.filter((item) => item.overfitRisk === "high").length,
    liveCanaryCandidateCount: items.filter((item) => item.validationMode === "tiny_live_canary_only").length,
  };
}

function buildRotationPlan(items = [], policy = MERKL_OPPORTUNITY_POLICY) {
  const expiring = items
    .filter((item) => item.decision !== "blocked")
    .filter((item) => Number.isFinite(item.campaignRemainingHours) && item.campaignRemainingHours <= policy.entry.rotationLookaheadHours)
    .sort(compareOpportunities);

  return expiring.slice(0, 10).map((item) => {
    const replacement =
      items
        .filter((candidate) => candidate.opportunityId !== item.opportunityId)
        .filter((candidate) => candidate.decision === "candidate")
        .filter((candidate) => candidate.mappedStrategyId && candidate.mappedStrategyId === item.mappedStrategyId)
        .filter((candidate) => (candidate.campaignRemainingHours || 0) > (item.campaignRemainingHours || 0))
        .sort(compareOpportunities)[0] || null;

    return {
      opportunityId: item.opportunityId,
      name: item.name,
      chain: item.chain,
      protocolId: item.protocolId,
      mappedStrategyId: item.mappedStrategyId,
      hoursRemaining: item.campaignRemainingHours,
      action: replacement ? "prepare_rotation_candidate" : "review_stay_vs_unwind",
      replacementOpportunityId: replacement?.opportunityId || null,
      replacementName: replacement?.name || null,
      replacementChain: replacement?.chain || null,
      replacementProtocolId: replacement?.protocolId || null,
      replacementScore: replacement?.score ?? null,
    };
  });
}

export function buildMerklOpportunityReport({
  opportunities = [],
  campaigns = [],
  policy = MERKL_OPPORTUNITY_POLICY,
  now = null,
} = {}) {
  const normalized = normalizeMerklOpportunities(opportunities, { campaigns, now });
  const evaluated = evaluateMerklOpportunities(normalized, { policy }).sort(compareOpportunities);
  const summary = summarizeCounts(evaluated);
  const topCandidates = evaluated.filter((item) => item.decision === "candidate").slice(0, 10);
  const topWatchlist = evaluated.filter((item) => item.decision === "watch").slice(0, 10);
  const rotationPlan = buildRotationPlan(evaluated, policy);

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    policyProfile: policy.profileId,
    validationModel: {
      dryRunRole: "preflight_only",
      primaryEconomicEvidence: "tiny_live_canary",
      scaleUpRule: `requires >= ${policy.entry.minHoursRemainingForScaleUp}h remaining campaign window plus live receipt evidence`,
    },
    summary: {
      opportunityCount: opportunities.length,
      campaignCount: campaigns.length,
      btcRelevantCount: evaluated.filter((item) => item.hasBtcExposure).length,
      multiAssetRelevantCount: evaluated.filter((item) => item.hasSupportedAssetExposure).length,
      topCandidateId: topCandidates[0]?.opportunityId || null,
      topCandidateStrategyId: topCandidates[0]?.mappedStrategyId || null,
      rotationCandidateCount: rotationPlan.length,
      ...summary,
    },
    topCandidates,
    topWatchlist,
    rotationPlan,
    opportunities: evaluated,
  };
}
