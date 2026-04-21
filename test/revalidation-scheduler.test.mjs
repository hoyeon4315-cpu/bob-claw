import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REVALIDATION_SCHEDULER_DEFAULTS,
  runRevalidationSchedulerTick,
  runRevalidationSchedulerLoop,
} from "../src/executor/revalidation/scheduler.mjs";

test("defaults are frozen", () => {
  assert.throws(() => {
    REVALIDATION_SCHEDULER_DEFAULTS.pollIntervalMs = 1;
  });
});

test("tick: missing buildAuditImpl returns error", async () => {
  const r = await runRevalidationSchedulerTick({ now: "2026-04-21T00:00:00Z" });
  assert.equal(r.status, "error");
  assert.equal(r.reason, "build_audit_not_provided");
});

test("tick: ok path calls writeSnapshotImpl with audit", async () => {
  const calls = [];
  const r = await runRevalidationSchedulerTick({
    now: "2026-04-21T00:00:00Z",
    buildAuditImpl: async () => ({ audit: { decision: "LIVE_BLOCKED", blockers: ["x"] } }),
    writeSnapshotImpl: async (payload) => {
      calls.push(payload);
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.decision, "LIVE_BLOCKED");
  assert.deepEqual(r.blockers, ["x"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].observedAt, "2026-04-21T00:00:00Z");
});

test("tick: thrown buildAudit captured; onError invoked", async () => {
  const errs = [];
  const r = await runRevalidationSchedulerTick({
    now: new Date("2026-04-21T00:00:00Z"),
    buildAuditImpl: async () => {
      throw new Error("boom");
    },
    onError: async (payload) => {
      errs.push(payload);
    },
  });
  assert.equal(r.status, "error");
  assert.equal(r.reason, "tick_threw");
  assert.equal(r.message, "boom");
  assert.equal(errs.length, 1);
});

test("loop: once=true, cron match triggers a single tick", async () => {
  let called = 0;
  const iter = [];
  const r = await runRevalidationSchedulerLoop({
    cronExpression: "* * * * *",
    pollIntervalMs: 1,
    nowFactory: () => "2026-04-21T00:00:00Z",
    tickImpl: async () => {
      called += 1;
      return { status: "ok", decision: "ALLOWED", observedAt: "2026-04-21T00:00:00Z" };
    },
    onIteration: async (payload) => {
      iter.push(payload);
    },
    once: true,
  });
  assert.equal(called, 1);
  assert.equal(r.status, "ok");
  assert.equal(r.lastTriggeredAt, "2026-04-21T00:00:00Z");
  assert.equal(iter.length, 1);
});

test("loop: once=true, cron not matched => idle", async () => {
  const r = await runRevalidationSchedulerLoop({
    cronExpression: "0 12 * * *", // noon, but 'now' is 00:00
    pollIntervalMs: 1,
    nowFactory: () => "2026-04-21T00:00:00Z",
    tickImpl: async () => ({ status: "ok" }),
    once: true,
  });
  assert.equal(r.status, "idle");
  assert.equal(r.reason, "cron_not_matched");
});

test("loop halts after maxConsecutiveFailures", async () => {
  let ticks = 0;
  let seconds = 0;
  const r = await runRevalidationSchedulerLoop({
    cronExpression: "* * * * *",
    pollIntervalMs: 1,
    maxConsecutiveFailures: 2,
    nowFactory: () => {
      // advance by 1 minute each call so cron matches a fresh minute each iter
      const t = new Date(Date.UTC(2026, 3, 21, 0, seconds++, 0));
      return t.toISOString();
    },
    tickImpl: async () => ({ status: "error", reason: "tick_threw" }),
    delayImpl: async () => {},
    once: false,
  });
  assert.equal(r.status, "halted");
  assert.equal(r.reason, "max_consecutive_failures");
  assert.ok(r.consecutiveFailures >= 2);
});
