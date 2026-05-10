import { registerBinding } from "../../../../executor/protocol-binding-registry.mjs";

async function buildPendleYtPlanPlaceholder({ strategyId = null } = {}) {
  return {
    schemaVersion: 1,
    planStatus: "blocked",
    blockedReason: "pendle_yt_binding_not_implemented",
    strategyId,
    intent: null,
  };
}

async function executePendleYtPlanPlaceholder() {
  return {
    status: "rejected",
    reason: "pendle_yt_binding_not_implemented",
  };
}

export function registerPendleBinding() {
  registerBinding({
    bindingKind: "pendle_yt_buy_sell_redeem",
    planBuilder: buildPendleYtPlanPlaceholder,
    planExecutor: executePendleYtPlanPlaceholder,
    exitExecutor: executePendleYtPlanPlaceholder,
    intentType: "pendle_yt_entry",
    family: "pendle_yt",
  });
}
