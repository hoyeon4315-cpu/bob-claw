// src/executor/helpers/native-dust-fallback.mjs
// Native dust consolidation fallback: native → USDC on source chain → Base USDC → wBTC.OFT
// Used when direct native → wBTC.OFT conversion is not available

export function buildNativeDustFallbackPlan({
  sourceChain,
  sourceNativeBalance,
  sourceNativeUsd,
  targetAsset = "wBTC.OFT",
  targetChain = "base",
} = {}) {
  if (!sourceNativeBalance || sourceNativeBalance <= 0) {
    return {
      status: "skip",
      reason: "zero_source_native_balance",
      steps: [],
    };
  }

  if (sourceUsd <= 0.50) {
    return {
      status: "skip",
      reason: "dust_below_minimum_consolidation_threshold",
      minimumThresholdUsd: 0.50,
      steps: [],
    };
  }

  const steps = [];

  // Step 1: native → USDC on source chain
  steps.push({
    step: 1,
    type: "swap",
    name: "swap_native_to_usdc_on_source",
    chain: sourceChain,
    fromToken: "native",
    toToken: "USDC",
    fromAmount: sourceNativeBalance,
    estimatedUsd: sourceNativeUsd,
    method: "dex_swap",
    dexes: ["odos", "paraswap"],
    allowSlippage: 0.02, // 2%
  });

  // Step 2: USDC on source → Base USDC (bridge or swap)
  if (sourceChain !== "base") {
    steps.push({
      step: 2,
      type: "bridge_or_swap",
      name: "route_usdc_to_base",
      chain: sourceChain,
      destinationChain: "base",
      fromToken: "USDC",
      toToken: "USDC",
      method: "lifi_bridge_or_swap",
      fallbackMethods: ["across_bridge", "gateway_swap"],
      allowSlippage: 0.015, // 1.5%
    });
  }

  // Step 3: Base USDC → wBTC.OFT
  steps.push({
    step: steps.length,
    type: "swap",
    name: "swap_usdc_to_wbtc_on_base",
    chain: "base",
    fromToken: "USDC",
    toToken: targetAsset,
    method: "dex_swap",
    dexes: ["uniswap_v3", "odos"],
    allowSlippage: 0.025, // 2.5%
  });

  return {
    status: "plan_ready",
    sourceChain,
    sourceNativeBalance,
    sourceNativeUsd,
    targetChain,
    targetAsset,
    steps,
    estimatedEndToEndCostUsd: Math.max(0.50, sourceNativeUsd * 0.05), // 5% total cost estimate
    estimatedNetUsd: sourceNativeUsd * 0.95, // Conservative estimate
  };
}

export function shouldApplyNativeDustFallback({
  sourceChain,
  sourceNativeBalance,
  sourceNativeUsd,
  directConversionAvailable = false,
} = {}) {
  // Skip fallback if source is already Base or no native balance
  if (sourceChain === "base" || !sourceNativeBalance || sourceNativeBalance <= 0) {
    return false;
  }

  // Skip if direct native → wBTC.OFT is available and has acceptable cost
  if (directConversionAvailable) {
    return false;
  }

  // Apply fallback for dust consolidation
  return sourceNativeUsd >= 0.50;
}

export function estimateNativeDustConsolidationTime({
  stepCount,
  bridgeRequired = true,
} = {}) {
  // Rough time estimate in seconds
  let totalSeconds = 0;

  // Each swap: ~30-60 seconds
  totalSeconds += 45 * (stepCount - (bridgeRequired ? 1 : 0));

  // Bridge (if needed): 3-10 minutes depending on bridge
  if (bridgeRequired) {
    totalSeconds += 300; // 5 minutes average
  }

  return {
    estimatedSeconds: totalSeconds,
    estimatedMinutes: Math.ceil(totalSeconds / 60),
    note: "Actual time depends on network congestion and bridge selection",
  };
}
