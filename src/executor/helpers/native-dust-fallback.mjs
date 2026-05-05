// src/executor/helpers/native-dust-fallback.mjs
// Native dust consolidation fallback: native → USDC on source chain → Base USDC → wBTC.OFT
// Used when direct native → wBTC.OFT conversion is not available

const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
const WBTC_OFT_TOKEN = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const BASE_CHAIN = "base";
const BASE_USDC_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CONSOLIDATION_THRESHOLD_USD = 0.50;
const USDC_TOKEN_BY_CHAIN = Object.freeze({
  avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  base: BASE_USDC_TOKEN,
  bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  sonic: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
  unichain: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
});

function normalizeChain(chain) {
  return String(chain || "").toLowerCase();
}

export function buildNativeDustFallbackPlan({
  sourceChain,
  sourceNativeBalance,
  sourceNativeUsd,
  targetAsset = WBTC_OFT_TOKEN,
  targetChain = BASE_CHAIN,
} = {}) {
  if (!sourceNativeBalance || sourceNativeBalance <= 0) {
    return {
      status: "skip",
      reason: "zero_source_native_balance",
      steps: [],
    };
  }

  if (!Number.isFinite(sourceNativeUsd) || sourceNativeUsd <= CONSOLIDATION_THRESHOLD_USD) {
    return {
      status: "skip",
      reason: "dust_below_minimum_consolidation_threshold",
      minimumThresholdUsd: CONSOLIDATION_THRESHOLD_USD,
      steps: [],
    };
  }

  const normalizedSourceChain = normalizeChain(sourceChain);
  const normalizedTargetChain = normalizeChain(targetChain) || BASE_CHAIN;
  const sourceStableToken = USDC_TOKEN_BY_CHAIN[normalizedSourceChain] || null;
  const targetStableToken = USDC_TOKEN_BY_CHAIN[normalizedTargetChain] || null;
  if (!sourceStableToken) {
    return {
      status: "skip",
      reason: "source_stable_token_unavailable",
      sourceChain: normalizedSourceChain,
      steps: [],
    };
  }
  if (!targetStableToken) {
    return {
      status: "skip",
      reason: "target_stable_token_unavailable",
      targetChain: normalizedTargetChain,
      steps: [],
    };
  }

  const steps = [];

  // Step 1: native → USDC on source chain
  steps.push({
    step: 1,
    type: "swap",
    name: "swap_native_to_usdc_on_source",
    chain: normalizedSourceChain,
    fromToken: ZERO_TOKEN,
    toToken: sourceStableToken,
    fromAmount: sourceNativeBalance,
    estimatedUsd: sourceNativeUsd,
    method: "dex_swap",
    dexes: ["odos", "paraswap"],
    allowSlippage: 0.02, // 2%
  });

  // Step 2: USDC on source → Base USDC (bridge or swap)
  if (normalizedSourceChain !== normalizedTargetChain) {
    steps.push({
      step: 2,
      type: "bridge_or_swap",
      name: "route_usdc_to_base",
      chain: normalizedSourceChain,
      destinationChain: normalizedTargetChain,
      fromToken: sourceStableToken,
      toToken: targetStableToken,
      method: "lifi_bridge_or_swap",
      fallbackMethods: ["across_bridge", "gateway_swap"],
      allowSlippage: 0.015, // 1.5%
    });
  }

  // Step 3: Base USDC → wBTC.OFT
  steps.push({
    step: steps.length + 1,
    type: "swap",
    name: "swap_usdc_to_wbtc_on_base",
    chain: normalizedTargetChain,
    fromToken: targetStableToken,
    toToken: targetAsset,
    method: "dex_swap",
    dexes: ["uniswap_v3", "odos"],
    allowSlippage: 0.025, // 2.5%
  });

  return {
    status: "plan_ready",
    sourceChain: normalizedSourceChain,
    sourceNativeBalance,
    sourceNativeUsd,
    targetChain: normalizedTargetChain,
    targetAsset,
    steps,
    estimatedEndToEndCostUsd: Math.max(CONSOLIDATION_THRESHOLD_USD, sourceNativeUsd * 0.05), // 5% total cost estimate
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
  if (normalizeChain(sourceChain) === BASE_CHAIN || !sourceNativeBalance || sourceNativeBalance <= 0) {
    return false;
  }

  // Skip if direct native → wBTC.OFT is available and has acceptable cost
  if (directConversionAvailable) {
    return false;
  }

  // Apply fallback for dust consolidation
  return Number.isFinite(sourceNativeUsd) && sourceNativeUsd >= CONSOLIDATION_THRESHOLD_USD;
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
