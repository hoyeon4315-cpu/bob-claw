// Gas bootstrap evaluator.
//
// Checks whether a chain has enough native gas for an intent.
// If not, produces a bootstrap plan instead of blocking with "missing_gas".
//
// Invariants:
// - Never returns missing_gas as a blocker.
// - Instead returns bootstrap_required_before_execution with a plan.
// - Pure function. No I/O.

function keyFor(chain) {
  if (chain == null) return "";
  const s = String(chain).trim().toLowerCase();
  return s === "null" || s === "undefined" ? "" : s;
}

export function evaluateGasBootstrap({
  intent = {},
  gasFloats = {},
  hopCatalog = [],
  minGasWei = null,
  expectedEdgeUsd = null,
}) {
  const chain = keyFor(intent.chain);
  if (!chain) {
    return {
      ok: false,
      status: "bootstrap_unavailable",
      reason: "intent_chain_missing",
      bootstrapPlan: null,
      originalIntent: intent,
    };
  }

  const float = gasFloats[chain];
  if (!float) {
    return {
      ok: false,
      status: "bootstrap_unavailable",
      reason: "gas_float_unobserved_for_chain",
      chain,
      bootstrapPlan: null,
      originalIntent: intent,
    };
  }

  const actualWei = BigInt(float.actualWei || 0);
  const targetWei = BigInt(float.targetWei || 0);
  const neededWei = minGasWei != null ? BigInt(minGasWei) : targetWei;

  if (actualWei >= neededWei) {
    return {
      ok: true,
      status: "ready",
      reason: "gas_sufficient",
      chain,
      actualWei: String(actualWei),
      neededWei: String(neededWei),
      bootstrapPlan: null,
      originalIntent: intent,
    };
  }

  // Build a bootstrap plan: find the cheapest hop that brings gas to this chain.
  const bootstrapHop = findCheapestGasHop(chain, hopCatalog, gasFloats);
  if (!bootstrapHop) {
    return {
      ok: false,
      status: "bootstrap_failed",
      reason: "no_economic_gas_bootstrap_path",
      chain,
      actualWei: String(actualWei),
      neededWei: String(neededWei),
      bootstrapPlan: null,
      originalIntent: intent,
    };
  }
  if (
    Number.isFinite(expectedEdgeUsd) &&
    Number.isFinite(bootstrapHop.estimatedCostUsd) &&
    bootstrapHop.estimatedCostUsd > expectedEdgeUsd
  ) {
    return {
      ok: false,
      status: "bootstrap_failed",
      reason: "bootstrap_cost_exceeds_expected_edge",
      chain,
      actualWei: String(actualWei),
      neededWei: String(neededWei),
      expectedEdgeUsd,
      bootstrapCostUsd: bootstrapHop.estimatedCostUsd,
      bootstrapPlan: null,
      originalIntent: intent,
    };
  }

  return {
    ok: false,
    status: "bootstrap_required_before_execution",
    reason: "gas_below_floor",
    chain,
    actualWei: String(actualWei),
    neededWei: String(neededWei),
    bootstrapPlan: {
      type: "gas_topup",
      queueRole: "prerequisite_before_original_intent",
      targetChain: chain,
      sourceChain: bootstrapHop.from.chain,
      sourceAsset: bootstrapHop.from.asset,
      estimatedFeeBps: bootstrapHop.estimatedFeeBps,
      estimatedCostWei: bootstrapHop.estimatedCostWei,
      intents: [bootstrapHop],
    },
    originalIntent: intent,
  };
}

function findCheapestGasHop(targetChain, hopCatalog, gasFloats) {
  if (!Array.isArray(hopCatalog)) return null;
  const target = keyFor(targetChain);
  let best = null;
  for (const hop of hopCatalog) {
    if (!hop?.to || keyFor(hop.to.chain) !== target) continue;
    if (hop.kind !== "gas_topup" && hop.kind !== "native_transfer") continue;
    // Skip if source chain also has no gas.
    const srcFloat = gasFloats[keyFor(hop.from.chain)];
    const srcActual = srcFloat ? BigInt(srcFloat.actualWei || 0) : 0n;
    const srcTarget = srcFloat ? BigInt(srcFloat.targetWei || 0) : 0n;
    if (srcActual < srcTarget) continue;
    if (!best || (hop.estimatedFeeBps || 0) < (best.estimatedFeeBps || 0)) {
      best = hop;
    }
  }
  return best;
}

export function applyBootstrapResult({
  bootstrapResult,
  originalIntent,
  bootstrapReceipt,
}) {
  if (!bootstrapResult) return { status: "bootstrap_unavailable", retryIntent: null };
  if (bootstrapResult.status === "ready") {
    return { status: "ready", retryIntent: originalIntent };
  }
  if (bootstrapResult.status === "bootstrap_required_before_execution") {
    if (!bootstrapReceipt) {
      return { status: "bootstrap_pending", retryIntent: null };
    }
    if (bootstrapReceipt.ok === true) {
      return { status: "bootstrap_success", retryIntent: originalIntent };
    }
    return {
      status: "bootstrap_failed",
      retryIntent: null,
      failureReason: bootstrapReceipt.reason || "bootstrap_receipt_not_ok",
    };
  }
  return { status: bootstrapResult.status, retryIntent: null };
}
