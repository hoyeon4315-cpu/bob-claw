const RESET_GATEWAY_NATIVE_ASSET_CONVERSION = Object.freeze({
  resetReason: "cold-start canary gate and proof path fixed after pre-reset broadcast failures",
  evidenceRef: "f6a3fb14ee3d25741e07b21d13d4ccd7ad7575b5",
  resetAt: "2026-05-09T02:06:00.000Z",
});

const RESET_RECURSIVE_WRAPPED_BTC_LENDING_LOOP = Object.freeze({
  resetReason: "yield EV evidence path fixed after pre-reset Moonwell canary failures",
  evidenceRef: "49d350c87d60e5db16f7a2af6ac996f30e7e2174",
  resetAt: "2026-05-09T03:26:15.000Z",
});

export const STRATEGY_PAUSE_STATE = Object.freeze({
  paused: Object.freeze({}),
  reset: Object.freeze({
    gateway_native_asset_conversion_sleeve: RESET_GATEWAY_NATIVE_ASSET_CONVERSION,
    recursive_wrapped_btc_lending_loop: RESET_RECURSIVE_WRAPPED_BTC_LENDING_LOOP,
  }),
});

export function strategyPauseResetFor(strategyId) {
  if (typeof strategyId !== "string" || !strategyId) return null;
  return STRATEGY_PAUSE_STATE.reset[strategyId] || null;
}

export function strategyPauseResetTimestamp(reset = null) {
  if (!reset?.resetAt) return null;
  const timestamp = new Date(reset.resetAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
