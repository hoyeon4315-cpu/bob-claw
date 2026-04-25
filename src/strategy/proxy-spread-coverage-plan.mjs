function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function bigintSort(values = []) {
  return [...values]
    .map((value) => String(value))
    .sort((left, right) => {
      try {
        const a = BigInt(left);
        const b = BigInt(right);
        return a < b ? -1 : a > b ? 1 : 0;
      } catch {
        return String(left).localeCompare(String(right));
      }
    });
}

function priorityForAction(nextAction, reason) {
  if (nextAction === "expand_missing_side") return { rank: 0, label: "critical" };
  if (nextAction === "expand_amount_ladder" && reason === "no_matched_amount_levels") return { rank: 1, label: "high" };
  if (nextAction === "expand_amount_ladder") return { rank: 2, label: "high" };
  if (nextAction === "refresh_stale_quotes") return { rank: 3, label: "medium" };
  return { rank: 4, label: "observe" };
}

function retryFactor(summary = null) {
  return summary?.overfitRisks?.includes("all_quotes_stale") ? 2 : 1;
}

function planAmountLevels(target = null) {
  const buyLevels = bigintSort(target?.buyAmountLevels || []);
  const sellLevels = bigintSort(target?.sellAmountLevels || []);
  const matchedLevels = bigintSort(target?.matchedAmountLevels || []);
  const sharedLevels = bigintSort(unique([...buyLevels, ...sellLevels]));

  if (target?.nextAction === "expand_missing_side") {
    if ((target?.buyAmountLevelCount || 0) === 0) return sellLevels.length ? sellLevels : matchedLevels;
    if ((target?.sellAmountLevelCount || 0) === 0) return buyLevels.length ? buyLevels : matchedLevels;
  }

  if (target?.nextAction === "expand_amount_ladder") {
    const missing = sharedLevels.filter((amount) => !matchedLevels.includes(amount));
    return missing.length ? missing : sharedLevels;
  }

  if (target?.nextAction === "refresh_stale_quotes") {
    return matchedLevels.length ? matchedLevels : sharedLevels;
  }

  return matchedLevels.length ? matchedLevels : sharedLevels;
}

function quoteQuotaNeeded(target = null, summary = null) {
  const retry = retryFactor(summary);
  const chainCount = Math.max(2, target?.buyChainCount || 0, target?.sellChainCount || 0);
  const amountLevels = planAmountLevels(target);
  const amountCount = Math.max(1, amountLevels.length || 0, target?.matchedAmountLevelCount || 0);

  if (target?.nextAction === "expand_missing_side") {
    const missingSides = [target?.buyAmountLevelCount === 0, target?.sellAmountLevelCount === 0].filter(Boolean).length || 1;
    return chainCount * amountCount * missingSides * retry;
  }
  if (target?.nextAction === "expand_amount_ladder") {
    const desiredLevels = Math.max(2, target?.buyAmountLevelCount || 0, target?.sellAmountLevelCount || 0);
    const additionalLevels = Math.max(1, desiredLevels - (target?.matchedAmountLevelCount || 0));
    return chainCount * additionalLevels * retry;
  }
  if (target?.nextAction === "refresh_stale_quotes") {
    return chainCount * amountCount * retry;
  }
  return 0;
}

function commandForTarget(target = null) {
  const chains = unique([...(target?.buyChains || []), ...(target?.sellChains || [])]);
  if (!chains.length) return null;
  return [
    `npm run quote:dex -- --chains=${chains.join(",")} --include-stable-entry --route-limit=64`,
    "npm run score:gateway -- --write",
    "npm run report:btc-proxy-spreads",
    "npm run report:proxy-spread-coverage -- --write",
  ].join(" && ");
}

function mitigationFlags(summary = null) {
  const risks = new Set(summary?.overfitRisks || []);
  return {
    thinBuyQuoteCoverage: risks.has("thin_buy_quote_coverage"),
    thinSellQuoteCoverage: risks.has("thin_sell_quote_coverage"),
    allQuotesStale: risks.has("all_quotes_stale"),
    singleProxyGroup: risks.has("single_proxy_group"),
    smallOpportunitySurface: risks.has("small_opportunity_surface"),
  };
}

function buildPlanEntry(target = null, summary = null) {
  const priority = priorityForAction(target?.nextAction, target?.reason);
  const amountLevels = planAmountLevels(target);
  const chains = unique([...(target?.buyChains || []), ...(target?.sellChains || [])]);
  return {
    proxyGroup: target?.proxyGroup || null,
    nextAction: target?.nextAction || null,
    reason: target?.reason || null,
    priority: priority.label,
    priorityRank: priority.rank,
    quoteQuotaNeeded: quoteQuotaNeeded(target, summary),
    targetChainCount: Math.max(2, target?.buyChainCount || 0, target?.sellChainCount || 0),
    targetAmountLevels: amountLevels,
    currentCoverage: {
      buyAmountLevelCount: target?.buyAmountLevelCount ?? 0,
      sellAmountLevelCount: target?.sellAmountLevelCount ?? 0,
      matchedAmountLevelCount: target?.matchedAmountLevelCount ?? 0,
      buyChainCount: target?.buyChainCount ?? 0,
      sellChainCount: target?.sellChainCount ?? 0,
      freshestBuyAgeMinutes: finite(target?.freshestBuyAgeMinutes),
      freshestSellAgeMinutes: finite(target?.freshestSellAgeMinutes),
    },
    executionCommand: commandForTarget(target),
    targetChains: chains,
    sampleBiasRisks: summary?.overfitRisks || [],
  };
}

export function buildProxySpreadCoveragePlan({ proxySpreadSummary = null, proxyGroup = null, now = null } = {}) {
  const coverageTargets = (proxySpreadSummary?.coverageTargets || [])
    .filter((item) => !proxyGroup || item.proxyGroup === proxyGroup)
    .map((item) => buildPlanEntry(item, proxySpreadSummary))
    .sort(
      (left, right) =>
        left.priorityRank - right.priorityRank ||
        right.quoteQuotaNeeded - left.quoteQuotaNeeded ||
        String(left.proxyGroup).localeCompare(String(right.proxyGroup)),
    );

  const actionablePlan = coverageTargets.filter((item) => item.nextAction && item.nextAction !== "watch_surface");
  const topEntry = actionablePlan[0] || coverageTargets[0] || null;

  return {
    schemaVersion: 1,
    generatedAt: now || proxySpreadSummary?.generatedAt || new Date().toISOString(),
    overfitAssessment: proxySpreadSummary?.overfitAssessment || null,
    overfitRisks: proxySpreadSummary?.overfitRisks || [],
    unmatchedObservedProxyGroups: proxySpreadSummary?.unmatchedObservedProxyGroups || [],
    summary: {
      planCount: coverageTargets.length,
      actionableCount: actionablePlan.length,
      totalQuoteQuotaNeeded: actionablePlan.reduce((sum, item) => sum + (item.quoteQuotaNeeded || 0), 0),
      nextProxyGroup: topEntry?.proxyGroup || null,
      nextAction: topEntry?.nextAction || null,
      nextReason: topEntry?.reason || null,
      nextCommand: topEntry?.executionCommand || null,
    },
    overfitMitigation: mitigationFlags(proxySpreadSummary),
    plan: coverageTargets,
    notes: [
      "Coverage plans widen quote surface before any spread is treated as stable evidence.",
      "Quote quota counts are planning targets, not proof of profitability.",
      "Keep proxy spread candidates blocked while sample bias flags or stale quotes remain active.",
    ],
  };
}

export function summarizeProxySpreadCoveragePlan(plan = null) {
  if (!plan) return null;
  const top = plan.plan?.find((item) => item.nextAction !== "watch_surface") || plan.plan?.[0] || null;
  return {
    generatedAt: plan.generatedAt || null,
    overfitAssessment: plan.overfitAssessment || null,
    planCount: plan.summary?.planCount ?? 0,
    actionableCount: plan.summary?.actionableCount ?? 0,
    totalQuoteQuotaNeeded: plan.summary?.totalQuoteQuotaNeeded ?? 0,
    nextProxyGroup: top?.proxyGroup || null,
    nextAction: top?.nextAction || null,
    nextReason: top?.reason || null,
    nextPriority: top?.priority || null,
    nextQuoteQuotaNeeded: top?.quoteQuotaNeeded ?? 0,
    nextCommand: top?.executionCommand || null,
  };
}
