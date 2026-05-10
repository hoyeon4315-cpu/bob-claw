import {
  buildAaveProtocolCanaryPlan,
  executeAaveProtocolCanaryPlan,
} from "./helpers/aave-protocol-canary.mjs";
import {
  buildErc4626ProtocolCanaryPlan,
  executeErc4626ProtocolCanaryPlan,
} from "./helpers/erc4626-protocol-canary.mjs";
import {
  executeAavePortfolioExit,
  executeErc4626PortfolioExit,
} from "./helpers/merkl-portfolio-exit-executors.mjs";

const REGISTRY = new Map();

export function registerBinding({
  bindingKind,
  planBuilder,
  planExecutor,
  exitExecutor,
  intentType,
  family = "unknown",
}) {
  if (!bindingKind) throw new Error("bindingKind is required");
  REGISTRY.set(bindingKind, {
    bindingKind,
    planBuilder,
    planExecutor,
    exitExecutor,
    intentType,
    family,
  });
}

export function getBindingRegistration(bindingKind) {
  return REGISTRY.get(bindingKind) || null;
}

export function isSupportedBindingKind(bindingKind) {
  return REGISTRY.has(bindingKind);
}

export function supportedBindingKinds() {
  return new Set(REGISTRY.keys());
}

export function resolvePlanBuilder(bindingKind) {
  return REGISTRY.get(bindingKind)?.planBuilder || null;
}

export function resolvePlanExecutor(bindingKind) {
  return REGISTRY.get(bindingKind)?.planExecutor || null;
}

export function resolveExitExecutor(bindingKind) {
  return REGISTRY.get(bindingKind)?.exitExecutor || null;
}

export function resolveIntentType(bindingKind) {
  return REGISTRY.get(bindingKind)?.intentType || null;
}

// ── Built-in registrations ──

registerBinding({
  bindingKind: "erc4626_vault_supply_withdraw",
  planBuilder: buildErc4626ProtocolCanaryPlan,
  planExecutor: executeErc4626ProtocolCanaryPlan,
  exitExecutor: executeErc4626PortfolioExit,
  intentType: "erc4626_deposit",
  family: "erc4626",
});

registerBinding({
  bindingKind: "euler_evault_deposit_withdraw",
  planBuilder: buildErc4626ProtocolCanaryPlan,
  planExecutor: executeErc4626ProtocolCanaryPlan,
  exitExecutor: executeErc4626PortfolioExit,
  intentType: "erc4626_deposit",
  family: "erc4626",
});

registerBinding({
  bindingKind: "aave_v3_pool_supply_withdraw",
  planBuilder: buildAaveProtocolCanaryPlan,
  planExecutor: executeAaveProtocolCanaryPlan,
  exitExecutor: executeAavePortfolioExit,
  intentType: "aave_supply",
  family: "aave",
});

// ── Convenience: register a new ERC4626-like binding without new helper files ──

export function registerErc4626LikeBinding(bindingKind, { intentType = "erc4626_deposit" } = {}) {
  registerBinding({
    bindingKind,
    planBuilder: buildErc4626ProtocolCanaryPlan,
    planExecutor: executeErc4626ProtocolCanaryPlan,
    exitExecutor: executeErc4626PortfolioExit,
    intentType,
    family: "erc4626",
  });
}

// ── Lending family: reuse Aave helpers with protocol-specific bindingKind ──

export function registerLendingLikeBinding(bindingKind, { intentType = "aave_supply" } = {}) {
  registerBinding({
    bindingKind,
    planBuilder: buildAaveProtocolCanaryPlan,
    planExecutor: executeAaveProtocolCanaryPlan,
    exitExecutor: executeAavePortfolioExit,
    intentType,
    family: "lending",
  });
}

// ── Bulk register all multi-chain protocols ──

registerLendingLikeBinding("compound_v3_pool_supply_withdraw");
registerLendingLikeBinding("venus_pool_supply_withdraw");
registerLendingLikeBinding("morpho_pool_supply_withdraw");
registerLendingLikeBinding("benqi_pool_supply_withdraw");
registerLendingLikeBinding("dolomite_pool_supply_withdraw");
registerLendingLikeBinding("shadow_pool_supply_withdraw");
registerLendingLikeBinding("avalon_pool_supply_withdraw");
registerLendingLikeBinding("bend_pool_supply_withdraw");

registerErc4626LikeBinding("beefy_vault_deposit_withdraw");
registerErc4626LikeBinding("pendle_pt_vault_deposit_withdraw", { intentType: "erc4626_deposit" });
registerErc4626LikeBinding("aerodrome_cl_lp_add_remove", { intentType: "lp_add_liquidity" });
registerErc4626LikeBinding("velodrome_cl_lp_add_remove", { intentType: "lp_add_liquidity" });
registerErc4626LikeBinding("pancakeswap_v3_lp_add_remove", { intentType: "lp_add_liquidity" });
registerErc4626LikeBinding("uniswap_v3_lp_add_remove", { intentType: "lp_add_liquidity" });
registerErc4626LikeBinding("catex_lp_add_remove", { intentType: "lp_add_liquidity" });
registerErc4626LikeBinding("kyo_lp_add_remove", { intentType: "lp_add_liquidity" });

// GMX perp uses Aave-style open/close for now (placeholder until perp-specific helper)
registerLendingLikeBinding("gmx_v2_perp_open_close", { intentType: "perp_open" });
