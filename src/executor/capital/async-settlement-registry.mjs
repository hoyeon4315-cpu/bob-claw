const REGISTRY = new Map();

export function registerAsyncSettlementHandler(familyId, { gracePeriodMs = 300_000, destinationProofReader = null }) {
  if (typeof familyId !== "string" || familyId.trim() === "") {
    throw new Error("familyId must be a non-empty string");
  }
  if (!Number.isFinite(gracePeriodMs) || gracePeriodMs <= 0) {
    throw new Error("gracePeriodMs must be a positive finite number");
  }
  if (typeof destinationProofReader !== "function") {
    throw new Error("destinationProofReader must be a function");
  }
  REGISTRY.set(familyId, Object.freeze({
    familyId,
    gracePeriodMs: Math.ceil(gracePeriodMs),
    destinationProofReader,
  }));
}

export function getAsyncSettlementHandler(familyId) {
  return REGISTRY.get(familyId) || null;
}

export function hasAsyncSettlementHandler(familyId) {
  return REGISTRY.has(familyId);
}

export function listAsyncSettlementFamilies() {
  return [...REGISTRY.keys()];
}

export function clearAsyncSettlementRegistry() {
  REGISTRY.clear();
}
