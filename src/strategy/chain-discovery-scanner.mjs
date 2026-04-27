import { classifyWhitelistRisk } from "./whitelist-risk-classifier.mjs";

function groupBy(array, key) {
  const result = {};
  for (const item of array) {
    const value = item[key];
    if (!value) continue;
    result[value] = result[value] || [];
    result[value].push(item);
  }
  return result;
}

export function evaluateChainQualification(chainOpportunities = []) {
  const liveCount = chainOpportunities.filter((o) => o.status === "LIVE").length;
  const totalTvl = chainOpportunities.reduce((sum, o) => sum + (o.tvlUsd || 0), 0);
  const tierAB = chainOpportunities.filter((o) => {
    const c = classifyWhitelistRisk(o);
    return c.tier === "TIER_A" || c.tier === "TIER_B";
  }).length;

  return {
    liveCount,
    totalTvl,
    tierAB,
    qualified: liveCount >= 5 && totalTvl >= 2_000_000 && tierAB >= 1,
  };
}

export function scanChains(opportunities = []) {
  const byChain = groupBy(opportunities || [], "chain");
  const qualifying = [];

  for (const [chain, chainOpps] of Object.entries(byChain)) {
    const evalResult = evaluateChainQualification(chainOpps);
    if (evalResult.qualified) {
      qualifying.push({
        chain,
        ...evalResult,
      });
    }
  }

  return qualifying;
}
