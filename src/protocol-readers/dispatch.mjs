// Unified dispatch for protocol position observation.
// Tries the new ProtocolReader registry first, then falls back to the
// legacy mark-based adapter registry under src/treasury/. Returns an
// explicit shape so callers can distinguish reader/legacy/none and never
// silently skip a position.

import { resolveReaderForBinding, runReader, legacyAdapterFor } from "./registry.mjs";

export async function dispatchPosition({ position, chain, walletAddress, signer = null } = {}) {
  if (!position || typeof position !== "object") {
    return { kind: "none", reason: "missing_position" };
  }
  if (typeof position.bindingKind !== "string" || position.bindingKind.trim() === "") {
    return { kind: "none", reason: "missing_binding_kind" };
  }
  const reader = resolveReaderForBinding(position.bindingKind);
  if (reader) {
    const result = await runReader(reader.id, { chain, walletAddress, position, signer });
    return { kind: "reader", id: reader.id, result };
  }
  const legacy = legacyAdapterFor(position);
  if (legacy) {
    return { kind: "legacy", adapter: legacy };
  }
  return { kind: "none", reason: "no_reader_no_adapter" };
}
