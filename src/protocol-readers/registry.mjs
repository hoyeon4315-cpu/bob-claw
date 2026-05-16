// Central registry of protocol readers (Phase 1.2 facade).
// Bridges legacy treasury/protocol-position-adapter-registry (mark-based) and
// the new ProtocolReader interface (read-based).
//
// Step A (current): registry hosts new readers; legacy adapters remain via thin import.
// Step B (later PR): legacy adapters become wrappers that call into new readers.

import { makeReaderError, makeReaderResult, validateNormalizedPosition, isReaderResult } from "./spec.mjs";
import { canonicalBindingKind } from "./binding-kind.mjs";

import { resolveProtocolPositionAdapter } from "../treasury/protocol-position-adapter-registry.mjs";

const READERS = new Map();
const READERS_BY_BINDING = new Map();

export function registerReader({ id, bindingKinds = [], reader }) {
  if (!id || typeof id !== "string") throw new Error("registerReader requires id");
  if (typeof reader !== "function") throw new Error("registerReader requires reader function");
  READERS.set(id, { id, bindingKinds, reader });
  for (const kind of bindingKinds) {
    READERS_BY_BINDING.set(kind, id);
  }
}

export function listReaders() {
  return [...READERS.values()].map(({ id, bindingKinds }) => ({ id, bindingKinds: [...bindingKinds] }));
}

export function getReader(id) {
  return READERS.get(id) || null;
}

export function resolveReaderForBinding(bindingKind) {
  const id = READERS_BY_BINDING.get(canonicalBindingKind(bindingKind));
  return id ? READERS.get(id) : null;
}

export async function runReader(id, input) {
  const entry = READERS.get(id);
  if (!entry) {
    return makeReaderError({ error: `reader not registered: ${id}`, code: "reader_unknown" });
  }
  let result;
  try {
    result = await entry.reader(input);
  } catch (err) {
    return makeReaderError({ error: err && err.message ? err.message : String(err), code: "reader_throw" });
  }
  if (!isReaderResult(result)) {
    return makeReaderError({
      error: `reader ${id} returned invalid result shape`,
      code: "reader_invalid_shape",
    });
  }
  if (result.ok) {
    const invalid = [];
    for (const position of result.positions) {
      const v = validateNormalizedPosition(position);
      if (!v.valid) invalid.push({ positionId: position.positionId || null, errors: v.errors });
    }
    if (invalid.length > 0) {
      return makeReaderError({
        error: `reader ${id} produced invalid positions`,
        code: "reader_invalid_positions",
        positions: result.positions,
        skipped: [...(result.skipped || []), ...invalid.map((i) => ({ kind: "invalid_position", ...i }))],
      });
    }
  }
  return result;
}

// Lazy registration helper; readers register themselves at module import time
// to avoid circular imports during reader scaffolding.
export function ensureRegistered(loaderFn) {
  if (typeof loaderFn === "function") loaderFn({ registerReader });
}

export function legacyAdapterFor(position) {
  return resolveProtocolPositionAdapter(position);
}

export function _resetForTesting() {
  READERS.clear();
  READERS_BY_BINDING.clear();
}

// --- DefiLlama yield evidence & on-chain verification support ---
// Owned by Protocol Reader & On-chain Data Engineer (Evidence, Data & Quality Domain Lead).
// Provides DefiLlama-aware resolvers (resolveReaderForDefiLlamaPool, resolveReaderForPool)
// and the canonical list of receipt-bound projects that have ProtocolReader impls.
// This is the single source of truth for evidenceClass reliability in DefiLlama snapshots
// and for mapping pools to on-chain readers for receipt delta proofs (YCE-001/002/003 E2E).
// Adding a new project here + reader impl + bootstrap registration automatically makes
// its pools "protocol_receipt_bound" and usable for receipt generation.

const DEFI_LLAMA_PROJECT_READER_MAP = Object.freeze({
  "aave": "aave-v3",
  "aave-v3": "aave-v3",
  "beefy": "beefy",
  "erc4626": "erc4626",
  "pendle": "pendle",
  "venus": "venus",
  // compound-v3, moonwell, compound, euler and others: add here when dedicated reader
  // is implemented in readers/ + registered via bootstrap.mjs. Until then they stay
  // "protocol_not_receipt_bound" so classification matches actual on-chain verification capability.
});

export function getDefiLlamaSupportedReceiptProjects() {
  return Object.keys(DEFI_LLAMA_PROJECT_READER_MAP);
}

export function resolveReaderForDefiLlamaPool(pool = {}) {
  const p = String(pool.project || pool.protocol || pool.poolMeta?.project || "").toLowerCase().trim();
  const readerId = DEFI_LLAMA_PROJECT_READER_MAP[p];
  if (!readerId) return null;
  const readerEntry = getReader(readerId); // may be null pre-bootstrapReaders()
  return {
    readerId,
    bindingKind: (readerEntry?.bindingKinds && readerEntry.bindingKinds[0]) || `${readerId}_supply_withdraw`,
    supported: !!readerEntry,
    chain: pool.chain || null,
    family: pool.family || null,
    metadata: { project: p, symbol: pool.symbol || null },
  };
}

export function resolveReaderForPool(positionOrPool = {}) {
  if (!positionOrPool || typeof positionOrPool !== "object") return null;
  if (positionOrPool.project || positionOrPool.protocol) {
    return resolveReaderForDefiLlamaPool(positionOrPool);
  }
  if (positionOrPool.bindingKind) {
    const r = resolveReaderForBinding(positionOrPool.bindingKind);
    if (r) {
      return {
        readerId: r.id,
        bindingKind: positionOrPool.bindingKind,
        supported: true,
        chain: positionOrPool.chain || null,
        family: positionOrPool.family || null,
      };
    }
  }
  return null;
}
