import { decimalToUnits } from "./policy.mjs";
import { tokenAsset } from "../assets/tokens.mjs";

function bigint(value) {
  return BigInt(value || 0);
}

function refillActionType(item) {
  return item.asset ? "refill_native" : "refill_token";
}

function estimateActionCostUsd(item, policy) {
  const refillUsd = Number(item.refillEstimatedUsd || 0);
  const capped = Math.min(refillUsd, policy.refillPolicy.maxSingleRefillCostUsd);
  return Number.isFinite(capped) ? capped : null;
}

function nativeAction(item, policy) {
  return {
    type: "refill_native",
    chain: item.chain,
    asset: item.asset,
    token: item.token,
    current: item.actual,
    currentDecimal: item.actualDecimal,
    target: item.targetBalance,
    targetDecimal: item.targetBalanceDecimal,
    refillAmount: item.refillToTarget,
    refillAmountDecimal: item.refillToTargetDecimal,
    refillEstimatedUsd: item.refillEstimatedUsd,
    maxSingleRefillCostUsd: policy.refillPolicy.maxSingleRefillCostUsd,
    rationale: item.rationale,
    strategyPolicy: item.strategyPolicy || null,
  };
}

function tokenAction(item, policy) {
  return {
    type: "refill_token",
    chain: item.chain,
    ticker: item.ticker,
    token: item.token,
    current: item.actual,
    currentDecimal: item.actualDecimal,
    target: item.targetBalance,
    targetDecimal: item.targetBalanceDecimal,
    refillAmount: item.refillToTarget,
    refillAmountDecimal: item.refillToTargetDecimal,
    refillEstimatedUsd: item.refillEstimatedUsd,
    maxSingleRefillCostUsd: policy.refillPolicy.maxSingleRefillCostUsd,
    rationale: item.rationale,
    strategyPolicy: item.strategyPolicy || null,
  };
}

function isStablecoinInventoryItem(item) {
  return tokenAsset(item.chain, item.token).family === "stablecoin";
}

function stablecoinCoverageByChain(items = []) {
  const coverage = new Map();
  for (const item of items) {
    if (!isStablecoinInventoryItem(item)) continue;
    const current = Number.isFinite(item.actualDecimal) ? item.actualDecimal : 0;
    const existing = coverage.get(item.chain) || 0;
    if (current > existing) coverage.set(item.chain, current);
  }
  return coverage;
}

export function enrichInventoryWithRefillUsd(inventory) {
  const native = inventory.native.map((item) => ({
    ...item,
    refillEstimatedUsd:
      Number.isFinite(item.refillToTargetDecimal) && Number.isFinite(item.priceUsd) ? item.refillToTargetDecimal * item.priceUsd : null,
  }));
  const tokens = inventory.tokens.map((item) => ({
    ...item,
    refillEstimatedUsd:
      Number.isFinite(item.refillToTargetDecimal) && Number.isFinite(item.priceUsd) ? item.refillToTargetDecimal * item.priceUsd : null,
  }));
  return { ...inventory, native, tokens };
}

export function buildTreasuryPlan({ policy, inventory, routeDemand = [] }) {
  const enriched = enrichInventoryWithRefillUsd(inventory);
  const routeDemandChains = new Set(routeDemand.map((item) => item.chain));
  const routeDemandTokenKeys = new Set(routeDemand.filter((item) => item.token).map((item) => `${item.chain}:${String(item.token).toLowerCase()}`));
  const routeDemandTokenChains = new Set(routeDemand.filter((item) => item.token).map((item) => item.chain));
  const modeledTokenKeys = new Set((enriched.tokens || []).map((item) => `${item.chain}:${String(item.token).toLowerCase()}`));
  const stableCoverage = stablecoinCoverageByChain(enriched.tokens || []);
  const actions = [];
  const blockers = [];
  const observations = [];

  for (const item of enriched.native) {
    const hasDemand = routeDemandChains.has(item.chain);
    if (item.status === "refill_required" || (item.status === "observe_only_low" && hasDemand)) {
      if (policy.refillPolicy.requireRouteDemandSignal && !hasDemand) {
        blockers.push({
          type: "native_refill_blocked_no_demand",
          chain: item.chain,
          asset: item.asset,
          currentDecimal: item.actualDecimal,
          targetDecimal: item.targetBalanceDecimal,
          refillAmountDecimal: item.refillToTargetDecimal,
          refillEstimatedUsd: item.refillEstimatedUsd,
        });
        continue;
      }
      actions.push(nativeAction(item, policy));
    } else if (item.status === "below_target" || item.status === "observe_only_balance_present") {
      observations.push({
        type: "native_watch",
        chain: item.chain,
        asset: item.asset,
        status: item.status,
        currentDecimal: item.actualDecimal,
        targetDecimal: item.targetBalanceDecimal,
      });
    } else if (item.status?.startsWith("over_max")) {
      blockers.push({
        type: "native_over_max",
        chain: item.chain,
        asset: item.asset,
        currentDecimal: item.actualDecimal,
        maxBalanceDecimal: item.maxBalanceDecimal,
      });
    }
  }

  for (const item of enriched.tokens) {
    const tokenKey = `${item.chain}:${String(item.token).toLowerCase()}`;
    const hasExactDemand = routeDemandTokenKeys.has(tokenKey);
    const hasChainLevelDemand = !routeDemandTokenChains.has(item.chain) && routeDemandChains.has(item.chain);
    const hasDemand = hasExactDemand || hasChainLevelDemand;
    const stableEquivalentSatisfied =
      !hasExactDemand &&
      hasChainLevelDemand &&
      isStablecoinInventoryItem(item) &&
      (stableCoverage.get(item.chain) || 0) >= item.targetBalanceDecimal;
    if (item.status === "refill_required" || (item.status === "observe_only_low" && hasDemand)) {
      if (stableEquivalentSatisfied) {
        observations.push({
          type: "token_watch",
          chain: item.chain,
          ticker: item.ticker,
          status: "satisfied_by_same_chain_stable_buffer",
          currentDecimal: item.actualDecimal,
          targetDecimal: item.targetBalanceDecimal,
        });
        continue;
      }
      if (policy.refillPolicy.requireRouteDemandSignal && !hasDemand) {
        blockers.push({
          type: "token_refill_blocked_no_demand",
          chain: item.chain,
          ticker: item.ticker,
          token: item.token,
          currentDecimal: item.actualDecimal,
          targetDecimal: item.targetBalanceDecimal,
          refillAmountDecimal: item.refillToTargetDecimal,
          refillEstimatedUsd: item.refillEstimatedUsd,
        });
        continue;
      }
      actions.push(tokenAction(item, policy));
    } else if (item.status === "below_target") {
      observations.push({
        type: "token_watch",
        chain: item.chain,
        ticker: item.ticker,
        status: item.status,
        currentDecimal: item.actualDecimal,
        targetDecimal: item.targetBalanceDecimal,
      });
    } else if (item.status?.startsWith("over_max")) {
      blockers.push({
        type: "token_over_max",
        chain: item.chain,
        ticker: item.ticker,
        currentDecimal: item.actualDecimal,
        maxBalanceDecimal: item.maxBalanceDecimal,
      });
    }
  }

  for (const item of enriched.allowances || []) {
    if (item.status === "over_cap") {
      blockers.push({
        type: "allowance_over_cap",
        chain: item.chain,
        ticker: item.ticker,
        spender: item.spender,
        actualDecimal: item.actualDecimal,
        maxApprovalDecimal: item.maxApprovalDecimal,
      });
    } else if (item.status === "zero") {
      observations.push({
        type: "allowance_zero",
        chain: item.chain,
        ticker: item.ticker,
        spender: item.spender,
        mode: item.mode,
      });
    }
  }

  for (const item of routeDemand.filter((entry) => entry.token)) {
    const tokenKey = `${item.chain}:${String(item.token).toLowerCase()}`;
    if (modeledTokenKeys.has(tokenKey)) continue;
    blockers.push({
      type: "token_inventory_unmodeled_for_demand",
      chain: item.chain,
      token: item.token,
    });
  }

  const refillEstimatedUsd = actions
    .map((item) => item.refillEstimatedUsd)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const executionBudgetEstimateUsd = actions
    .map((item) => estimateActionCostUsd(item, policy))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const walletValueFloorUsd = policy.refillPolicy.skipIfWalletValueBelowUsd;
  const walletValueShortfallUsd =
    Number.isFinite(enriched.summary.estimatedWalletUsd) && Number.isFinite(walletValueFloorUsd)
      ? Math.max(0, walletValueFloorUsd - enriched.summary.estimatedWalletUsd)
      : null;
  const noDemandBlockerCount = blockers.filter((item) => String(item.type || "").endsWith("_blocked_no_demand")).length;

  const totalPending = actions.length;
  const budgetBlocked =
    (Number.isFinite(enriched.summary.estimatedWalletUsd) &&
      enriched.summary.estimatedWalletUsd < policy.refillPolicy.skipIfWalletValueBelowUsd) ||
    executionBudgetEstimateUsd > policy.capital.maxRefillCost24hUsd ||
    totalPending > policy.refillPolicy.maxPendingJobs;

  const decision =
    blockers.length > 0
      ? "BLOCKED"
      : actions.length > 0
        ? budgetBlocked
          ? "REVIEW_REFILL_PLAN"
          : "REFILL_REQUIRED"
        : observations.length > 0
          ? "WATCH_ONLY"
          : "READY";

  const reasons = [];
  if (budgetBlocked) {
    if (Number.isFinite(enriched.summary.estimatedWalletUsd) && enriched.summary.estimatedWalletUsd < policy.refillPolicy.skipIfWalletValueBelowUsd) {
      reasons.push("wallet_value_below_refill_floor");
    }
    if (executionBudgetEstimateUsd > policy.capital.maxRefillCost24hUsd) {
      reasons.push("refill_cost_above_daily_cap");
    }
    if (totalPending > policy.refillPolicy.maxPendingJobs) {
      reasons.push("too_many_pending_refills");
    }
  }

  return {
    schemaVersion: 1,
    observedAt: enriched.observedAt,
    address: enriched.address,
    decision,
    reasons,
    routeDemand,
    actions,
    blockers,
    observations,
    summary: {
      refillActionCount: actions.length,
      blockerCount: blockers.length,
      observationCount: observations.length,
      refillEstimatedUsd,
      executionBudgetEstimateUsd,
      estimatedWalletUsd: enriched.summary.estimatedWalletUsd,
      walletValueFloorUsd,
      walletValueShortfallUsd,
      noDemandBlockerCount,
    },
    inventory: enriched,
  };
}
