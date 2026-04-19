import { buildDefaultTreasuryPolicy } from "../treasury/policy.mjs";

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hasValue(value) {
  return value != null && Number.isFinite(Number(value));
}

function numeric(value) {
  return hasValue(value) ? Number(value) : null;
}

function requiredEconomicFields(item = {}) {
  if (item.category === "yield" || item.category === "arbitrage") {
    return ["grossReturnBps", "depositFeeBps", "withdrawFeeBps", "unwindSlippageBps"];
  }
  return ["grossReturnBps", "depositFeeBps", "withdrawFeeBps"];
}

function latestBlockersByTemplate(entries = []) {
  const map = new Map();
  for (const entry of entries || []) {
    if (!entry?.templateId) continue;
    const current = map.get(entry.templateId);
    const currentTime = current ? new Date(current.observedAt).getTime() : -Infinity;
    const nextTime = new Date(entry.observedAt).getTime();
    if (!current || nextTime >= currentTime) {
      map.set(entry.templateId, entry);
    }
  }
  return map;
}

function estimateForBudget(values = {}, budgetUsd) {
  const grossReturnBps = numeric(values.grossReturnBps);
  const depositFeeBps = numeric(values.depositFeeBps) ?? 0;
  const withdrawFeeBps = numeric(values.withdrawFeeBps) ?? 0;
  const unwindSlippageBps = numeric(values.unwindSlippageBps) ?? 0;

  const netBps = grossReturnBps - depositFeeBps - withdrawFeeBps - unwindSlippageBps;
  return {
    budgetUsd,
    estimatedNetBps: round(netBps),
    estimatedNetUsd: round((budgetUsd * netBps) / 10000, 6),
    passesPolicy: netBps >= 50 && (budgetUsd * netBps) / 10000 >= 0.3,
  };
}

export function buildDestinationEstimatedEconomics({ workbench = null, blockers = null } = {}) {
  const generatedAt = workbench?.generatedAt || new Date().toISOString();
  const treasuryPolicy = buildDefaultTreasuryPolicy();
  const activeBudgetUsd = numeric(workbench?.budgets?.activeBudgetUsd) ?? numeric(treasuryPolicy?.capital?.activeBudgetUsd);
  const planningBudgetUsd = numeric(workbench?.budgets?.planningBudgetUsd);
  const blockerByTemplate = latestBlockersByTemplate(blockers?.entries || []);

  const items = (workbench?.workItems || []).map((item) => {
    if (item.category === "platform") {
      return {
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        category: item.category,
        score: item.score,
        economicsStatus: "non_numeric_track",
        missingEconomicFields: [],
        activeBudgetReachable: false,
        planningBudgetReachable: false,
        activeBudgetEstimate: null,
        planningBudgetEstimate: null,
      };
    }

    const needed = requiredEconomicFields(item);
    const blocker = blockerByTemplate.get(item.templateId) || null;
    const missingEconomicFields = needed.filter((field) => !hasValue(item.values?.[field]));
    const minPositionUsd = numeric(item.values?.minPositionUsd);
    const activeBudgetReachable =
      Number.isFinite(activeBudgetUsd) ? minPositionUsd == null || minPositionUsd <= activeBudgetUsd : null;
    const planningBudgetReachable =
      Number.isFinite(planningBudgetUsd) ? minPositionUsd == null || minPositionUsd <= planningBudgetUsd : null;

    if (blocker) {
      return {
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        category: item.category,
        score: item.score,
        economicsStatus: "blocked",
        blockerCode: blocker.blocker || "destination_economics_blocked",
        blockerSourceName: blocker.sourceName ?? null,
        blockerSourceType: blocker.sourceType ?? null,
        blockerObservedAt: blocker.observedAt ?? null,
        blockerNote: blocker.note ?? null,
        missingEconomicFields,
        activeBudgetReachable,
        planningBudgetReachable,
        activeBudgetEstimate: null,
        planningBudgetEstimate: null,
      };
    }

    if (missingEconomicFields.length > 0) {
      return {
        templateId: item.templateId,
        chain: item.chain,
        familyId: item.familyId,
        label: item.label,
        category: item.category,
        score: item.score,
        economicsStatus: "missing_inputs",
        missingEconomicFields,
        activeBudgetReachable,
        planningBudgetReachable,
        activeBudgetEstimate: null,
        planningBudgetEstimate: null,
      };
    }

    return {
      templateId: item.templateId,
      chain: item.chain,
      familyId: item.familyId,
      label: item.label,
      category: item.category,
      score: item.score,
      economicsStatus: "estimated",
      missingEconomicFields: [],
      activeBudgetReachable,
      planningBudgetReachable,
        activeBudgetEstimate: activeBudgetReachable ? estimateForBudget(item.values, activeBudgetUsd) : null,
        planningBudgetEstimate: planningBudgetReachable ? estimateForBudget(item.values, planningBudgetUsd) : null,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt,
    budgets: {
      activeBudgetUsd,
      planningBudgetUsd,
    },
    summary: {
      itemCount: items.length,
      estimatedCount: items.filter((item) => item.economicsStatus === "estimated").length,
      blockedCount: items.filter((item) => item.economicsStatus === "blocked").length,
      missingInputsCount: items.filter((item) => item.economicsStatus === "missing_inputs").length,
      activeBudgetPolicyPassCount: items.filter((item) => item.activeBudgetEstimate?.passesPolicy).length,
      planningBudgetPolicyPassCount: items.filter((item) => item.planningBudgetEstimate?.passesPolicy).length,
    },
    items,
  };
}
