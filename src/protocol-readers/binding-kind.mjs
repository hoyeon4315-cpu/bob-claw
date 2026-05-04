const BINDING_KIND_ALIASES = Object.freeze({
  aave_v3_pool_supply_withdraw: "aave_v3_supply_withdraw",
});

export function canonicalBindingKind(bindingKind) {
  if (!bindingKind) return null;
  return BINDING_KIND_ALIASES[bindingKind] || bindingKind;
}

