import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateFeedFreshness,
  latestObservedAtOf,
} from "../src/executor/watchdog/feed-freshness.mjs";

const NOW = "2026-04-21T12:00:00Z";
const NOW_MS = Date.parse(NOW);
const minute = 60_000;

function agoIso(ms) {
  return new Date(NOW_MS - ms).toISOString();
}

test("empty feeds => ok, action=continue", () => {
  const r = evaluateFeedFreshness({ feeds: [], now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.action, "continue");
  assert.equal(r.staleCount, 0);
});

test("fresh feed within budget", () => {
  const r = evaluateFeedFreshness({
    feeds: [{ name: "gas_snapshot", lastObservedAt: agoIso(10 * minute), maxAgeMs: 30 * minute }],
    now: NOW,
  });
  assert.equal(r.ok, true);
  assert.equal(r.feeds[0].status, "fresh");
  assert.equal(r.feeds[0].stale, false);
});

test("stale required feed => halt_new_entries", () => {
  const r = evaluateFeedFreshness({
    feeds: [{ name: "gas_snapshot", lastObservedAt: agoIso(60 * minute), maxAgeMs: 30 * minute }],
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.action, "halt_new_entries");
  assert.equal(r.staleCount, 1);
  assert.equal(r.feeds[0].status, "stale");
});

test("missing feed treated as stale", () => {
  const r = evaluateFeedFreshness({
    feeds: [{ name: "oracle", lastObservedAt: null, maxAgeMs: 5 * minute }],
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.feeds[0].status, "missing");
});

test("optional stale feed does not flip ok", () => {
  const r = evaluateFeedFreshness({
    feeds: [{ name: "liquidity_tvl", lastObservedAt: agoIso(120 * minute), maxAgeMs: 60 * minute, required: false }],
    now: NOW,
  });
  assert.equal(r.ok, true);
  assert.equal(r.feeds[0].stale, true);
  assert.equal(r.feeds[0].required, false);
});

test("KILL_SWITCH severity escalates to touch_kill_switch", () => {
  const r = evaluateFeedFreshness({
    feeds: [
      { name: "heartbeat", lastObservedAt: agoIso(10 * minute), maxAgeMs: minute, severity: "KILL_SWITCH" },
    ],
    now: NOW,
  });
  assert.equal(r.action, "touch_kill_switch");
  assert.equal(r.worstSeverity, "KILL_SWITCH");
});

test("worst severity propagates when multiple feeds stale", () => {
  const r = evaluateFeedFreshness({
    feeds: [
      { name: "a", lastObservedAt: agoIso(60 * minute), maxAgeMs: minute, severity: "WARN" },
      { name: "b", lastObservedAt: agoIso(60 * minute), maxAgeMs: minute, severity: "UNWIND_ALL" },
      { name: "c", lastObservedAt: agoIso(60 * minute), maxAgeMs: minute, severity: "HALT_STRATEGY" },
    ],
    now: NOW,
  });
  assert.equal(r.worstSeverity, "UNWIND_ALL");
  assert.equal(r.action, "touch_kill_switch");
  assert.equal(r.staleCount, 3);
});

test("clock skew: future timestamp => status=skewed, not stale", () => {
  const future = new Date(NOW_MS + 5 * minute).toISOString();
  const r = evaluateFeedFreshness({
    feeds: [{ name: "clock", lastObservedAt: future, maxAgeMs: minute }],
    now: NOW,
  });
  assert.equal(r.feeds[0].status, "skewed");
  assert.equal(r.feeds[0].stale, false);
  assert.equal(r.ok, true);
});

test("invalid maxAgeMs throws", () => {
  assert.throws(() => evaluateFeedFreshness({
    feeds: [{ name: "x", lastObservedAt: NOW, maxAgeMs: 0 }],
    now: NOW,
  }));
  assert.throws(() => evaluateFeedFreshness({
    feeds: [{ name: "x", lastObservedAt: NOW, maxAgeMs: -1 }],
    now: NOW,
  }));
});

test("frozen result", () => {
  const r = evaluateFeedFreshness({ feeds: [], now: NOW });
  assert.throws(() => { r.ok = false; });
  assert.throws(() => { r.feeds.push({}); });
});

test("latestObservedAtOf picks max over varied field names", () => {
  const records = [
    { observedAt: "2026-04-21T11:00:00Z" },
    { updatedAt: "2026-04-21T11:30:00Z" },
    { timestamp: "2026-04-21T11:15:00Z" },
    { ts: Date.parse("2026-04-21T11:45:00Z") },
  ];
  assert.equal(latestObservedAtOf(records), "2026-04-21T11:45:00.000Z");
});

test("latestObservedAtOf returns null on empty/invalid", () => {
  assert.equal(latestObservedAtOf([]), null);
  assert.equal(latestObservedAtOf(null), null);
  assert.equal(latestObservedAtOf([{ foo: "bar" }]), null);
});

test("real gas-snapshot-stall scenario (plan baseline blocker)", () => {
  // Reproduces the current cron-stall blocker: gas snapshot last
  // written 425m ago, budget 30m. Verifies the watchdog halts.
  const r = evaluateFeedFreshness({
    feeds: [
      { name: "gas_snapshot", lastObservedAt: agoIso(425 * minute), maxAgeMs: 30 * minute },
    ],
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(r.action, "halt_new_entries");
  assert.ok(r.feeds[0].ageMs >= 425 * minute - 1);
});
