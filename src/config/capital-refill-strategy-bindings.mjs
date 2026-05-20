// Method/source-tuple → committed strategy-id binding for capital_refill
// dry-run intents.
//
// The funding-source planner (src/treasury/funding-source-planner.mjs) emits a
// canonical execution method string (e.g. "cross_chain_bridge_or_swap",
// "cross_chain_bridge_lifi", "same_chain_token_to_token_swap"). Strategy caps
// for these execution surfaces live in src/config/strategy-caps/registry.mjs.
// This table is the structural join key between the two surfaces so report-only
// lifecycle/lane-handler code can resolve real perTx/perDay/maxDailyLoss caps
// without inventing them or guessing per-call.
//
// Keys are method names (and, for source-sensitive disambiguation, a
// `<method>__source_<chain>` suffix). Values are committed strategy-ids that
// must exist in `STRATEGY_CAPS`. This file does not relax any policy gate, set
// any runtime authority, or store live values; it is a deterministic mapping
// of names that already exist on both sides.

const BASE_BINDINGS = Object.freeze({
  cross_chain_bridge_or_swap: "gateway-btc-funding-transfer",
  cross_chain_swap_via_btc_intermediate: "gateway-btc-funding-transfer",
  cross_chain_bridge_lifi: "lifi-bridge",
  cross_chain_bridge_across: "across-bridge",
  gas_refuel_bridge_gas_zip: "gas-zip-native-refuel",
  same_chain_native_to_token_swap: "native-dex-experiment",
  same_chain_token_to_token_swap: "native-dex-experiment",
});

const SOURCE_SCOPED_BINDINGS = Object.freeze({
  // Native BTC source on the same canonical onramp method routes to the BTC
  // onramp strategy caps, not the inter-EVM funding-transfer caps.
  cross_chain_bridge_or_swap__source_bitcoin: "gateway-btc-onramp",
});

export const CAPITAL_REFILL_METHOD_STRATEGY_BINDINGS = Object.freeze({
  ...BASE_BINDINGS,
  ...SOURCE_SCOPED_BINDINGS,
});

function normalize(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

export function resolveCapitalRefillStrategyId({ selectedMethod = null, sourceChain = null } = {}) {
  if (typeof selectedMethod !== "string" || selectedMethod.length === 0) return null;
  const sourceKey = normalize(sourceChain);
  if (sourceKey) {
    const scoped = SOURCE_SCOPED_BINDINGS[`${selectedMethod}__source_${sourceKey}`];
    if (scoped) return scoped;
  }
  return BASE_BINDINGS[selectedMethod] || null;
}

// Stable producer reference for lifecycle reporting.
export const CAPITAL_REFILL_BINDING_PRODUCER = Object.freeze({
  module: "src/config/capital-refill-strategy-bindings.mjs",
  function: "resolveCapitalRefillStrategyId",
});
