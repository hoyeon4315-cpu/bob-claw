import { computeOpportunityScore } from "./opportunity-ranker.mjs";

export function evaluateAntiLockinGuard(position = {}, {
  currentScore = null,
  scoreHistory = [],
  now = Date.now(),
} = {}) {
  const recomputedScore = computeOpportunityScore(position);
  const referenceScore = Number.isFinite(currentScore) ? currentScore : recomputedScore;
  const flags = [];

  const recentScores = (scoreHistory || []).filter(
    (s) => s.at > now - 30 * 24 * 60 * 60 * 1000,
  );
  if (recentScores.length >= 2) {
    const oldest = recentScores[0].score;
    const newest = recentScores[recentScores.length - 1].score;
    if (oldest > 0 && (oldest - newest) / oldest > 0.30) {
      flags.push("mustReevaluate");
    }
  }

  const remainingHours = position.campaignRemainingHours;
  if (Number.isFinite(remainingHours) && remainingHours < 24) {
    flags.push("campaign_ends_within_24h");
  }

  const entryAtMs = position.entryAt ? new Date(position.entryAt).getTime() : null;
  const ageDays = entryAtMs ? (now - entryAtMs) / (24 * 60 * 60 * 1000) : 0;
  if (ageDays > 90) {
    flags.push("position_age_advisory_90d");
  }

  return {
    opportunityId: position.opportunityId || null,
    recomputedScore,
    referenceScore,
    flags,
    scoreEqualityHolds: recomputedScore === referenceScore,
  };
}
