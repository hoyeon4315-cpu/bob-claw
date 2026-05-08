import { CAPITAL_ALLOCATOR_POLICY } from "../config/capital-allocator.mjs";
import { canonicalGatewayChain } from "../config/gateway-destinations.mjs";
import {
  effectiveMicroBudgetUsd,
  resolveEffectiveSmallCapitalBudgets,
} from "../config/small-capital-campaign-mode.mjs";

function byTemplateId(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.templateId) continue;
    map.set(item.templateId, item);
  }
  return map;
}

function allocationStatus(item = {}) {
  return item?.allocationGate?.status || "review_only";
}

function allocationBlockers(item = {}) {
  if (Array.isArray(item.allocationGate?.blockers)) return item.allocationGate.blockers;
  return item.allocationGate?.status ? [] : ["allocation_gate_missing"];
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function perItemCapUsd(item, kind) {
  const estimate = kind === "active"
    ? item?.economics?.activeBudgetEstimate
    : item?.economics?.planningBudgetEstimate;
  const direct = finitePositive(estimate?.maxAllocationUsd);
  if (direct !== null) return direct;
  const stratCap = finitePositive(item?.caps?.perChainUsd?.[item?.chain]);
  return stratCap;
}

function scoreWeight(item) {
  const score = Number(item?.chainScore ?? item?.score);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

function allocationBucket(item = {}, policy = CAPITAL_ALLOCATOR_POLICY) {
  if (item.scoreSource === "prior" || item.chainScoreSource === "prior") return "explore";
  const alphaSampleCount = finiteNumber(item.receiptSummary?.alphaSampleCount ?? item.alphaSampleCount);
  if (alphaSampleCount !== null && alphaSampleCount < policy.exploreMinSamples) return "explore";
  const sampleCount = finiteNumber(item.receiptSummary?.sampleCount ?? item.sampleCount);
  if (sampleCount !== null && sampleCount < policy.exploreMinSamples) return "explore";
  const freshnessHours = finiteNumber(item.receiptSummary?.receiptFreshnessHours ?? item.receiptFreshnessHours);
  if (freshnessHours !== null && freshnessHours > policy.exploreReceiptFreshnessHours) return "explore";
  return "exploit";
}

function exploreCapUsd(item = {}, budgetUsd = 0, policy = CAPITAL_ALLOCATOR_POLICY) {
  const scaled = resolveEffectiveSmallCapitalBudgets({ operatingCapitalUsd: budgetUsd });
  const defaultBudgets = scaled.effectiveBudgets.defaultBudgetsUsd;
  const radarCaps = scaled.effectiveBudgets.radarCaps;
  const caps = [
    policy.exploreCandidateMaxUsd,
    Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd * policy.smallCapitalMicroTestHardCapPct : null,
    defaultBudgets.microMaxUsd,
    defaultBudgets.initialCampaignUsd,
    defaultBudgets.initialMicroUsd,
  ];
  const itemCap = perItemCapUsd(item, "active");
  if (itemCap !== null) caps.push(itemCap);
  if (/radar/u.test(String(item.strategyId || item.templateId || ""))) caps.push(radarCaps.perCanaryUsd);
  return Math.min(...caps.filter((value) => Number.isFinite(value) && value > 0));
}

function distributeWeighted({ items, budgetUsd, kind, policy, totalBudgetUsd = budgetUsd }) {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || !items.length) {
    return { allocations: [], remaining: Number.isFinite(budgetUsd) ? budgetUsd : null };
  }
  const totalWeight = items.reduce((sum, item) => sum + scoreWeight(item), 0);
  let remaining = budgetUsd;
  const allocations = [];
  for (const item of items) {
    if (remaining <= 0) break;
    const weight = scoreWeight(item);
    const weightShare = totalWeight > 0
      ? (weight / totalWeight) * budgetUsd
      : budgetUsd / items.length;
    const itemCap = perItemCapUsd(item, kind);
    const bucket = item.allocationBucket || allocationBucket(item, policy);
    const caps = [];
    if (itemCap !== null) caps.push(itemCap);
    if (bucket === "explore") caps.push(exploreCapUsd(item, totalBudgetUsd, policy));
    const cappedShare = caps.length ? Math.min(weightShare, ...caps) : weightShare;
    const allocationUsd = Math.max(0, Math.min(remaining, cappedShare));
    if (allocationUsd <= 0) continue;
    const estimate = kind === "active"
      ? item.economics?.activeBudgetEstimate
      : item.economics?.planningBudgetEstimate;
    allocations.push({
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId,
      label: item.label,
      score: scoreWeight(item),
      scoreSource: item.scoreSource || item.chainScoreSource || null,
      chainScore: item.chainScore ?? null,
      widePosterior: item.widePosterior ?? null,
      chainScoreBlockers: item.chainScoreBlockers || [],
      allocationBucket: bucket,
      allocationUsd,
      estimatedNetBps: estimate?.estimatedNetBps ?? null,
      estimatedNetUsd: estimate?.estimatedNetUsd ?? null,
    });
    remaining -= allocationUsd;
  }
  return { allocations, remaining };
}

function distributeBudget({ items, budgetUsd, kind, policy = CAPITAL_ALLOCATOR_POLICY }) {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || !items.length) {
    return { allocations: [], remaining: Number.isFinite(budgetUsd) ? budgetUsd : null };
  }
  const eligible = items.filter((item) => {
    const estimate = kind === "active"
      ? item.economics?.activeBudgetEstimate
      : item.economics?.planningBudgetEstimate;
    return estimate?.passesPolicy === true;
  });
  if (!eligible.length) return { allocations: [], remaining: budgetUsd };

  const bucketed = eligible.map((item) => ({
    ...item,
    allocationBucket: allocationBucket(item, policy),
  }));
  const exploreItems = bucketed
    .filter((item) => item.allocationBucket === "explore")
    .slice(0, policy.exploreMaxConcurrent);
  const exploitItems = bucketed.filter((item) => item.allocationBucket === "exploit");
  const exploreBudgetUsd = Math.min(
    budgetUsd * policy.exploreSharePct,
    effectiveMicroBudgetUsd(budgetUsd),
  );
  const exploreResult = distributeWeighted({
    items: exploreItems,
    budgetUsd: exploreBudgetUsd,
    kind,
    policy,
    totalBudgetUsd: budgetUsd,
  });
  const actualExploreUsd = exploreResult.allocations.reduce((sum, item) => sum + item.allocationUsd, 0);
  const exploitResult = distributeWeighted({
    items: exploitItems,
    budgetUsd: Math.max(0, budgetUsd - actualExploreUsd),
    kind,
    policy,
    totalBudgetUsd: budgetUsd,
  });
  const allocations = [...exploitResult.allocations, ...exploreResult.allocations];
  const remaining = budgetUsd - allocations.reduce((sum, item) => sum + item.allocationUsd, 0);
  return { allocations, remaining };
}

function withChainScore(item = {}, chainScoreLedger = null) {
  const chain = canonicalGatewayChain(item.chain) || item.chain || null;
  const ledgerEntry = chainScoreLedger?.byChain?.[chain] || null;
  if (!ledgerEntry) {
    return {
      ...item,
      chain,
      chainScore: null,
      chainScoreSource: item.scoreSource || null,
      widePosterior: item.widePosterior ?? null,
      chainScoreBlockers: item.chainScoreBlockers || [],
    };
  }
  return {
    ...item,
    chain,
    chainScore: ledgerEntry.chainScore,
    chainScoreSource: ledgerEntry.scoreSource || "ledger",
    scoreSource: ledgerEntry.scoreSource || "ledger",
    widePosterior: ledgerEntry.widePosterior === true,
    sampleCount: ledgerEntry.sampleCount ?? null,
    alphaSampleCount: ledgerEntry.alphaSampleCount ?? null,
    receiptFreshnessHours: ledgerEntry.receiptFreshnessHours ?? null,
    chainScoreBlockers: ledgerEntry.blockers || [],
  };
}

export function buildDestinationAllocationPlanner({
  promotionGate = null,
  economics = null,
  chainScoreLedger = null,
  now = new Date().toISOString(),
} = {}) {
  const generatedAt = now;
  const economicsByTemplate = byTemplateId(economics?.items);

  const promotable = (promotionGate?.items || [])
    .filter((item) => item.gate?.status === "promotable")
    .map((item) => ({
      ...withChainScore(item, chainScoreLedger),
      economics: economicsByTemplate.get(item.templateId) || null,
    }))
    .sort((left, right) => scoreWeight(right) - scoreWeight(left) || String(left.templateId).localeCompare(String(right.templateId)));
  const allocationReady = promotable.filter((item) => allocationStatus(item) === "allocation_ready");
  const reviewOnly = promotable.filter((item) => allocationStatus(item) === "review_only");

  const activeBudgetUsd = economics?.budgets?.activeBudgetUsd ?? null;
  const planningBudgetUsd = economics?.budgets?.planningBudgetUsd ?? null;

  const activeResult = Number.isFinite(activeBudgetUsd)
    ? distributeBudget({ items: allocationReady, budgetUsd: activeBudgetUsd, kind: "active" })
    : { allocations: [], remaining: null };
  const planningResult = Number.isFinite(planningBudgetUsd)
    ? distributeBudget({ items: allocationReady, budgetUsd: planningBudgetUsd, kind: "planning" })
    : { allocations: [], remaining: null };

  const blockedSummary = (promotionGate?.summary?.topBlockers || []).slice(0, 12);
  const allocationBlockedSummary = (promotionGate?.summary?.topAllocationBlockers || []).slice(0, 12);

  return {
    schemaVersion: 1,
    generatedAt,
    sources: {
      promotionGateGeneratedAt: promotionGate?.generatedAt || null,
      economicsGeneratedAt: economics?.generatedAt || null,
      chainScoreLedgerGeneratedAt: chainScoreLedger?.generatedAt || null,
    },
    budgets: {
      activeBudgetUsd,
      planningBudgetUsd,
    },
    summary: {
      promotableCount: promotable.length,
      allocationReadyCount: allocationReady.length,
      reviewOnlyCount: reviewOnly.length,
      activeAllocationCount: activeResult.allocations.length,
      planningAllocationCount: planningResult.allocations.length,
      activeBudgetRemainingUsd: activeResult.remaining,
      planningBudgetRemainingUsd: planningResult.remaining,
      exploitAllocationUsd: activeResult.allocations
        .filter((item) => item.allocationBucket === "exploit")
        .reduce((sum, item) => sum + item.allocationUsd, 0),
      exploreAllocationUsd: activeResult.allocations
        .filter((item) => item.allocationBucket === "explore")
        .reduce((sum, item) => sum + item.allocationUsd, 0),
      exploreCandidateCount: allocationReady.filter((item) => allocationBucket(item) === "explore").length,
      priorScoreCandidateCount: allocationReady.filter((item) =>
        item.scoreSource === "prior" || item.chainScoreSource === "prior",
      ).length,
      blockedSummary,
      allocationBlockedSummary,
      topReviewOnly: reviewOnly.slice(0, 10).map((item) => ({
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        score: item.score,
        blockers: allocationBlockers(item),
        nextAction: item.allocationGate?.nextAction || null,
      })),
    },
    activePlan: activeResult.allocations,
    planningPlan: planningResult.allocations,
  };
}
