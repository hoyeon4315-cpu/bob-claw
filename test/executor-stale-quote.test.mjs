import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateStaleQuote } from "../src/executor/policy/stale-quote.mjs";

test("stale-quote blocks missing quote timestamps", () => {
  const result = evaluateStaleQuote({
    intent: {
      strategyId: "gateway-instant-swap-verification",
    },
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.blockers.includes("quote_timestamp_missing"), true);
});

test("stale-quote blocks quotes older than configured ttl", () => {
  const result = evaluateStaleQuote({
    intent: {
      quote: {
        observedAt: "2026-04-16T00:00:00.000Z",
      },
    },
    maxAgeMs: 10_000,
    now: "2026-04-16T00:00:15.000Z",
  });

  assert.equal(result.blockers.includes("quote_stale"), true);
});

test("stale-quote allows fresh quotes", () => {
  const result = evaluateStaleQuote({
    intent: {
      quote: {
        observedAt: "2026-04-16T00:00:00.000Z",
      },
    },
    maxAgeMs: 10_000,
    now: "2026-04-16T00:00:05.000Z",
  });

  assert.equal(result.decision, "ALLOW");
});
