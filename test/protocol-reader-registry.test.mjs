import { test } from "node:test";
import assert from "node:assert/strict";

import {
  registerReader, listReaders, getReader, runReader, resolveReaderForBinding, _resetForTesting,
} from "../src/protocol-readers/registry.mjs";
import { makeReaderResult, makeReaderError } from "../src/protocol-readers/spec.mjs";

function fakeRegistration(id, kinds, fn) {
  return { id, bindingKinds: kinds, reader: fn };
}

function freshPosition(overrides = {}) {
  return {
    positionId: "base:x:w:m",
    walletAddress: "w",
    bindingKind: "k",
    protocolId: "x",
    adapterId: "x",
    chain: "base",
    family: "vault_share",
    fetchedAt: "t",
    observedAt: "t",
    ...overrides,
  };
}

test("registerReader registers reader and binding lookups", () => {
  _resetForTesting();
  registerReader(fakeRegistration("foo", ["k1", "k2"], async () => makeReaderResult({ positions: [] })));
  assert.equal(getReader("foo")?.id, "foo");
  assert.equal(resolveReaderForBinding("k1")?.id, "foo");
  assert.equal(resolveReaderForBinding("k2")?.id, "foo");
  assert.equal(listReaders().length, 1);
});

test("runReader returns error for unknown id", async () => {
  _resetForTesting();
  const r = await runReader("missing", {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "reader_unknown");
});

test("runReader catches throws", async () => {
  _resetForTesting();
  registerReader(fakeRegistration("boom", ["x"], async () => { throw new Error("kaboom"); }));
  const r = await runReader("boom", {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "reader_throw");
  assert.match(r.error, /kaboom/);
});

test("runReader rejects invalid result shape", async () => {
  _resetForTesting();
  registerReader(fakeRegistration("badshape", ["x"], async () => ({ foo: "bar" })));
  const r = await runReader("badshape", {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "reader_invalid_shape");
});

test("runReader validates each position", async () => {
  _resetForTesting();
  registerReader(fakeRegistration("badpos", ["x"], async () => makeReaderResult({ positions: [{ chain: "base" }] })));
  const r = await runReader("badpos", {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "reader_invalid_positions");
  assert.ok(r.skipped.some((s) => s.kind === "invalid_position"));
});

test("runReader passes through valid positions", async () => {
  _resetForTesting();
  registerReader(fakeRegistration("good", ["x"], async () => makeReaderResult({ positions: [freshPosition()] })));
  const r = await runReader("good", {});
  assert.equal(r.ok, true);
  assert.equal(r.positions.length, 1);
});
