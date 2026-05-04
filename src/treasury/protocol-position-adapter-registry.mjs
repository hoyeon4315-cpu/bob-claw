import { markAaveV3Position } from "./protocol-position-adapters/aave-v3.mjs";
import { markCompoundV2Position } from "./protocol-position-adapters/compound-v2.mjs";
import { markErc4626Position } from "./protocol-position-adapters/erc4626.mjs";
import { canonicalBindingKind } from "../protocol-readers/binding-kind.mjs";

const ADAPTERS_BY_BINDING_KIND = new Map([
  ["erc4626_vault_supply_withdraw", { id: "erc4626", mark: markErc4626Position }],
  ["euler_evault_deposit_withdraw", { id: "erc4626", mark: markErc4626Position }],
  ["aave_v3_supply_withdraw", { id: "aave-v3", mark: markAaveV3Position }],
  ["compound_v2_supply_withdraw", { id: "compound-v2", mark: markCompoundV2Position }],
]);

export function resolveProtocolPositionAdapter(position = {}) {
  return ADAPTERS_BY_BINDING_KIND.get(canonicalBindingKind(position.bindingKind)) || null;
}
