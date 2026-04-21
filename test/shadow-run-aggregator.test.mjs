import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateShadowRun,
  DEFAULT_THRESHOLDS,
} from "../src/executor/shadow/shadow-run-aggregator.mjs";

const NOW = "2026-04-21T12:00:00.000Z";
const START = "2026-04-14T12:00:00.000Z"; // exactly 7 days before NOW

function mkEntries({
  adapterId = "S1",
  approvedCount = 100,
  rejectedCount = 10,
  erroredCount = 0,
  netSatsEach = 500,
  startTs = START,
  rejectionReason = null, // null → spread across multiple reasons
} = {}) {
  const entries = [];
  const start = Date.parse(startTs);
  const end = Date.parse(NOW);
  const total = approvedCount + rejectedCount + erroredCount;
  const reasonPool = ["below_min_edge", "stale_quote", "cap_exceeded", "hf_low"];
  for (let i = 0; i < total; i += 1) {
    const ts = new Date(
      start + ((end - start) * i) / Math.max(1, total - 1),
    ).toISOString();
    let verdict = "approved";
    if (i >= approvedCount && i < approvedCount + rejectedCount) {
      verdict = "rejected";
    } else if (i >= approvedCount + rejectedCount) {
      verdict = "errored";
    }
    let r = null;
    if (verdict === "rejected") {
      r = rejectionReason == null
        ? reasonPool[(i - approvedCount) % reasonPool.length]
        : rejectionReason;
    }
    entries.push({
      adapterId,
      mode: "shadow",
      observedAt: ts,
      policyVerdict: verdict,
      rejectionReason: r,
      plannedNetSats: verdict === "approved" ? netSatsEach : 0,
      plannedYieldSats: verdict === "approved" ? netSatsEach + 100 : 0,
      plannedCostSats: verdict === "approved" ? 100 : 0,
    });
  }
  return entries;
}

test("empty input → 0 reports", () => {
  const out = aggregateShadowRun({ entries: [], now: NOW });
  assert.equal(out.adapterCount, 0);
  assert.equal(out.reports.length, 0);
});

test("ignores non-shadow entries", () => {
  const e = [
    { adapterId: "S1", mode: "live", policyVerdict: "approved", observedAt: NOW },
    { adapterId: "S1", mode: "canary", policyVerdict: "approved", observedAt: NOW },
  ];
  const out = aggregateShadowRun({ entries: e, now: NOW });
  assert.equal(out.adapterCount, 0);
});

test("healthy 7-day shadow → ready", () => {
  const out = aggregateShadowRun({ entries: mkEntries(), now: NOW });
  assert.equal(out.readyCount, 1);
  const r = out.reports[0];
  assert.equal(r.verdict, "ready");
  assert.equal(r.action, "promote_to_canary_1");
  assert.equal(r.blockers.length, 0);
  assert.equal(r.counts.approved, 100);
});

test("duration <7d → blocker", () => {
  const startLate = "2026-04-18T12:00:00.000Z"; // 3 days
  const out = aggregateShadowRun({
    entries: mkEntries({ startTs: startLate }),
    now: NOW,
  });
  const r = out.reports[0];
  assert.equal(r.verdict, "not_ready");
  assert.ok(r.blockers.some((b) => b.kind === "duration_insufficient"));
});

test("too few approvals → blocker", () => {
  const out = aggregateShadowRun({
    entries: mkEntries({ approvedCount: 20 }),
    now: NOW,
  });
  const r = out.reports[0];
  assert.ok(r.blockers.some((b) => b.kind === "approved_count_insufficient"));
});

test("low approval rate → blocker", () => {
  const out = aggregateShadowRun({
    entries: mkEntries({ approvedCount: 100, rejectedCount: 300 }),
    now: NOW,
  });
  const r = out.reports[0];
  assert.ok(r.blockers.some((b) => b.kind === "approved_rate_low"));
});

test("zero/negative mean net → blocker", () => {
  const out = aggregateShadowRun({
    entries: mkEntries({ netSatsEach: 0 }),
    now: NOW,
  });
  const r = out.reports[0];
  assert.ok(r.blockers.some((b) => b.kind === "mean_net_non_positive"));
});

test("any policy errors → blocker", () => {
  const out = aggregateShadowRun({
    entries: mkEntries({ erroredCount: 2 }),
    now: NOW,
  });
  const r = out.reports[0];
  assert.ok(r.blockers.some((b) => b.kind === "policy_errors_present"));
});

test("systemic rejection reason (>60%) → blocker", () => {
  // 100 approved, 50 rejections all same reason → 100% of rejections
  const out = aggregateShadowRun({
    entries: mkEntries({
      approvedCount: 100,
      rejectedCount: 50,
      rejectionReason: "stale_quote",
    }),
    now: NOW,
  });
  const r = out.reports[0];
  assert.ok(r.blockers.some((b) => b.kind === "systemic_rejection_reason"));
  assert.equal(r.topRejection.reason, "stale_quote");
});

test("rejection histogram with mixed reasons and no single dominant → passes that gate", () => {
  const entries = [
    ...mkEntries({ approvedCount: 150, rejectedCount: 0 }),
    // Add 20 split across 4 reasons evenly
    ...[0, 1, 2, 3].flatMap((i) =>
      Array.from({ length: 5 }, (_, j) => ({
        adapterId: "S1",
        mode: "shadow",
        observedAt: NOW,
        policyVerdict: "rejected",
        rejectionReason: `reason_${i}`,
      })),
    ),
  ];
  const out = aggregateShadowRun({ entries, now: NOW });
  const r = out.reports[0];
  // No single reason > 60% → this specific gate should not fire.
  assert.ok(!r.blockers.some((b) => b.kind === "systemic_rejection_reason"));
});

test("per-adapter filter", () => {
  const e = [
    ...mkEntries({ adapterId: "S1" }),
    ...mkEntries({ adapterId: "S2" }),
  ];
  const out = aggregateShadowRun({ entries: e, adapterId: "S1", now: NOW });
  assert.equal(out.reports.length, 1);
  assert.equal(out.reports[0].adapterId, "S1");
});

test("multiple adapters — sorted, counted", () => {
  const e = [
    ...mkEntries({ adapterId: "S2" }),
    ...mkEntries({ adapterId: "S1" }),
  ];
  const out = aggregateShadowRun({ entries: e, now: NOW });
  assert.equal(out.adapterCount, 2);
  assert.deepEqual(
    out.reports.map((r) => r.adapterId),
    ["S1", "S2"],
  );
});

test("frozen output and determinism", () => {
  const e = mkEntries();
  const a = aggregateShadowRun({ entries: e, now: NOW });
  const b = aggregateShadowRun({ entries: e, now: NOW });
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.reports[0]));
  assert.ok(Object.isFrozen(a.reports[0].blockers));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test("custom thresholds — short 2-day sample passes if configured so", () => {
  const out = aggregateShadowRun({
    entries: mkEntries({
      startTs: "2026-04-19T12:00:00.000Z", // 2 days
      approvedCount: 50,
      rejectedCount: 0,
    }),
    now: NOW,
    thresholds: {
      minDurationMs: 2 * 24 * 60 * 60 * 1000,
      minApprovedCount: 50,
    },
  });
  assert.equal(out.reports[0].verdict, "ready");
});
