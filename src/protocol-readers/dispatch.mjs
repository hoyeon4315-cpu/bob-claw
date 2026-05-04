// Unified dispatch for protocol position observation.
// Tries the new ProtocolReader registry first, then falls back to the
// legacy mark-based adapter registry under src/treasury/. Returns an
// explicit shape so callers can distinguish reader/legacy/none and never
// silently skip a position.

import { resolveReaderForBinding, runReader, legacyAdapterFor } from "./registry.mjs";

export function buildReaderParams(position = {}) {
  const rawParams = position?.params && typeof position.params === "object" ? position.params : {};
  const shareTokenAddress =
    rawParams.shareTokenAddress ||
    position.shareTokenAddress ||
    rawParams.vaultAddress ||
    position.vaultAddress ||
    rawParams.aTokenAddress ||
    position.aTokenAddress ||
    rawParams.cTokenAddress ||
    position.cTokenAddress ||
    null;
  const assetAddress =
    rawParams.assetAddress ||
    position.assetAddress ||
    rawParams.underlyingTokenAddress ||
    position.underlyingTokenAddress ||
    null;
  return {
    ...position,
    ...rawParams,
    vaultAddress: rawParams.vaultAddress || position.vaultAddress || shareTokenAddress,
    shareTokenAddress,
    aTokenAddress: rawParams.aTokenAddress || position.aTokenAddress || shareTokenAddress,
    cTokenAddress: rawParams.cTokenAddress || position.cTokenAddress || shareTokenAddress,
    poolAddress: rawParams.poolAddress || position.poolAddress || null,
    poolAddressProviderAddress: rawParams.poolAddressProviderAddress || position.poolAddressProviderAddress || null,
    marketAddress: rawParams.marketAddress || position.marketAddress || position.vaultAddress || position.shareTokenAddress || null,
    marketLabel: rawParams.marketLabel || position.marketLabel || position.marketName || shareTokenAddress,
    assetAddress,
    underlyingTokenAddress: rawParams.underlyingTokenAddress || position.underlyingTokenAddress || assetAddress,
    variableDebtTokenAddress: rawParams.variableDebtTokenAddress || position.variableDebtTokenAddress || null,
    stableDebtTokenAddress: rawParams.stableDebtTokenAddress || position.stableDebtTokenAddress || null,
    underlyingDecimals: rawParams.underlyingDecimals ?? position.underlyingDecimals ?? position.assetDecimals ?? null,
  };
}

export async function dispatchPosition({ position, chain, walletAddress, signer = null, ...readerInput } = {}) {
  if (!position || typeof position !== "object") {
    return { kind: "none", reason: "missing_position" };
  }
  if (typeof position.bindingKind !== "string" || position.bindingKind.trim() === "") {
    return { kind: "none", reason: "missing_binding_kind" };
  }
  const reader = resolveReaderForBinding(position.bindingKind);
  if (reader) {
    const params = buildReaderParams(position);
    const result = await runReader(reader.id, { chain, walletAddress, position, params, signer, ...readerInput });
    return { kind: "reader", id: reader.id, result };
  }
  const legacy = legacyAdapterFor(position);
  if (legacy) {
    return { kind: "legacy", adapter: legacy };
  }
  return { kind: "none", reason: "no_reader_no_adapter" };
}
