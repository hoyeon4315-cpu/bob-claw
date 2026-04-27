import {
  bridgeMovementDiscretionaryBudget,
  gasZipDiscretionaryBudget,
} from "../config/discretionary-budget.mjs";

const STRATEGY_REALIZED_PNL_CLASSIFICATION = "strategy_realized_pnl";
const BRIDGE_METHODS = new Set([
  "cross_chain_bridge_or_swap",
  "cross_chain_bridge_across",
  "cross_chain_bridge_lifi",
  "cross_chain_swap_via_btc_intermediate",
]);

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

export function movementClassification(record = {}) {
  const classification = [
    record?.classification,
    record?.movementClassification,
    record?.executionClassification,
    record?.receiptClassification,
    record?.metadata?.classification,
    record?.movementBudget?.classification,
    record?.strategyPolicy?.classification,
  ].find((value) => typeof value === "string" && value.length > 0);
  return classification || null;
}

export function isStrategyRealizedPnlMovement(record = {}) {
  return movementClassification(record) === STRATEGY_REALIZED_PNL_CLASSIFICATION;
}

export function liveInventoryDependencyOverride(record = {}) {
  return (
    record?.liveInventoryDependencyOverride === true ||
    record?.movementBudget?.liveInventoryDependencyOverride === true ||
    record?.metadata?.liveInventoryDependencyOverride === true ||
    record?.strategyPolicy?.liveInventoryDependencyOverride === true ||
    record?.strategyPolicy?.dependencyOnLiveDestinationInventory === true
  );
}

export function usesBridgeMovementMethod(method) {
  return BRIDGE_METHODS.has(String(method || ""));
}

export function evaluateBridgeMovementCostGuard({
  method,
  costUsd = null,
  record = null,
  ceilingUsd = bridgeMovementDiscretionaryBudget().quoteCostCeilingUsd,
} = {}) {
  const applies = usesBridgeMovementMethod(method);
  const classification = movementClassification(record || {});
  const bypassed =
    isStrategyRealizedPnlMovement(record || {}) ||
    liveInventoryDependencyOverride(record || {});
  const resolvedCostUsd =
    finiteNumber(costUsd) ??
    finiteNumber(record?.movementBudget?.bridgeQuoteCostUsd) ??
    finiteNumber(record?.fundingSource?.expectedExecutionRefillCostUsd);
  const accepted =
    !applies ||
    bypassed ||
    !Number.isFinite(ceilingUsd) ||
    !Number.isFinite(resolvedCostUsd) ||
    resolvedCostUsd <= ceilingUsd;
  return {
    applies,
    accepted,
    bypassed,
    reason: accepted ? null : "bridge_quote_cost_above_discretionary_ceiling",
    classification,
    liveInventoryDependencyOverride: liveInventoryDependencyOverride(record || {}),
    quoteCostUsd: resolvedCostUsd,
    quoteCostCeilingUsd: finiteNumber(ceilingUsd),
  };
}

export function evaluateGasZipQuoteLossGuard({
  amountWei,
  expectedOutputWei,
  amountUsd = null,
  aggregateAmountUsd = null,
  discretionaryBudgetBypass = false,
  maxQuoteLossRatio = gasZipDiscretionaryBudget().maxQuoteLossRatio,
  refuelMinAmountUsd = gasZipDiscretionaryBudget().refuelMinAmountUsd,
} = {}) {
  const sentWei = BigInt(amountWei || 0);
  const receivedWei = BigInt(expectedOutputWei || 0);
  const effectiveAmountUsd = finiteNumber(aggregateAmountUsd) ?? finiteNumber(amountUsd);
  if (sentWei <= 0n) {
    return {
      accepted: true,
      bypassed: discretionaryBudgetBypass === true,
      reason: null,
      sentWei: "0",
      receivedWei: receivedWei.toString(),
      quoteLossBps: 0,
      amountUsd: effectiveAmountUsd,
      refuelMinAmountUsd: finiteNumber(refuelMinAmountUsd),
    };
  }
  const lossWei = sentWei > receivedWei ? sentWei - receivedWei : 0n;
  const thresholdBps = BigInt(Math.max(0, Math.round((Number(maxQuoteLossRatio) || 0) * 10_000)));
  const quoteLossBps = Number((lossWei * 10_000n) / sentWei);
  const excessiveLoss = lossWei * 10_000n > sentWei * thresholdBps;
  const smallRefuel = Number.isFinite(effectiveAmountUsd) && Number.isFinite(refuelMinAmountUsd)
    ? effectiveAmountUsd < refuelMinAmountUsd
    : false;
  const accepted = discretionaryBudgetBypass === true || !excessiveLoss || !smallRefuel;
  return {
    accepted,
    bypassed: discretionaryBudgetBypass === true,
    reason: accepted ? null : "gas_zip_quote_loss_above_discretionary_budget",
    sentWei: sentWei.toString(),
    receivedWei: receivedWei.toString(),
    quoteLossBps,
    amountUsd: effectiveAmountUsd,
    refuelMinAmountUsd: finiteNumber(refuelMinAmountUsd),
  };
}
