// ProtocolReader interface specification
// Contract for all on-chain protocol position readers.
//
// Every reader returns either:
//   - { ok: true, positions: NormalizedPosition[], skipped: SkipNote[], notes: string[] }
//   - { ok: false, error: string, code: string, positions: [], skipped: SkipNote[] }
//
// NormalizedPosition is a stable schema compatible with protocol-position-mark-schema.
// Readers MUST NOT silently swallow errors. Empty result requires explicit reason.

export const FRESHNESS = Object.freeze({
  FRESH: "fresh",
  RECENT: "recent",
  STALE: "stale",
  EXPIRED: "expired",
  FAILED: "failed",
});

export const CONFIDENCE = Object.freeze({
  VERIFIED_CURRENT: "verified_current",
  VERIFIED_MINIMUM: "verified_minimum",
  ADAPTER_MISSING: "adapter_missing",
  PARTIAL: "partial",
});

const REQUIRED_FIELDS = [
  "positionId",
  "walletAddress",
  "bindingKind",
  "protocolId",
  "adapterId",
  "chain",
  "family",
  "fetchedAt",
  "observedAt",
];

const ALLOWED_FAMILIES = new Set([
  "cl_lp",
  "lending_loop",
  "vault_share",
  "basis",
  "campaign_only",
  "nft_lp",
  "perp_position",
  "expiry_token",
]);

export function makeReaderResult({ positions = [], skipped = [], notes = [] } = {}) {
  return { ok: true, positions, skipped, notes };
}

export function makeReaderError({ error, code = "reader_failed", positions = [], skipped = [] } = {}) {
  if (!error || typeof error !== "string") {
    throw new Error("makeReaderError requires a non-empty string error");
  }
  return { ok: false, error, code, positions, skipped };
}

export function validateNormalizedPosition(position = {}) {
  const errors = [];
  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = position[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    errors.push(`missing required fields: ${missing.join(",")}`);
  }
  if (position.family && !ALLOWED_FAMILIES.has(position.family)) {
    errors.push(`unknown family: ${position.family}`);
  }
  return { valid: errors.length === 0, errors };
}

export function defaultPositionId({ chain, protocolId, walletAddress, marketKey }) {
  return [chain, protocolId, walletAddress, marketKey].filter(Boolean).join(":");
}

export function isReaderResult(result) {
  return Boolean(result && typeof result === "object" && typeof result.ok === "boolean" && Array.isArray(result.positions));
}

export const ALLOWED_FAMILIES_LIST = Object.freeze([...ALLOWED_FAMILIES]);
