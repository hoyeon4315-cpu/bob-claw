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
