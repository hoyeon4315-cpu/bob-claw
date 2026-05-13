const DEFAULT_EXECUTION_COOLDOWN_MS = 5 * 60 * 1000;
const AUTOMATED_CANARY_BINDINGS = new Set([
  "erc4626_vault_supply_withdraw",
  "euler_evault_deposit_withdraw",
  "aave_v3_pool_supply_withdraw",
  "pendle_yt_buy_sell_redeem",
]);

function normalized(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function sameAddress(left, right) {
  return normalized(left).startsWith("0x") && normalized(left) === normalized(right);
}

function latest(items = [], observedAtKey = "observedAt") {
  return (
    [...items].sort((left, right) => new Date(right?.[observedAtKey] || 0) - new Date(left?.[observedAtKey] || 0))[0] ||
    null
  );
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function positiveUnits(raw) {
  try {
    return BigInt(raw || 0) > 0n;
  } catch {
    return false;
  }
}

function bindingEntryTokenAddresses(binding = {}) {
  return [
    binding.assetAddress,
    ...(binding.entryTokenAddresses || []),
    ...(binding.sdkInputTokenAddresses || []),
    ...(binding.syInputTokenAddresses || []),
  ].filter(Boolean);
}

function matchesAnyAddress(token, addresses = []) {
  return addresses.some((address) => sameAddress(token, address));
}

function matchingEntryAssets(queueItem = {}, token = {}) {
  const entryAssets = queueItem.entryAssets || [];
  const tokenTicker = normalized(token.ticker);
  return entryAssets.some((asset) => normalized(asset) === tokenTicker);
}

function matchingInventoryToken(queueItem = {}, inventorySnapshot = null) {
  const tokens = inventorySnapshot?.tokens || [];
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  const entryTokenAddresses = bindingEntryTokenAddresses(binding);
  const underlying = tokens.find((token) => {
    if (token.chain !== queueItem.chain || !positiveUnits(token.actual)) return false;
    if (matchesAnyAddress(token.token, entryTokenAddresses)) return true;
    return matchingEntryAssets(queueItem, token);
  });
  if (underlying && !sameAddress(underlying.token, binding.shareTokenAddress)) return underlying;
  return (
    tokens.find((token) => {
      if (token.chain !== queueItem.chain || !positiveUnits(token.actual)) return false;
      if (sameAddress(token.token, binding.assetAddress)) return true;
      return matchingEntryAssets(queueItem, token) && !sameAddress(token.token, binding.shareTokenAddress);
    }) || null
  );
}

function matchingNativeBalance(queueItem = {}, inventorySnapshot = null) {
  return (
    (inventorySnapshot?.native || []).find(
      (native) => native.chain === queueItem.chain && positiveUnits(native.actual),
    ) || null
  );
}

function matchingDeliveredExecution(records = [], opportunityId = null) {
  return latest(
    records.filter((record) => {
      const recordOpportunityId = record?.queueItem?.opportunityId || record?.plan?.opportunityId || null;
      return (
        String(recordOpportunityId || "") === String(opportunityId || "") &&
        record?.mode === "execute" &&
        (record?.execution?.settlementStatus === "delivered" ||
          record?.execution?.positionProof?.status === "delivered")
      );
    }),
  );
}

function automatedExecutionSupported(queueItem = {}) {
  return AUTOMATED_CANARY_BINDINGS.has(queueItem?.protocolBindingPlan?.bindingKind || "");
}

function bindingKind(queueItem = {}) {
  return queueItem?.protocolBindingPlan?.bindingKind || "";
}

function hasOpenPendleExecution(queueItem = {}, execution = null) {
  return (
    bindingKind(queueItem) === "pendle_yt_buy_sell_redeem" &&
    execution &&
    !execution.closedAt &&
    execution?.execution?.positionProof?.status === "delivered"
  );
}

function matchingOpenPortfolioPosition(records = [], queueItem = {}) {
  const latestByPosition = new Map();
  for (const record of records || []) {
    if (String(record?.opportunityId || "") !== String(queueItem?.opportunityId || "")) continue;
    if (record?.chain && record.chain !== queueItem.chain) continue;
    if (record?.bindingKind && record.bindingKind !== bindingKind(queueItem)) continue;
    const positionId = record?.positionId || record?.entryTxHash || record?.txHash || null;
    if (!positionId) continue;
    const previous = latestByPosition.get(positionId);
    const previousTime = previous ? new Date(previous.observedAt || 0).getTime() : 0;
    const currentTime = new Date(record.observedAt || 0).getTime();
    if (!previous || currentTime >= previousTime) latestByPosition.set(positionId, record);
  }
  return latest([...latestByPosition.values()].filter((record) => record?.status === "open"));
}

export function latestTreasuryInventoryForAddress(records = [], address = null) {
  return latest(records.filter((item) => normalized(item?.address) === normalized(address)));
}

export function buildMerklCanaryExecutionReadiness({
  queueItem,
  inventorySnapshot = null,
  canaryExecutions = [],
  positionRecords = [],
  now = new Date().toISOString(),
  cooldownMs = DEFAULT_EXECUTION_COOLDOWN_MS,
} = {}) {
  if (!queueItem) throw new Error("queueItem is required");

  const matchedToken = matchingInventoryToken(queueItem, inventorySnapshot);
  const matchedNative = matchingNativeBalance(queueItem, inventorySnapshot);
  const recentExecution = matchingDeliveredExecution(canaryExecutions, queueItem.opportunityId);
  const openPendleExecution = hasOpenPendleExecution(queueItem, recentExecution);
  const openPortfolioPosition = matchingOpenPortfolioPosition(positionRecords, queueItem);
  const executorSupported = automatedExecutionSupported(queueItem);
  const cooldownUntil = recentExecution
    ? new Date(new Date(recentExecution.observedAt).getTime() + Math.max(0, Number(cooldownMs) || 0)).toISOString()
    : null;
  const cooldownActive = Boolean(cooldownUntil && new Date(cooldownUntil) > new Date(now));

  let status = "inventory_unknown";
  const reasons = [];

  if (!executorSupported) reasons.push("protocol_executor_missing");
  if (!inventorySnapshot) reasons.push("inventory_snapshot_missing");
  if (inventorySnapshot && !matchedToken) reasons.push("entry_asset_unavailable");
  if (inventorySnapshot && !matchedNative) reasons.push("native_gas_unavailable");
  if (cooldownActive) reasons.push("recent_execution_cooldown");
  if (openPendleExecution) reasons.push("open_pendle_position_active");
  if (openPortfolioPosition) reasons.push("open_position_active");

  if (!executorSupported) {
    status = "executor_missing";
  } else if (!inventorySnapshot) {
    status = "inventory_unknown";
  } else if (!matchedToken) {
    status = "inventory_missing";
  } else if (!matchedNative) {
    status = "native_gas_missing";
  } else if (cooldownActive) {
    status = "cooldown_active";
  } else if (openPendleExecution || openPortfolioPosition) {
    status = "open_position_active";
  } else {
    status = "inventory_ready";
  }

  return {
    status,
    reasons,
    executorSupported,
    matchedToken: matchedToken
      ? {
          ticker: matchedToken.ticker || null,
          token: matchedToken.token || null,
          actual: matchedToken.actual || "0",
          actualDecimal: matchedToken.actualDecimal ?? null,
          estimatedUsd: matchedToken.estimatedUsd ?? null,
          inventoryStatus: matchedToken.status || null,
        }
      : null,
    matchedNative: matchedNative
      ? {
          asset: matchedNative.asset || null,
          actual: matchedNative.actual || "0",
          actualDecimal: matchedNative.actualDecimal ?? null,
          estimatedUsd: matchedNative.estimatedUsd ?? null,
          inventoryStatus: matchedNative.status || null,
        }
      : null,
    latestDeliveredAt: recentExecution?.observedAt || null,
    cooldownUntil,
    cooldownActive,
    openPosition: openPortfolioPosition
      ? {
          positionId: openPortfolioPosition.positionId || null,
          entryTxHash: openPortfolioPosition.entryTxHash || openPortfolioPosition.txHash || null,
          observedAt: openPortfolioPosition.observedAt || null,
        }
      : null,
  };
}

export function applyMerklCanaryExecutionReadiness(queueItem, options = {}) {
  const executionReadiness = buildMerklCanaryExecutionReadiness({
    queueItem,
    ...options,
  });
  const capabilityGaps = (queueItem?.capabilityGaps || []).filter(
    (gap) => gap !== "current_inventory_entry_route_required",
  );

  if (executionReadiness.status === "inventory_missing" || executionReadiness.status === "inventory_unknown") {
    capabilityGaps.unshift("current_inventory_entry_route_required");
  }
  if (executionReadiness.reasons.includes("inventory_snapshot_missing")) {
    capabilityGaps.unshift("current_inventory_entry_route_required");
  }
  if (executionReadiness.reasons.includes("protocol_executor_missing")) {
    capabilityGaps.unshift("protocol_executor_required");
  }
  if (executionReadiness.status === "native_gas_missing") {
    capabilityGaps.unshift("native_gas_inventory_required");
  }
  if (executionReadiness.status === "cooldown_active") {
    capabilityGaps.unshift("recent_execution_cooldown_active");
  }
  if (executionReadiness.status === "open_position_active") {
    capabilityGaps.unshift("open_position_active");
  }

  return {
    ...queueItem,
    queueStatus: executionReadiness.status === "inventory_ready" ? "ready_for_tiny_live_canary" : queueItem.queueStatus,
    capabilityGaps: unique(capabilityGaps),
    executionReadiness,
  };
}

export { DEFAULT_EXECUTION_COOLDOWN_MS };
