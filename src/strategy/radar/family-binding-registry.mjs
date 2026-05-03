const EMPTY_FIELDS = Object.freeze([]);

const FAMILY_BINDINGS = Object.freeze({
  btc_collateral_stable_borrow: Object.freeze({
    strategyId: "wrapped-btc-loop-base-moonwell",
    executionSubType: "leverage_loop_step",
    defaultHoldDays: 14,
    requiredFields: Object.freeze(["healthFactorAfter", "liquidationBufferPct"]),
    supportedChains: Object.freeze(["base"]),
  }),
  wrapped_btc_direct_lending: Object.freeze({
    strategyId: "wrapped-btc-loop-base-moonwell",
    executionSubType: "erc4626_deposit",
    defaultHoldDays: 21,
    requiredFields: EMPTY_FIELDS,
    supportedChains: Object.freeze(["base"]),
  }),
  same_chain_stable_carry: Object.freeze({
    strategyId: "stablecoin_spread_loop",
    executionSubType: "erc4626_deposit",
    defaultHoldDays: 14,
    requiredFields: EMPTY_FIELDS,
  }),
  pendle_pt_btc: Object.freeze({
    strategyId: "pendle-pt-lbtc-base",
    executionSubType: "pendle_pt_buy",
    defaultHoldDays: 30,
    requiredFields: EMPTY_FIELDS,
    supportedChains: Object.freeze(["base"]),
  }),
  cl_managed_required: null,
  point_or_pre_tge: null,
});

function normalizedChain(chain) {
  return String(chain || "").trim().toLowerCase();
}

function publicBinding(binding) {
  if (!binding) return null;
  return {
    strategyId: binding.strategyId,
    executionSubType: binding.executionSubType,
    defaultHoldDays: binding.defaultHoldDays,
    requiredFields: binding.requiredFields,
  };
}

export function resolveFamilyBinding(candidate = {}) {
  const binding = FAMILY_BINDINGS[candidate.familyKey] ?? null;
  if (!binding) return null;
  if (binding.supportedChains && !binding.supportedChains.includes(normalizedChain(candidate.chain))) {
    return null;
  }
  return publicBinding(binding);
}

export function listFamilyBindings() {
  return Object.entries(FAMILY_BINDINGS).map(([familyKey, binding]) => ({
    familyKey,
    binding: publicBinding(binding),
  }));
}
