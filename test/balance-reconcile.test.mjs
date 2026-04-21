import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reconcileBalances,
  buildBalanceSnapshotRecord,
  normalizeSnapshot,
} from "../src/executor/balance/reconcile.mjs";

const baseSnap = {
  native: [{ chain: "base", asset: "ETH", decimals: 18, actual: "1000000000000000000" }],
  tokens: [{ chain: "base", asset: "cbBTC", decimals: 8, actual: "100000" }],
};

test("no changes => ok, zero deltas", () => {
  const r = reconcileBalances({ prevSnapshot: baseSnap, currSnapshot: baseSnap });
  assert.equal(r.ok, true);
  assert.equal(r.action, "continue");
  assert.equal(r.counts.expected, 0);
  assert.equal(r.counts.unexpected, 0);
});

test("delta matching intent => expected", () => {
  const curr = {
    native: [{ chain: "base", asset: "ETH", decimals: 18, actual: "900000000000000000" }],
    tokens: [{ chain: "base", asset: "cbBTC", decimals: 8, actual: "100000" }],
  };
  const r = reconcileBalances({
    prevSnapshot: baseSnap,
    currSnapshot: curr,
    expectedIntents: [{ chain: "base", asset: "ETH", deltaWei: "-100000000000000000" }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.counts.expected, 1);
  assert.equal(r.expected[0].kind, "explained");
});

test("unexpected delta => anomaly + emergency_pause", () => {
  const curr = {
    native: [{ chain: "base", asset: "ETH", decimals: 18, actual: "500000000000000000" }],
    tokens: [{ chain: "base", asset: "cbBTC", decimals: 8, actual: "100000" }],
  };
  const r = reconcileBalances({ prevSnapshot: baseSnap, currSnapshot: curr });
  assert.equal(r.ok, false);
  assert.equal(r.action, "emergency_pause");
  assert.equal(r.counts.unexpected, 1);
  assert.equal(r.unexpected[0].chain, "base");
  assert.equal(r.unexpected[0].kind, "unexplained");
});

test("tolerance applied", () => {
  const curr = {
    native: [{ chain: "base", asset: "ETH", decimals: 18, actual: "999999999999999999" }],
    tokens: [{ chain: "base", asset: "cbBTC", decimals: 8, actual: "100000" }],
  };
  const r = reconcileBalances({
    prevSnapshot: baseSnap,
    currSnapshot: curr,
    toleranceWei: "10",
  });
  assert.equal(r.ok, true);
  assert.equal(r.counts.expected, 1);
});

test("partial intent match => residual unexpected", () => {
  const curr = {
    native: [{ chain: "base", asset: "ETH", decimals: 18, actual: "500000000000000000" }],
    tokens: baseSnap.tokens,
  };
  const r = reconcileBalances({
    prevSnapshot: baseSnap,
    currSnapshot: curr,
    expectedIntents: [{ chain: "base", asset: "ETH", deltaWei: "-100000000000000000" }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.counts.unexpected, 1);
  assert.equal(r.unexpected[0].residualDeltaWei, "-400000000000000000");
});

test("multiple intents on same key aggregate", () => {
  const curr = {
    native: [{ chain: "base", asset: "ETH", decimals: 18, actual: "700000000000000000" }],
    tokens: baseSnap.tokens,
  };
  const r = reconcileBalances({
    prevSnapshot: baseSnap,
    currSnapshot: curr,
    expectedIntents: [
      { chain: "base", asset: "ETH", deltaWei: "-100000000000000000" },
      { chain: "base", asset: "ETH", deltaWei: "-200000000000000000" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.counts.expected, 1);
});

test("missing intent (no observed delta)", () => {
  const r = reconcileBalances({
    prevSnapshot: baseSnap,
    currSnapshot: baseSnap,
    expectedIntents: [{ chain: "avalanche", asset: "USDC", deltaWei: "1000000" }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.counts.missing, 1);
  assert.equal(r.missing[0].chain, "avalanche");
});

test("result is frozen", () => {
  const r = reconcileBalances({ prevSnapshot: baseSnap, currSnapshot: baseSnap });
  assert.throws(() => { r.ok = false; });
  assert.throws(() => { r.expected.push({}); });
  assert.throws(() => { r.counts.expected = 99; });
});

test("buildBalanceSnapshotRecord sorts deterministically", () => {
  const rec = buildBalanceSnapshotRecord({ inventory: baseSnap, observedAt: "2026-04-21T00:00:00Z" });
  assert.equal(rec.schemaVersion, 1);
  assert.equal(rec.rows.length, 2);
  const keys = rec.rows.map((r) => r.chain + r.asset);
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(keys, sorted);
});

test("normalizeSnapshot is case-insensitive on chain/asset keys", () => {
  const m = normalizeSnapshot({ native: [{ chain: "Base", asset: "Eth", actual: "1" }] });
  assert.equal(m.size, 1);
  assert.ok(m.has("base::eth"));
});

test("empty/null snapshots tolerated", () => {
  const r = reconcileBalances({ prevSnapshot: null, currSnapshot: null });
  assert.equal(r.ok, true);
  assert.equal(r.counts.expected, 0);
});

test("appearance from zero counted as delta", () => {
  const curr = {
    native: baseSnap.native,
    tokens: [
      ...baseSnap.tokens,
      { chain: "avalanche", asset: "USDC", decimals: 6, actual: "5000000" },
    ],
  };
  const r = reconcileBalances({ prevSnapshot: baseSnap, currSnapshot: curr });
  assert.equal(r.ok, false);
  assert.equal(r.counts.unexpected, 1);
  assert.equal(r.unexpected[0].chain, "avalanche");
  assert.equal(r.unexpected[0].prevWei, "0");
});
