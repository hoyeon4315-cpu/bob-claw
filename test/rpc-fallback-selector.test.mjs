import test from "node:test";
import assert from "node:assert/strict";

import { orderRpcUrls, __test__ } from "../src/protocol-readers/rpc-fallback-selector.mjs";

const PRIMARY = "https://primary.example/rpc";
const FALLBACK = "https://fallback.example/rpc";
const TERTIARY = "https://tertiary.example/rpc";

function attempt({ rpcUrl, observedAtMs, success }) {
  return { rpcUrl, observedAt: new Date(observedAtMs).toISOString(), success };
}

test("orderRpcUrls preserves the original order when there is no attempt history", () => {
  const { ordered, evidence } = orderRpcUrls({ rpcUrls: [PRIMARY, FALLBACK, TERTIARY], attempts: [], nowMs: 1_000_000 });
  assert.deepEqual(ordered, [PRIMARY, FALLBACK, TERTIARY]);
  assert.equal(evidence.length, 3);
  for (const entry of evidence) {
    assert.equal(entry.attemptCount, 0);
    assert.equal(entry.evaluated, false);
    assert.equal(entry.rankRatio, 1);
  }
});

test("orderRpcUrls keeps primary first when only the fallback has logged attempts", () => {
  const nowMs = 1_000_000;
  const attempts = [
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 1_000, success: true }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 2_000, success: false }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 3_000, success: false }),
  ];
  const { ordered, evidence } = orderRpcUrls({ rpcUrls: [PRIMARY, FALLBACK], attempts, nowMs });
  assert.deepEqual(ordered, [PRIMARY, FALLBACK]);
  const primary = evidence.find((entry) => entry.rpcUrl === PRIMARY);
  const fallback = evidence.find((entry) => entry.rpcUrl === FALLBACK);
  assert.equal(primary.attemptCount, 0);
  assert.equal(primary.evaluated, false);
  assert.equal(fallback.attemptCount, 3);
  assert.equal(fallback.successCount, 1);
  assert.equal(fallback.failureCount, 2);
  assert.equal(fallback.evaluated, true);
  assert.ok(Math.abs(fallback.successRatio - 1 / 3) < 1e-9);
});

test("orderRpcUrls demotes the primary when its recent failure rate is worse than fallback", () => {
  const nowMs = 1_000_000;
  const attempts = [
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 1_000, success: false }),
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 2_000, success: false }),
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 3_000, success: false }),
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 4_000, success: true }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 1_500, success: true }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 2_500, success: true }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 3_500, success: true }),
  ];
  const { ordered, evidence } = orderRpcUrls({ rpcUrls: [PRIMARY, FALLBACK], attempts, nowMs });
  assert.deepEqual(ordered, [FALLBACK, PRIMARY]);
  const primary = evidence.find((entry) => entry.rpcUrl === PRIMARY);
  const fallback = evidence.find((entry) => entry.rpcUrl === FALLBACK);
  assert.equal(primary.evaluated, true);
  assert.equal(fallback.evaluated, true);
  assert.equal(fallback.successRatio, 1);
  assert.ok(primary.successRatio < fallback.successRatio);
});

test("orderRpcUrls treats endpoints with equal recent reliability stably by original order", () => {
  const nowMs = 1_000_000;
  const attempts = [
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 1_000, success: true }),
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 2_000, success: true }),
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 3_000, success: true }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 1_000, success: true }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 2_000, success: true }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 3_000, success: true }),
    attempt({ rpcUrl: TERTIARY, observedAtMs: nowMs - 1_000, success: true }),
    attempt({ rpcUrl: TERTIARY, observedAtMs: nowMs - 2_000, success: true }),
    attempt({ rpcUrl: TERTIARY, observedAtMs: nowMs - 3_000, success: true }),
  ];
  const { ordered } = orderRpcUrls({ rpcUrls: [PRIMARY, FALLBACK, TERTIARY], attempts, nowMs });
  assert.deepEqual(ordered, [PRIMARY, FALLBACK, TERTIARY]);
});

test("orderRpcUrls ignores attempts older than the configured window", () => {
  const nowMs = 1_000_000;
  const windowMs = 60_000;
  const attempts = [
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - windowMs - 5_000, success: false }),
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - windowMs - 6_000, success: false }),
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - windowMs - 7_000, success: false }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 1_000, success: false }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 2_000, success: false }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 3_000, success: false }),
  ];
  const { ordered, evidence } = orderRpcUrls({
    rpcUrls: [PRIMARY, FALLBACK],
    attempts,
    nowMs,
    windowMs,
  });
  // Stale primary failures expire, fresh fallback failures dominate, so
  // primary moves back to the front of the queue.
  assert.deepEqual(ordered, [PRIMARY, FALLBACK]);
  const primary = evidence.find((entry) => entry.rpcUrl === PRIMARY);
  assert.equal(primary.attemptCount, 0);
  assert.equal(primary.evaluated, false);
});

test("orderRpcUrls deduplicates and skips empty rpcUrls", () => {
  const { ordered } = orderRpcUrls({
    rpcUrls: [PRIMARY, "", PRIMARY, FALLBACK, "  ", FALLBACK],
    attempts: [],
    nowMs: 1_000_000,
  });
  assert.deepEqual(ordered, [PRIMARY, FALLBACK]);
});

test("orderRpcUrls treats `minAttempts` as the smallest sample required for ranking", () => {
  const nowMs = 1_000_000;
  const attempts = [
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 1_000, success: false }),
    attempt({ rpcUrl: PRIMARY, observedAtMs: nowMs - 2_000, success: false }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 1_000, success: true }),
    attempt({ rpcUrl: FALLBACK, observedAtMs: nowMs - 2_000, success: true }),
  ];
  const lenient = orderRpcUrls({
    rpcUrls: [PRIMARY, FALLBACK],
    attempts,
    nowMs,
    minAttempts: 5,
  });
  // Both endpoints have fewer than five attempts, so neither is evaluated and
  // the original primary-first order is preserved.
  assert.deepEqual(lenient.ordered, [PRIMARY, FALLBACK]);
  const strict = orderRpcUrls({
    rpcUrls: [PRIMARY, FALLBACK],
    attempts,
    nowMs,
    minAttempts: 2,
  });
  assert.deepEqual(strict.ordered, [FALLBACK, PRIMARY]);
});

test("orderRpcUrls exposes its internal helpers for downstream tooling", () => {
  assert.equal(typeof __test__.uniqueRpcUrls, "function");
  assert.equal(typeof __test__.tallyAttempts, "function");
  assert.ok(__test__.DEFAULT_WINDOW_MS > 0);
  assert.ok(__test__.DEFAULT_MIN_ATTEMPTS > 0);
});
