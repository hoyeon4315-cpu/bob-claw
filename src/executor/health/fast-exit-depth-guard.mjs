// Fast-exit depth/spread guard — blocks exit/unwind intents when market
// conditions would cause excessive slippage or insufficient liquidity.
//
// Pure function: takes an intent + marketDepth snapshot and returns an
// allow/block verdict.

const EXIT_INTENT_TYPES = new Set(["exit", "unwind"]);

export function featureEnabled(profile = {}) {
  return profile.fastExitDepthGuard !== false;
}

export function evaluateFastExit({
  intent = {},
  marketDepth = {},
  maxSpreadBps = 200,
} = {}) {
  if (!featureEnabled()) {
    return { allowed: true, reasonCode: null, reason: "fast_exit_depth_guard disabled" };
  }

  const intentType = intent.intentType || intent.type;
  if (!EXIT_INTENT_TYPES.has(intentType)) {
    return { allowed: true, reasonCode: null, reason: "not an exit/unwind intent" };
  }

  const spreadBps = Number(marketDepth.spreadBps);
  if (Number.isFinite(spreadBps) && spreadBps > maxSpreadBps) {
    return {
      allowed: false,
      reasonCode: "fast_exit_spread_too_wide",
      reason: `spread ${spreadBps} bps > max ${maxSpreadBps} bps`,
    };
  }

  const outputAmount = Number(intent.outputAmount ?? intent.amountUsd);
  const depthAtOutput = Number(marketDepth.depthAtOutput);
  if (Number.isFinite(outputAmount) && outputAmount > 0 && Number.isFinite(depthAtOutput)) {
    if (depthAtOutput < 2 * outputAmount) {
      return {
        allowed: false,
        reasonCode: "fast_exit_depth_insufficient",
        reason: `depth ${depthAtOutput} < 2× output ${outputAmount}`,
      };
    }
  }

  return { allowed: true, reasonCode: null, reason: "spread and depth acceptable" };
}
