import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeReaderError,
  makeReaderResult,
  validateNormalizedPosition,
  defaultPositionId,
  isReaderResult,
  ALLOWED_FAMILIES_LIST,
} from "../src/protocol-readers/spec.mjs";

test("makeReaderResult shapes ok=true", () => {
  const r = makeReaderResult({ positions: [{ a: 1 }], notes: ["n"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.notes, ["n"]);
  assert.equal(r.positions.length, 1);
});

test("makeReaderError rejects empty error", () => {
  assert.throws(() => makeReaderError({ error: "" }));
  const r = makeReaderError({ error: "boom" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "boom");
  assert.equal(r.code, "reader_failed");
});

test("validateNormalizedPosition flags missing fields", () => {
  const r = validateNormalizedPosition({});
  assert.equal(r.valid, false);
  assert.match(r.errors.join(","), /missing required/);
});

test("validateNormalizedPosition flags unknown family", () => {
  const r = validateNormalizedPosition({
    positionId: "p", walletAddress: "w", bindingKind: "b", protocolId: "p",
    adapterId: "a", chain: "c", family: "no-such", fetchedAt: "t", observedAt: "t",
  });
  assert.equal(r.valid, false);
});

test("validateNormalizedPosition accepts a complete position", () => {
  const r = validateNormalizedPosition({
    positionId: "p", walletAddress: "w", bindingKind: "b", protocolId: "p",
    adapterId: "a", chain: "c", family: "vault_share", fetchedAt: "t", observedAt: "t",
  });
  assert.equal(r.valid, true);
});

test("defaultPositionId composes parts", () => {
  assert.equal(defaultPositionId({ chain: "base", protocolId: "x", walletAddress: "w", marketKey: "m" }), "base:x:w:m");
});

test("isReaderResult guards shape", () => {
  assert.equal(isReaderResult(null), false);
  assert.equal(isReaderResult({ ok: true, positions: [] }), true);
  assert.equal(isReaderResult({ ok: true }), false);
});

test("ALLOWED_FAMILIES_LIST is non-empty and frozen-ish", () => {
  assert.ok(ALLOWED_FAMILIES_LIST.length >= 5);
  assert.ok(ALLOWED_FAMILIES_LIST.includes("vault_share"));
  assert.ok(ALLOWED_FAMILIES_LIST.includes("lending_loop"));
});
