const PROTOCOL_BINDINGS = Object.freeze({
  morpho: Object.freeze({
    protocolId: "morpho",
    supportedSurfaces: Object.freeze(["lending", "stableCarry", "ethLending"]),
    bindingKind: "erc4626_vault_supply_withdraw",
    requiredBindingFields: Object.freeze(["vaultAddress", "assetAddress"]),
    optionalBindingFields: Object.freeze(["shareTokenAddress", "referralCode"]),
    approvalTargetField: "vaultAddress",
    canaryActions: Object.freeze([
      "approve_exact_asset_to_vault",
      "deposit_asset_for_shares",
      "verify_share_balance_delta",
      "withdraw_or_redeem_shares",
      "verify_asset_balance_delta",
      "revoke_or_zero_idle_allowance",
    ]),
    notes: Object.freeze([
      "Morpho vault canaries use ERC-4626 style deposit/withdraw flow when the opportunity exposes a vault address.",
      "Market-level Morpho supply opportunities must resolve the concrete vault or market wrapper before signing.",
    ]),
  }),
  aave: Object.freeze({
    protocolId: "aave",
    supportedSurfaces: Object.freeze(["lending", "stableBorrow", "stableCarry", "ethLending"]),
    bindingKind: "aave_v3_pool_supply_withdraw",
    requiredBindingFields: Object.freeze(["poolAddress", "assetAddress", "aTokenAddress"]),
    optionalBindingFields: Object.freeze(["poolAddressProviderAddress", "marketName", "referralCode"]),
    approvalTargetField: "poolAddress",
    canaryActions: Object.freeze([
      "approve_exact_asset_to_pool",
      "supply_asset_to_pool",
      "verify_atoken_balance_delta",
      "withdraw_asset_from_pool",
      "verify_asset_balance_delta",
      "revoke_or_zero_idle_allowance",
    ]),
    notes: Object.freeze([
      "Aave canaries stop at supply/withdraw unless the queue item explicitly requests a borrow leg and health-factor checks.",
    ]),
  }),
  yei: Object.freeze({
    protocolId: "yei",
    supportedSurfaces: Object.freeze(["stableCarry", "stableBorrow"]),
    bindingKind: "aave_v3_pool_supply_withdraw",
    requiredBindingFields: Object.freeze(["poolAddress", "assetAddress", "aTokenAddress"]),
    optionalBindingFields: Object.freeze(["poolAddressProviderAddress", "marketName", "referralCode"]),
    approvalTargetField: "poolAddress",
    canaryActions: Object.freeze([
      "approve_exact_asset_to_pool",
      "supply_asset_to_pool",
      "verify_atoken_balance_delta",
      "withdraw_asset_from_pool",
      "verify_asset_balance_delta",
      "revoke_or_zero_idle_allowance",
    ]),
    notes: Object.freeze([
      "Yei opportunities are Aave-style supplies, but signing requires a pinned pool or addresses-provider binding first.",
      "Borrow-leg campaigns still require health-factor and liquidation-buffer checks before live execution.",
    ]),
  }),
  euler: Object.freeze({
    protocolId: "euler",
    supportedSurfaces: Object.freeze(["lending", "stableBorrow", "stableCarry", "ethLending"]),
    bindingKind: "euler_evault_deposit_withdraw",
    requiredBindingFields: Object.freeze(["vaultAddress", "assetAddress"]),
    optionalBindingFields: Object.freeze(["evcAddress", "unitOfAccount", "oracleAddress"]),
    approvalTargetField: "vaultAddress",
    canaryActions: Object.freeze([
      "approve_exact_asset_to_evault",
      "deposit_asset_to_evault",
      "verify_evault_share_delta",
      "withdraw_asset_from_evault",
      "verify_asset_balance_delta",
      "revoke_or_zero_idle_allowance",
    ]),
    notes: Object.freeze([
      "Euler borrow canaries require the EVC/account controller and oracle fields before policy can evaluate liquidation risk.",
    ]),
  }),
  yo: Object.freeze({
    protocolId: "yo",
    supportedSurfaces: Object.freeze(["stableCarry", "ethLending", "reserveAllocation"]),
    bindingKind: "erc4626_vault_supply_withdraw",
    requiredBindingFields: Object.freeze(["vaultAddress", "assetAddress"]),
    optionalBindingFields: Object.freeze(["shareTokenAddress", "referralCode"]),
    approvalTargetField: "vaultAddress",
    canaryActions: Object.freeze([
      "approve_exact_asset_to_vault",
      "deposit_asset_for_shares",
      "verify_share_balance_delta",
      "withdraw_or_redeem_shares",
      "verify_asset_balance_delta",
      "revoke_or_zero_idle_allowance",
    ]),
    notes: Object.freeze([
      "YO vault opportunities expose ERC-4626-compatible vault addresses in Merkl explorerAddress/depositUrl fields.",
      "Only tiny deposit/redeem canaries are automated until reward accounting and unwind costs are receipt-backed.",
    ]),
  }),
  summerfinance: Object.freeze({
    protocolId: "summerfinance",
    supportedSurfaces: Object.freeze(["stableCarry", "ethLending"]),
    bindingKind: "erc4626_vault_supply_withdraw",
    requiredBindingFields: Object.freeze(["vaultAddress", "assetAddress"]),
    optionalBindingFields: Object.freeze(["shareTokenAddress", "referralCode"]),
    approvalTargetField: "vaultAddress",
    canaryActions: Object.freeze([
      "approve_exact_asset_to_vault",
      "deposit_asset_for_shares",
      "verify_share_balance_delta",
      "withdraw_or_redeem_shares",
      "verify_asset_balance_delta",
      "revoke_or_zero_idle_allowance",
    ]),
    notes: Object.freeze([
      "Summer Finance earn positions expose ERC-4626-compatible vault addresses in Merkl explorerAddress/depositUrl fields.",
      "Ethereum L1 execution still requires gas-efficient notional, inventory, and policy approval before signing.",
    ]),
  }),
  venus: Object.freeze({
    protocolId: "venus",
    supportedSurfaces: Object.freeze(["lending", "stableCarry", "ethLending"]),
    bindingKind: "erc4626_vault_supply_withdraw",
    requiredBindingFields: Object.freeze(["vaultAddress", "assetAddress"]),
    optionalBindingFields: Object.freeze(["shareTokenAddress", "referralCode"]),
    approvalTargetField: "vaultAddress",
    canaryActions: Object.freeze([
      "approve_exact_asset_to_vault",
      "deposit_asset_for_shares",
      "verify_share_balance_delta",
      "withdraw_or_redeem_shares",
      "verify_asset_balance_delta",
      "revoke_or_zero_idle_allowance",
    ]),
    notes: Object.freeze([
      "Venus BSC opportunities are admitted through the existing ERC-4626-style canary registry only when a concrete vault/share wrapper binding is pinned.",
      "This adds BSC discovery diversity without creating a new strategy lane or bypassing deterministic signer policy.",
    ]),
  }),
  pendle: Object.freeze({
    protocolId: "pendle",
    supportedSurfaces: Object.freeze(["fixedYield"]),
    bindingKind: "pendle_pt_vault_deposit_withdraw",
    requiredBindingFields: Object.freeze(["vaultAddress", "assetAddress"]),
    optionalBindingFields: Object.freeze(["shareTokenAddress", "marketAddress", "instrument", "maturity", "ytExpiry"]),
    approvalTargetField: "vaultAddress",
    canaryActions: Object.freeze([
      "approve_exact_asset_to_pendle_adapter",
      "enter_fixed_yield_token",
      "verify_position_token_delta",
      "exit_fixed_yield_token",
      "verify_asset_balance_delta",
      "revoke_or_zero_idle_allowance",
    ]),
    notes: Object.freeze([
      "Pendle PT/YT opportunities are admitted only from market metadata; no pool address is hardcoded in the binding registry.",
      "YT canaries require a YT token address, maturity metadata, and exit quote proof before signing.",
    ]),
  }),
});

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function missingFields(binding = {}, fields = []) {
  return fields.filter((field) => !binding[field]);
}

function missingBindingFields(template = {}, binding = {}) {
  if (template.protocolId === "pendle" && binding.instrument === "yt") {
    return missingFields(binding, ["marketAddress", "ytTokenAddress", "assetAddress"]);
  }
  if (["aave", "yei"].includes(template.protocolId)) {
    const missing = [];
    if (!binding.poolAddress && !binding.poolAddressProviderAddress) missing.push("poolAddress");
    if (!binding.assetAddress) missing.push("assetAddress");
    if (!binding.aTokenAddress) missing.push("aTokenAddress");
    return missing;
  }
  return missingFields(binding, template.requiredBindingFields);
}

function pickBindingFields(binding = {}, fields = []) {
  return Object.fromEntries(
    fields
      .filter((field) => binding[field] !== undefined && binding[field] !== null)
      .map((field) => [field, binding[field]]),
  );
}

export function resolveProtocolCanaryBinding(protocolId) {
  return PROTOCOL_BINDINGS[normalize(protocolId)] || null;
}

export function buildProtocolCanaryBindingPlan({ opportunity = {}, binding = null } = {}) {
  const template = resolveProtocolCanaryBinding(opportunity.protocolId);
  if (!template) {
    return {
      status: "unsupported_protocol_binding",
      protocolId: opportunity.protocolId || null,
      bindingKind: null,
      missingBindingFields: [],
      canaryActions: [],
      notes: [],
    };
  }

  const surface = opportunity.executionSurface || null;
  const unsupportedSurface = surface && !template.supportedSurfaces.includes(surface);
  const missing = missingBindingFields(template, binding || {});
  const pendleYt = template.protocolId === "pendle" && binding?.instrument === "yt";
  const bindingKind = pendleYt ? "pendle_yt_buy_sell_redeem" : template.bindingKind;
  const requiredBindingFields = pendleYt ? ["marketAddress", "ytTokenAddress", "assetAddress"] : template.requiredBindingFields;
  const optionalBindingFields = pendleYt
    ? ["shareTokenAddress", "ytTokenSymbol", "assetSymbol", "assetDecimals", "maturity", "ytExpiry", "exitQuote", "entryQuote", "impliedAprPct"]
    : template.optionalBindingFields;
  const resolvedBinding = {
    ...pickBindingFields(binding || {}, requiredBindingFields),
    ...pickBindingFields(binding || {}, optionalBindingFields),
    ...pickBindingFields(binding || {}, [
      "assetSymbol",
      "assetDecimals",
      "shareTokenSymbol",
      "aTokenSymbol",
      "depositUrl",
      "source",
      "instrument",
    ]),
  };
  const status = unsupportedSurface
    ? "unsupported_execution_surface"
    : missing.length > 0
      ? "binding_required"
      : "binding_ready";

  return {
    status,
    protocolId: template.protocolId,
    bindingKind,
    executionSurface: surface,
    supportedSurfaces: [...template.supportedSurfaces],
    requiredBindingFields: [...requiredBindingFields],
    optionalBindingFields: [...optionalBindingFields],
    missingBindingFields: missing,
    resolvedBinding,
    approvalTargetField: template.approvalTargetField,
    canaryActions: [...template.canaryActions],
    notes: [...template.notes],
  };
}
